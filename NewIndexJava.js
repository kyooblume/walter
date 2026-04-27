// ============================================================
// WALTER — HRV Analyser
// NewIndexJava.js
// ============================================================

// ----- Colour scheme for each phase -----
const PHASE_COLORS = [
  { bg: '#E6F1FB', border: '#185FA5', text: '#0C447C' },
  { bg: '#FAECE7', border: '#993C1D', text: '#712B13' },
  { bg: '#EAF3DE', border: '#3B6D11', text: '#27500A' },
  { bg: '#EEEDFE', border: '#534AB7', text: '#3C3489' },
  { bg: '#FAEEDA', border: '#BA7517', text: '#633806' },
];

// ----- Global variables -----
let parsedPhases   = null; // Stores parsed phase data so settings changes can trigger recalculation without re-uploading
let parsedAllValid = null; // Stores all valid rows across all phases
let rrChartInst = null;
let hrChartInst = null;
let summaryData = [];
let phaseLabels = {};

// ----- Get DOM elements -----
const fileInput  = document.getElementById('fileInput');
const uploadCard = document.getElementById('uploadCard');
const errorBox   = document.getElementById('errorBox');
const results    = document.getElementById('results');

// ============================================================
// Part 1 — File upload and validation
// ============================================================

// Trigger file processing when user selects a file via the input
fileInput.addEventListener('change', e => {
  if (e.target.files[0]) processFile(e.target.files[0]);
});

// Drag and drop support
uploadCard.addEventListener('dragover',  e => { e.preventDefault(); uploadCard.classList.add('drag-over'); });
uploadCard.addEventListener('dragleave', () => uploadCard.classList.remove('drag-over'));
uploadCard.addEventListener('drop', e => {
  e.preventDefault();
  uploadCard.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
});

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.style.display = 'block';
}
function hideError() { errorBox.style.display = 'none'; }

// Read and validate the uploaded CSV file using Papa Parse
function processFile(file) {
  hideError();
  if (!file.name.endsWith('.csv')) { showError('Please upload a CSV file.'); return; }

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: function(res) {
      const allRows = res.data;
      const cols = res.meta.fields || [];

      // Check required columns are present
      if (!cols.includes('rr_ms') || !cols.includes('timestamp_ms')) {
        showError('Required columns missing. Make sure this is a Harvey CSV file.');
        return;
      }
       //give info if rr_ms is more than 300 but less than 2000 
      const validRows = allRows.filter(row => {
        const rr = parseFloat(row.rr_ms);
        return rr >= 300 && rr <= 2000;
      });

      // Require at least 10 valid beats to calculate meaningful HRV
      if (validRows.length < 10) {
        showError('Not enough valid RR intervals (minimum 10 required). Check your file.');
        return;
      }

      const phases = buildPhases(allRows);
      renderResults(file.name,allRows,validRows, phases);
    },
    error: function() { showError('Could not read the file. Make sure it is a valid CSV.'); }
  });
}

//goes through the rows and collects timestamps where a phase marker is
function buildPhases(allRows){
        const phaseMap = {};

        allRows.forEach(r => {
            const event = (r.event || '').trim();
            const rr = parseFloat(r.rr_ms);
            const phase = parseInt(r.phase,10);

            if(event!=='')return;
            if(!(rr >0)) return;
            if(isNaN(phase)) return;

            if (!phaseMap[phase]){
                phaseMap[phase] = [];
            }
            phaseMap[phase].push(r);
        });
        const phaseNumbers = Object.keys(phaseMap)
        .map(Number)
        .sort((a,b) => a-b);

        return phaseNumbers.map(n => ({
            label: phaseLabels[n] || `Phase ${n}`,
            phaseNumber:n,
            rows:phaseMap[n]
        }))
}

function getValidRows(rows){
    return rows.filter(r=>{
    const rr = parseFloat(r.rr_ms);
    return rr >= 300 && rr <= 2000;
    })
}

