
const PHASE_COLORS = [
  { bg: '#E6F1FB', border: '#185FA5', text: '#0C447C' },
  { bg: '#FAECE7', border: '#993C1D', text: '#712B13' },
  { bg: '#EAF3DE', border: '#3B6D11', text: '#27500A' },
  { bg: '#EEEDFE', border: '#534AB7', text: '#3C3489' },
  { bg: '#FAEEDA', border: '#BA7517', text: '#633806' },
];

let rrChartInst = null;
let hrChartInst = null;
let summaryData = [];

const fileInput = document.getElementById('fileInput');
const uploadCard = document.getElementById('uploadCard');
const errorBox = document.getElementById('errorBox');
const results = document.getElementById('results');

//when user selects a file grab first file and send it to process file
fileInput.addEventListener('change', e => {
  if (e.target.files[0]) processFile(e.target.files[0]);
});

//lets a user drag a file onto the box and when they drop it, it procceses it 
uploadCard.addEventListener('dragover', e => { e.preventDefault(); uploadCard.classList.add('drag-over'); });
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

//this takes the files and parses it and then filters it and then sends it to be displayed
function processFile(file) {
  hideError();
  if (!file.name.endsWith('.csv')) { showError('Please upload a CSV file.'); return; }

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: function(res) {
      const allRows = res.data;
      const cols = res.meta.fields || [];

      if (!cols.includes('rr_ms') || !cols.includes('timestamp_ms')) {
        showError('Required columns missing. Make sure this is a Harvey CSV file (needs: timestamp_ms, rr_ms, hr_bpm, phase, event).');
        return;
      }

      const validRows = allRows.filter(r => {
        const rr = parseFloat(r.rr_ms);
        return rr >= 300 && rr <= 2000;
      });

      if (validRows.length < 10) {
        showError('Not enough valid RR intervals (minimum 10 required). Check your file.');
        return;
      }

      const phases = buildPhases(allRows, validRows);
      renderResults(allRows,validRows, phases);
    },
    error: function() { showError('Could not read the file. Make sure it is a valid CSV.'); }
  });
}

//goes through the rows and collects timestamps where a phase marker is
function buildPhases(allRows, validRows) {
  const phaseMarkers = [];
  allRows.forEach(r => {
    if ((r.event || '').includes('PHASE_MARKER')) {
      phaseMarkers.push(parseFloat(r.timestamp_ms));
    }
  });

  if (phaseMarkers.length === 0) return [{ label: 'Session', rows: validRows }];

  const phases = [];
  let boundaries = [parseFloat(validRows[0].timestamp_ms), ...phaseMarkers, Infinity];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    const phaseRows = validRows.filter(r => {
      const t = parseFloat(r.timestamp_ms);
      return t >= start && t < end;
    });
    if (phaseRows.length > 0) phases.push({ label: 'Phase ' + (i + 1), rows: phaseRows });
  }

  return phases;
}

function calcMetrics(rows) {
  const rr = rows.map(r => parseFloat(r.rr_ms));
  const hr = rows.map(r => parseFloat(r.hr_bpm)).filter(v => !isNaN(v));

  const meanRR = rr.reduce((a, b) => a + b, 0) / rr.length;
  const meanHR = hr.length ? hr.reduce((a, b) => a + b, 0) / hr.length : 60000 / meanRR;

  //the difference in time between each hearbeat interval 
  const diffs = [];
  for (let i = 1; i < rr.length; i++) diffs.push(rr[i] - rr[i - 1]);

  const rmssd = diffs.length ? Math.sqrt(diffs.map(d => d * d).reduce((a, b) => a + b, 0) / diffs.length) : 0;
  const sdnn = Math.sqrt(rr.map(v => (v - meanRR) ** 2).reduce((a, b) => a + b, 0) / rr.length);
  const pnn50 = diffs.length ? (diffs.filter(d => Math.abs(d) > 50).length / diffs.length) * 100 : 0;

  const t0 = parseFloat(rows[0].timestamp_ms);
  const t1 = parseFloat(rows[rows.length - 1].timestamp_ms);
  const duration = (t1 - t0) / 1000;

  return {
    count: rr.length,
    meanRR: meanRR.toFixed(2),
    meanHR: meanHR.toFixed(2),
    rmssd: rmssd.toFixed(2),
    sdnn: sdnn.toFixed(2),
    pnn50: pnn50.toFixed(2),
    minRR: Math.min(...rr).toFixed(2),
    maxRR: Math.max(...rr).toFixed(2),
    duration: duration.toFixed(1),
  };
}