// ============================================================
// Part 3 — Artefact handling
// Detects and handles artefacts before metric calculation
// ============================================================
function handleArtefacts(rrArray, method, threshold) {
  const thresholdRate = threshold / 100;

  if (method === 'none' || rrArray.length < 2) {
    return { cleaned: [...rrArray], deletedIndices: new Set() };
  }

  const result     = [...rrArray];
  const isArtefact = new Array(result.length).fill(false);

  // Step 1: Detect artefacts — flag beats deviating more than threshold% from previous
  for (let i = 1; i < result.length; i++) {
    const diff = Math.abs(result[i] - result[i - 1]) / result[i - 1];
    if (diff > thresholdRate) isArtefact[i] = true;
  }

  // Step 2: Apply interpolation if selected
  if (method === 'interpolate') {
    for (let i = 1; i < result.length - 1; i++) {
      if (!isArtefact[i]) continue;
      if (isArtefact[i - 1] || isArtefact[i + 1]) {
        isArtefact[i] = 'delete';
      } else {
        result[i]     = (result[i - 1] + result[i + 1]) / 2;
        isArtefact[i] = false;
      }
    }
  }

  // Step 3: Remove beats marked for deletion and record their positions
  const deletedIndices = new Set();
  const cleaned = [];
  result.forEach((val, i) => {
    if (isArtefact[i] === true || isArtefact[i] === 'delete') {
      deletedIndices.add(cleaned.length);
    } else {
      cleaned.push(val);
    }
  });

  return { cleaned, deletedIndices };
}

function calcMetrics(rows, method = 'interpolate', threshold = 20) {
  const rawRR = rows.map(r => parseFloat(r.rr_ms));
  const hr    = rows.map(r => parseFloat(r.hr_bpm)).filter(v => !isNaN(v));

  // Apply artefact handling to get cleaned RR array and deletion positions
  const { cleaned: rr, deletedIndices } = handleArtefacts(rawRR, method, threshold);

  const meanRR = rr.reduce((a, b) => a + b, 0) / rr.length;
  const meanHR = hr.length ? hr.reduce((a, b) => a + b, 0) / hr.length : 60000 / meanRR;

  // Calculate successive differences for RMSSD and pNN50
  // Skip differences that span a deletion gap (deletion boundary problem):
  // when a beat is deleted, the beats either side were not truly consecutive
  const diffs = [];
  for (let i = 1; i < rr.length; i++) {
    if (deletedIndices.has(i)) continue; // Skip boundary caused by a deleted beat
    diffs.push(rr[i] - rr[i - 1]);
  }

  const rmssd = diffs.length ? Math.sqrt(diffs.map(d => d * d).reduce((a, b) => a + b, 0) / diffs.length) : 0;
  const sdnn  = Math.sqrt(rr.map(v => (v - meanRR) ** 2).reduce((a, b) => a + b, 0) / rr.length);
  const pnn50 = diffs.length ? (diffs.filter(d => Math.abs(d) > 50).length / diffs.length) * 100 : 0;

  const t0       = parseFloat(rows[0].timestamp_ms);
  const t1       = parseFloat(rows[rows.length - 1].timestamp_ms);
  const duration = (t1 - t0) / 1000;

  return {
    count:    rr.length,
    meanRR:   meanRR.toFixed(2),
    meanHR:   meanHR.toFixed(2),
    rmssd:    rmssd.toFixed(2),
    sdnn:     sdnn.toFixed(2),
    pnn50:    pnn50.toFixed(2),
    minRR:    Math.min(...rr).toFixed(2),
    maxRR:    Math.max(...rr).toFixed(2),
    duration: duration.toFixed(1),
  };
}

// ============================================================
// Main render entry point — called after file upload and after settings changes
// ============================================================
function renderResults(fileName,allRows,allValid, phases) {
  uploadCard.style.display = 'none';
  results.style.display    = 'block';

  parsedAllValid = allValid;
  parsedPhases = phases;

  const method    = getArtefactMethod();
  const threshold = getThreshold();

  const sessionMetrics = calcMetrics(allValid, method, threshold);
  const phaseMetrics   = phases.map(p => {
  
    const validRows = getValidRows(p.rows);
    return{label: p.label,m:calcMetrics(validRows,method,threshold)};
  });

  renderSessionMeta(fileName,sessionMetrics)

  const phaseQuality = phases.map(p=>{
    const validRows = getValidRows(p.rows);
    return{
        label: p.label,
        q: calculateDataQuality(p.rows,validRows)
    };
  });

  renderLegend(phases);
  renderArtefactPanel(method, threshold); // Settings panel — always visible on results page
  renderMetricCards(sessionMetrics, phaseMetrics);
  renderQualitySummary(phaseQuality);
  renderCharts(allValid, phases);
  renderTable(sessionMetrics, phaseMetrics);

  summaryData = { session: sessionMetrics, phases: phaseMetrics, method, threshold, quality: phaseQuality, fileName, allRows, allValid, phasesRaw: phases };
}

// ============================================================
// Part 3.4 — Artefact settings panel (UI)
// Renders radio buttons, threshold slider, and methods statement
// Any change to a setting triggers immediate recalculation
// ============================================================
function renderArtefactPanel(currentMethod, currentThreshold) {
  // Remove existing panel if present before re-rendering
  const existing = document.getElementById('artefactPanel');
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.id        = 'artefactPanel';
  panel.className = 'card';
  panel.innerHTML = `
    <div class="card-header">
      <span class="card-title">Artefact handling settings</span>
    </div>

    <!-- Radio buttons: select artefact handling method -->
    <div style="display:flex; gap:24px; margin-bottom:16px; flex-wrap:wrap;">
      <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:14px;">
        <input type="radio" name="artefactMethod" value="interpolate" ${currentMethod === 'interpolate' ? 'checked' : ''}>
        Interpolate <span style="color:#5F5E5A; font-size:12px;">(recommended)</span>
      </label>
      <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:14px;">
        <input type="radio" name="artefactMethod" value="delete" ${currentMethod === 'delete' ? 'checked' : ''}>
        Delete
      </label>
      <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:14px;">
        <input type="radio" name="artefactMethod" value="none" ${currentMethod === 'none' ? 'checked' : ''}>
        None
      </label>
    </div>

    <!-- Threshold slider: controls sensitivity of artefact detection (10–30%, default 20%) -->
    <div style="margin-bottom:16px;">
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:4px;">
        <label style="font-size:13px; color:#5F5E5A; min-width:80px;">Threshold</label>
        <input type="range" id="thresholdSlider" min="10" max="30" step="1" value="${currentThreshold}"
          ${currentMethod === 'none' ? 'disabled' : ''} style="flex:1; max-width:200px;">
        <span id="thresholdLabel" style="font-size:13px; font-weight:600; min-width:36px;">${currentThreshold}%</span>
      </div>
      <div style="font-size:11px; color:#5F5E5A; padding-left:92px;">
        10% (strict) ← → 30% (lenient) · default: 20%
      </div>
    </div>

    <!-- Auto-generated methods statement for student reports -->
    <div>
      <div style="font-size:13px; color:#5F5E5A; margin-bottom:6px;">Methods statement</div>
      <div style="display:flex; gap:8px; align-items:flex-start;">
        <textarea id="methodsStatement" readonly
          style="flex:1; font-size:12px; padding:10px; border:1px solid #E0DED8;
                 border-radius:6px; resize:none; background:#F8F8F7;
                 color:#1a1a18; line-height:1.5; min-height:60px;"
        >${generateMethodsStatement(currentMethod, currentThreshold)}</textarea>
        <button class="btn btn-sm" onclick="copyMethodsStatement()">Copy</button>
      </div>
    </div>
  `;

  // Insert the panel before the metrics grid
  const metricsGrid = document.getElementById('metricsGrid');
  results.insertBefore(panel, metricsGrid);

  attachArtefactListeners();
}