function renderResults(allRows,allValid, phases) {
  uploadCard.style.display = 'none';
  results.style.display = 'block';

  const sessionMetrics = calcMetrics(allValid);
  const phaseMetrics = phases.map(p => ({ label: p.label, m: calcMetrics(p.rows) }));

  renderLegend(phases);
  renderMetricCards(sessionMetrics, phaseMetrics);
  renderCharts(allRows,allValid, phases);
  renderTable(sessionMetrics, phaseMetrics);
  summaryData = { session: sessionMetrics, phases: phaseMetrics };
}

//takes the data and updates the ui
function renderLegend(phases) {
  const legend = document.getElementById('phaseLegend');
  legend.innerHTML = '';
  phases.forEach((p, i) => {
    const c = PHASE_COLORS[i % PHASE_COLORS.length];
    const badge = document.createElement('span');
    badge.className = 'phase-badge';
    badge.style.background = c.bg;
    badge.style.color = c.text;
    badge.innerHTML = `<span class="phase-dot" style="background:${c.border}"></span>${p.label}`;
    legend.appendChild(badge);
  });
  if (phases.length > 1) {
    const badge = document.createElement('span');
    badge.className = 'phase-badge';
    badge.style.background = '#F1EFE8';
    badge.style.color = '#444441';
    badge.innerHTML = `<span class="phase-dot" style="background:#888780"></span>Full session`;
    legend.appendChild(badge);
  }
}

//creates the stat cards 
function renderMetricCards(s, phaseMetrics) {
  const grid = document.getElementById('metricsGrid');
  const metrics = [
    { label: 'RMSSD', key: 'rmssd', unit: 'ms' },
    { label: 'Mean HR', key: 'meanHR', unit: 'bpm' },
    { label: 'SDNN', key: 'sdnn', unit: 'ms' },
    { label: 'pNN50', key: 'pnn50', unit: '%' },
  ];

  grid.innerHTML = metrics.map(m => {
    const phases = phaseMetrics.map((p, i) => {
      const c = PHASE_COLORS[i % PHASE_COLORS.length];
      return `<div style="font-size:11px;color:${c.border};margin-top:4px">${p.label}: ${p.m[m.key]} ${m.unit}</div>`;
    }).join('');
    return `
      <div class="metric-card">
        <div class="label">${m.label}</div>
        <div class="value">${s[m.key]}<span class="unit">${m.unit}</span></div>
        ${phases}
      </div>`;
  }).join('');
}