// Attach change listeners to the radio buttons and threshold slider
function attachArtefactListeners() {
  document.querySelectorAll('input[name="artefactMethod"]').forEach(radio => {
    radio.addEventListener('change', onSettingsChange);
  });
  const slider = document.getElementById('thresholdSlider');
  if (slider) {
    slider.addEventListener('input', () => {
      document.getElementById('thresholdLabel').textContent = slider.value + '%';
      onSettingsChange();
    });
  }
}

// Called whenever a setting changes — recalculates metrics and redraws table
// Uses the saved parsed data so the student does not need to re-upload
function onSettingsChange() {
  if (!parsedAllValid || !parsedPhases) return;

  const method    = getArtefactMethod();
  const threshold = getThreshold();

  // Grey out the slider when method is 'none' (threshold has no effect)
  const slider = document.getElementById('thresholdSlider');
  if (slider) slider.disabled = (method === 'none');

  // Update the methods statement text in real time
  const stmtEl = document.getElementById('methodsStatement');
  if (stmtEl) stmtEl.value = generateMethodsStatement(method, threshold);

  // Recalculate and redraw metrics and table only (charts are not redrawn for performance)
  const sessionMetrics = calcMetrics(parsedAllValid, method, threshold);
  const phaseMetrics   = parsedPhases.map(p => ({
    label: p.label,
    m: calcMetrics(getValidRows(p.rows), method, threshold)
  }));

  renderMetricCards(sessionMetrics, phaseMetrics);
  renderTable(sessionMetrics, phaseMetrics);

  summaryData = { session: sessionMetrics, phases: phaseMetrics, method, threshold };
}

// Returns the currently selected artefact method from the radio buttons
function getArtefactMethod() {
  const checked = document.querySelector('input[name="artefactMethod"]:checked');
  return checked ? checked.value : 'interpolate';
}

// Returns the current threshold slider value as an integer
function getThreshold() {
  const slider = document.getElementById('thresholdSlider');
  return slider ? parseInt(slider.value) : 20;
}

function renderQualitySummary(phaseQuality){
    const table = 
    document.getElementById("qualityTable")

    table.innerHTML = `
    <thead>
        <tr>
            <th> Phase </th>
            <th> beats recorded</th>
            <th> beats retained </th>
            <th> Beats handled </th>
            <th> rating </th>
        </tr>
        </thead>
        <tbody>
            ${phaseQuality.map(p => `
                <tr>
                <td>${p.label}</td>
                <td>${p.q.recorded}</td>
                <td>${p.q.retained}</td>
                <td>${p.q.handled}</td>
                <td>${p.q.rating} (${p.q.percentRetained}%)</td>
                </tr>
            `).join('')}
    </tbody>

    `;
   
}

// Copies the methods statement text to the clipboard
function copyMethodsStatement() {
  const stmt = document.getElementById('methodsStatement');
  if (!stmt) return;
  navigator.clipboard.writeText(stmt.value).then(() => {
    const btn      = stmt.nextElementSibling;
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  });
}

// ============================================================
// Part 5 — Rendering: legend, metric cards, charts, table
// ============================================================

// Renders phase colour badges at the top of the results page
function renderLegend(phases) {
  const legend = document.getElementById('phaseLegend');
  legend.innerHTML = '';
  phases.forEach((p, i) => {
    const c     = PHASE_COLORS[i % PHASE_COLORS.length];
    const badge = document.createElement('span');
    badge.className        = 'phase-badge';
    badge.style.background = c.bg;
    badge.style.color      = c.text;
    badge.innerHTML = `<span class="phase-dot" style="background:${c.border}"></span>${p.label}`;
    badge.style.color = c.text;
    badge.innerHTML = `<span class="phase-dot" style="background:${c.border}"></span>
    <input type = "text" value = "${p.label}"
    style = "width:90px;font-size:11px;"
    onchange = "updatePhaseLabel(${p.phaseNumber},this.value)"/>`;
    legend.appendChild(badge);
  });
  if (phases.length > 1) {
    const badge = document.createElement('span');
    badge.className        = 'phase-badge';
    badge.style.background = '#F1EFE8';
    badge.style.color      = '#444441';
    badge.innerHTML = `<span class="phase-dot" style="background:#888780"></span>Full session`;
    legend.appendChild(badge);
  }
}

// Renders the four summary metric cards (RMSSD, Mean HR, SDNN, pNN50)
function renderMetricCards(s, phaseMetrics) {
  const grid    = document.getElementById('metricsGrid');
  const metrics = [
    { label: 'RMSSD',   key: 'rmssd',  unit: 'ms'  },
    { label: 'Mean HR', key: 'meanHR', unit: 'bpm' },
    { label: 'SDNN',    key: 'sdnn',   unit: 'ms'  },
    { label: 'pNN50',   key: 'pnn50',  unit: '%'   },
  ];
  grid.innerHTML = metrics.map(m => {
    const phases = phaseMetrics.map((p, i) => {
      const c = PHASE_COLORS[i % PHASE_COLORS.length];
      return `<div style="font-size:11px;color:${c.border};margin-top:4px">${p.label}: ${p.m ? p.m[m.key] : '—'} ${m.unit}</div>`;
    }).join('');
    return `
      <div class="metric-card">
        <div class="label">${m.label}</div>
        <div class="value">${s ? s[m.key] : '—'}<span class="unit">${m.unit}</span></div>
        ${phases}
      </div>`;
  }).join('');
}

// Renders the tachogram (RR interval chart) and heart rate chart using Chart.js
function renderCharts(allValid, phases) {
  // Explicitly register the annotation plugin with Chart.js
  // Required in Chart.js v4 — loading the script alone is not enough
  if (window.ChartAnnotation) {
    Chart.register(window.ChartAnnotation);
  }

  const t0 = parseFloat(allValid[0].timestamp_ms);

  // Build x/y data points — x axis is elapsed seconds from the first data row
  const rrData = allValid.map(r => ({
    x: ((parseFloat(r.timestamp_ms) - t0) / 1000).toFixed(2),
    y: parseFloat(r.rr_ms)
  }));
  const hrData = allValid.map(r => ({
    x: ((parseFloat(r.timestamp_ms) - t0) / 1000).toFixed(2),
    y: parseFloat(r.hr_bpm)
  }));

  // Build annotation objects for phase boundary lines and labels
  const annotations = {};
  phases.forEach((p, i) => {
    if (i === 0) return; // No boundary line needed before the first phase
    const t    = parseFloat(p.rows[0].timestamp_ms);
    const xVal = ((t - t0) / 1000).toFixed(2);
    const c    = PHASE_COLORS[i % PHASE_COLORS.length];
    annotations['line' + i] = {
      type: 'line', xMin: xVal, xMax: xVal,
      borderColor: c.border, borderWidth: 1.5, borderDash: [4, 3],
      label: {
        content: p.label, display: true, position: 'start',
        color: c.text, backgroundColor: c.bg,
        font: { size: 11 }, padding: 4, yAdjust: 8
      }
    };
  });

  // Build coloured background boxes for each phase
  const phaseBackgrounds = phases.map((p, i) => {
    const c    = PHASE_COLORS[i % PHASE_COLORS.length];
    const xMin = ((parseFloat(p.rows[0].timestamp_ms) - t0) / 1000).toFixed(2);
    const xMax = ((parseFloat(p.rows[p.rows.length - 1].timestamp_ms) - t0) / 1000).toFixed(2);
    return { type: 'box', xMin, xMax, backgroundColor: c.bg + '55', borderWidth: 0 };
  });

  const allAnnotations = { ...annotations };
  phaseBackgrounds.forEach((b, i) => { allAnnotations['bg' + i] = b; });

  // Destroy existing charts before creating new ones to avoid canvas conflicts
  if (rrChartInst) rrChartInst.destroy();
  if (hrChartInst) hrChartInst.destroy();

  // Shared chart options factory — used for both tachogram and HR chart
  const makeOptions = (ylabel, annots) => ({
    responsive: true, maintainAspectRatio: false, animation: false,
    elements: { point: { radius: 0 }, line: { borderWidth: 1.5, tension: 0.2 } },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => `${ctx.parsed.y.toFixed(1)} ${ylabel}` } },
      annotation: { annotations: annots } // Phase boundary lines and background boxes
    },
    scales: {
      x: { type: 'linear', title: { display: true, text: 'Time (s)', font: { size: 11 }, color: '#888780' }, ticks: { font: { size: 11 }, color: '#888780' }, grid: { color: '#F1EFE8' } },
      y: { title: { display: true, text: ylabel, font: { size: 11 }, color: '#888780' }, ticks: { font: { size: 11 }, color: '#888780' }, grid: { color: '#F1EFE8' } }
    }
  });

  rrChartInst = new Chart(document.getElementById('rrChart'), {
    type: 'line',
    data: { datasets: [{ data: rrData, borderColor: '#185FA5', backgroundColor: 'transparent' }] },
    options: makeOptions('RR (ms)', allAnnotations)
  });
  hrChartInst = new Chart(document.getElementById('hrChart'), {
    type: 'line',
    data: { datasets: [{ data: hrData, borderColor: '#993C1D', backgroundColor: 'transparent' }] },
    options: makeOptions('HR (bpm)', allAnnotations)
  });
}