//this function draws the two grpahs 
function renderCharts(allRows, validHeartbeats, phases) {
  const sessionStartRow = allRows.find(r => (r.event || '').includes('SESSION_START'));
  const chartStartTime = sessionStartRow
  ? parseFloat(sessionStartRow.timestamp_ms)
  : parseFloat(validHeartbeats[0].timestamp_ms)

  const rrData = validHeartbeats.map(r => ({
    x: ((parseFloat(r.timestamp_ms) - chartStartTime) / 1000).toFixed(2),
    y: parseFloat(r.rr_ms)
  }));
  const hrData = validHeartbeats.map(r => ({
    x: ((parseFloat(r.timestamp_ms) - chartStartTime) / 1000).toFixed(2),
    y: parseFloat(r.hr_bpm)
  }));

  const annotations = {};
  phases.forEach((p, i) => {
    if (i === 0) return;
    const t = parseFloat(p.rows[0].timestamp_ms);
    const xVal = ((t - chartStartTime) / 1000).toFixed(2);
    const c = PHASE_COLORS[i % PHASE_COLORS.length];
    annotations['line' + i] = {
      type: 'line', xMin: xVal, xMax: xVal,
      borderColor: c.border, borderWidth: 1.5, borderDash: [4, 3],
      label: {
        content: p.label,
        display: true,
        position: 'start',
        color: c.text,
        backgroundColor: c.bg,
        font: { size: 11 },
        padding: 4,
        yAdjust: 8
      }
    };

  });

  const phaseBackgrounds = phases.map((p, i) => {
    const c = PHASE_COLORS[i % PHASE_COLORS.length];
    const xMin = ((parseFloat(p.rows[0].timestamp_ms) - chartStartTime) / 1000).toFixed(2);
    const xMax = ((parseFloat(p.rows[p.rows.length - 1].timestamp_ms) - chartStartTime) / 1000).toFixed(2);
    return { type: 'box', xMin, xMax, backgroundColor: c.bg + '55', borderWidth: 0 };
  });

  const allAnnotations = { ...annotations };
  phaseBackgrounds.forEach((b, i) => { allAnnotations['bg' + i] = b; });

  if (rrChartInst) rrChartInst.destroy();
  if (hrChartInst) hrChartInst.destroy();

  const makeOptions = (ylabel, annots) => ({
    responsive: true, maintainAspectRatio: false,
    animation: false,
    elements: { point: { radius: 0 }, line: { borderWidth: 1.5, tension: 0.2 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: { label: ctx => `${ctx.parsed.y.toFixed(1)} ${ylabel}` }
      },
      annotation: { annotations: annots }
    },
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: 'Time (s)', font: { size: 11 }, color: '#888780' },
        ticks: { font: { size: 11 }, color: '#888780' },
        grid: { color: '#F1EFE8' }
      },
      y: {
        title: { display: true, text: ylabel, font: { size: 11 }, color: '#888780' },
        ticks: { font: { size: 11 }, color: '#888780' },
        grid: { color: '#F1EFE8' }
      }
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

//this builds the summary table 
function renderTable(session, phaseMetrics) {
  const metrics = [
    { label: 'Beat count', key: 'count', unit: 'beats' },
    { label: 'Mean RR', key: 'meanRR', unit: 'ms' },
    { label: 'Mean HR', key: 'meanHR', unit: 'bpm' },
    { label: 'RMSSD', key: 'rmssd', unit: 'ms' },
    { label: 'SDNN', key: 'sdnn', unit: 'ms' },
    { label: 'pNN50', key: 'pnn50', unit: '%' },
    { label: 'Min RR', key: 'minRR', unit: 'ms' },
    { label: 'Max RR', key: 'maxRR', unit: 'ms' },
    { label: 'Duration', key: 'duration', unit: 's' },
  ];

  const table = document.getElementById('summaryTable');
  const phaseCols = phaseMetrics.map((p, i) => {
    const c = PHASE_COLORS[i % PHASE_COLORS.length];
    return `<th style="color:${c.text}">${p.label}</th>`;
  }).join('');

  const sessionCol = phaseMetrics.length > 0 ? '<th>Full session</th>' : '';

  table.innerHTML = `
    <thead><tr>
      <th>Metric</th><th>Unit</th>
      ${phaseCols}
      ${sessionCol}
    </tr></thead>
    <tbody>
      ${metrics.map(m => {
        const phaseCells = phaseMetrics.map((p, i) => {
          const c = PHASE_COLORS[i % PHASE_COLORS.length];
          return `<td style="color:${c.text};font-weight:500">${p.m[m.key]}</td>`;
        }).join('');
        const sessionCell = phaseMetrics.length > 0 ? `<td>${session[m.key]}</td>` : '';
        return `<tr>
          <td class="metric-name">${m.label}</td>
          <td class="unit-cell">${m.unit}</td>
          ${phaseCells}
          ${sessionCell}
        </tr>`;
      }).join('')}
    </tbody>`;
}

//this lets the user downlaod the chart as an image
function downloadChart(id, filename) {
  const canvas = document.getElementById(id);
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

// this function allows the user to download the resuts as a csv

function downloadCSV() {
  if (!summaryData.session) return;
  const metrics = [
    { label: 'Beat count', key: 'count', unit: 'beats' },
    { label: 'Mean RR', key: 'meanRR', unit: 'ms' },
    { label: 'Mean HR', key: 'meanHR', unit: 'bpm' },
    { label: 'RMSSD', key: 'rmssd', unit: 'ms' },
    { label: 'SDNN', key: 'sdnn', unit: 'ms' },
    { label: 'pNN50', key: 'pnn50', unit: '%' },
    { label: 'Min RR', key: 'minRR', unit: 'ms' },
    { label: 'Max RR', key: 'maxRR', unit: 'ms' },
    { label: 'Duration', key: 'duration', unit: 's' },
  ];

  const phaseHeaders = summaryData.phases.map(p => p.label).join(',');
  const sessionHeader = summaryData.phases.length > 0 ? ',Full session' : '';
  let csv = `Metric,Unit,${phaseHeaders}${sessionHeader}\n`;

  metrics.forEach(m => {
    const phaseCells = summaryData.phases.map(p => p.m[m.key]).join(',');
    const sessionCell = summaryData.phases.length > 0 ? ',' + summaryData.session[m.key] : '';
    csv += `${m.label},${m.unit},${phaseCells}${sessionCell}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.download = 'walter_summary.csv';
  link.href = URL.createObjectURL(blob);
  link.click();
}

//clears everthing and goes back to the upload screen 
function resetApp() {
  uploadCard.style.display = 'block';
  results.style.display = 'none';
  fileInput.value = '';
  hideError();
  if (rrChartInst) { rrChartInst.destroy(); rrChartInst = null; }
  if (hrChartInst) { hrChartInst.destroy(); hrChartInst = null; }
}