// Renders the summary metrics table with one column per phase plus a full session column
function renderTable(session, phaseMetrics) {
  const metrics = [
    { label: 'Beat count', key: 'count',    unit: 'beats' },
    { label: 'Mean RR',    key: 'meanRR',   unit: 'ms'    },
    { label: 'Mean HR',    key: 'meanHR',   unit: 'bpm'   },
    { label: 'RMSSD',      key: 'rmssd',    unit: 'ms'    },
    { label: 'SDNN',       key: 'sdnn',     unit: 'ms'    },
    { label: 'pNN50',      key: 'pnn50',    unit: '%'     },
    { label: 'Min RR',     key: 'minRR',    unit: 'ms'    },
    { label: 'Max RR',     key: 'maxRR',    unit: 'ms'    },
    { label: 'Duration',   key: 'duration', unit: 's'     },
  ];
  const table      = document.getElementById('summaryTable');
  const phaseCols  = phaseMetrics.map((p, i) => {
    const c = PHASE_COLORS[i % PHASE_COLORS.length];
    return `<th style="color:${c.text}">${p.label}</th>`;
  }).join('');
  const sessionCol = phaseMetrics.length > 0 ? '<th>Full session</th>' : '';

  table.innerHTML = `
    <thead><tr><th>Metric</th><th>Unit</th>${phaseCols}${sessionCol}</tr></thead>
    <tbody>
      ${metrics.map(m => {
        const phaseCells  = phaseMetrics.map((p, i) => {
          const c = PHASE_COLORS[i % PHASE_COLORS.length];
          return `<td style="color:${c.text};font-weight:500">${p.m ? p.m[m.key] : '—'}</td>`;
        }).join('');
        const sessionCell = phaseMetrics.length > 0 ? `<td>${session ? session[m.key] : '—'}</td>` : '';
        return `<tr><td class="metric-name">${m.label}</td><td class="unit-cell">${m.unit}</td>${phaseCells}${sessionCell}</tr>`;
      }).join('')}
    </tbody>`;
}

// ============================================================
// Part 6 — Export
// ============================================================

// Downloads a chart canvas as a PNG image
function downloadChart(id, filename) {
  const canvas = document.getElementById(id);
  const link   = document.createElement('a');
  link.download = filename;
  link.href     = canvas.toDataURL('image/png');
  link.click();
}

// Downloads the summary table as a CSV file
// The methods statement is included as a comment line at the top
// so the record of which artefact method was used travels with the data
function downloadCSV() {
  if (!summaryData.session) return;
  const metrics = [
    { label: 'Beat count', key: 'count',    unit: 'beats' },
    { label: 'Mean RR',    key: 'meanRR',   unit: 'ms'    },
    { label: 'Mean HR',    key: 'meanHR',   unit: 'bpm'   },
    { label: 'RMSSD',      key: 'rmssd',    unit: 'ms'    },
    { label: 'SDNN',       key: 'sdnn',     unit: 'ms'    },
    { label: 'pNN50',      key: 'pnn50',    unit: '%'     },
    { label: 'Min RR',     key: 'minRR',    unit: 'ms'    },
    { label: 'Max RR',     key: 'maxRR',    unit: 'ms'    },
    { label: 'Duration',   key: 'duration', unit: 's'     },
  ];
  const methodsStmt   = generateMethodsStatement(summaryData.method, summaryData.threshold);
  let csv = `# ${methodsStmt}\n`;
  const phaseHeaders  = summaryData.phases.map(p => p.label).join(',');
  const sessionHeader = summaryData.phases.length > 0 ? ',Full session' : '';
  csv += `Metric,Unit,${phaseHeaders}${sessionHeader}\n`;
  metrics.forEach(m => {
    const phaseCells  = summaryData.phases.map(p => p.m ? p.m[m.key] : '').join(',');
    const sessionCell = summaryData.phases.length > 0 ? ',' + (summaryData.session ? summaryData.session[m.key] : '') : '';
    csv += `${m.label},${m.unit},${phaseCells}${sessionCell}\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.download = 'walter_summary.csv';
  link.href     = URL.createObjectURL(blob);
  link.click();
}

// Resets the app to the upload screen and clears all stored data
function toggleDarkMode(){
    document.body.classList.toggle('dark')
}

function updatePhaseLabel(phaseNumber,newLabel){
    phaseLabels[phaseNumber] = newLabel.trim() || `Phase ${phaseNumber}`;

    const newPhases = buildPhases(summaryData.allRows)

    renderResults(
        summaryData.fileName,
        summaryData.allRows,
        summaryData.allValid,
        newPhases
    );
}

function calculateDataQuality(originalRows,retainedRows){
    const recorded = originalRows.length;
    const retained = retainedRows.length;
    const handled = recorded - retained;
    const percentRetained = recorded > 0 ? (retained / recorded) * 100:0;

    let rating = "good";
    if(percentRetained<85) rating = "Poor";
    else if(percentRetained<95) rating = "Fair";

    return { recorded, retained, handled, rating, percentRetained: percentRetained.toFixed(1)};
};

function parseFilenameMeta(filename){
    const baseName = filename.replace(/\.csv$/i,"")
    const parts = baseName.split("_")
    return{
        filename:filename,
        participantID:parts[0]||'unknown',
        sessionType:parts[1]||"Unknown",
        date:parts[2]||"Unknown"
    };
}

function renderSessionMeta(fileName,sessionMetrics){
    const box = document.getElementById("sessionMeta");
    if(!box) return;
    const meta = parseFilenameMeta(fileName);
    box.innerHTML = `
    <p><strong>Filename:</strong>${meta.filename}</p>
    <p><strong>Participant ID:</strong>${meta.participantID}</p>
    <p><strong>Session:</strong>${meta.sessionType}</p>
    <p><strong>Date:</strong>${meta.date}</p>
    <p><strong>Total duration:</strong>${sessionMetrics.duration}</p>
    `;
}

function generateMethodsStatement(method, threshold) {
  if (method === 'interpolate') {
    return `Artefact handling: RR intervals deviating more than ${threshold}% from the preceding interval were replaced using linear interpolation between neighbouring beats.`;
  }
  if (method === 'delete') {
    return `Artefact handling: RR intervals deviating more than ${threshold}% from the preceding interval were removed from the series.`;
  }
  return 'Artefact handling: No successive difference filtering was applied. Only physiological range filtering (300–2000ms) was used.';
}

//clears everthing and goes back to the upload screen 
function resetApp() {
  uploadCard.style.display = 'block';
  results.style.display    = 'none';
  fileInput.value          = '';
  parsedAllValid           = null;
  parsedPhases             = null;
  hideError();
  if (rrChartInst) { rrChartInst.destroy(); rrChartInst = null; }
  if (hrChartInst) { hrChartInst.destroy(); hrChartInst = null; }
}
