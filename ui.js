import { PHASE_COLORS, appState } from "./config.js";
import { generateMethodsStatement, generateAPAReport } from "./export.js";
import { parseFilenameMeta } from "./fileParser.js";

export function showError(msg) {
  errorBox.textContent = msg;
  errorBox.style.display = 'block';
}

export function hideError() { errorBox.style.display = 'none'; }

export function renderMetricCards(s, phaseMetrics) {
  const grid    = document.getElementById('metricsGrid');
  const metrics = [
    { label: 'RMSSD',   key: 'rmssd',  unit: 'ms', desc: 'Root Mean Square of Successive Differences'  },
    { label: 'Mean HR', key: 'meanHR', unit: 'bpm', desc: 'Average Heart Rate in beats per minute' },
    { label: 'SDNN',    key: 'sdnn',   unit: 'ms', desc: 'Standard Deviation of NN intervals'  },
    { label: 'pNN50',   key: 'pnn50',  unit: '%', desc: 'Percentage of NN intervals that differ by more than 50ms'   },
  ];
  grid.innerHTML = metrics.map(m => {
    const phases = phaseMetrics.map((p, i) => {
      const c = PHASE_COLORS[i % PHASE_COLORS.length];
      return `<div style="font-size:11px;color:${c.border};margin-top:4px">${p.label}: ${p.m ? p.m[m.key] : '—'} ${m.unit}</div>`;
    }).join('');
    return `
      <div class="metric-card">
        <div class="label" title = "${m.desc}">${m.label}</div>
        <div class="value">${s ? s[m.key] : '—'}<span class="unit">${m.unit}</span></div>
        ${phases}
      </div>`;
  }).join('');
}

// Renders the summary metrics table with one column per phase, change scores, and full session
export function renderTable(session, phaseMetrics, sessionFreq, phaseFreq) {
  const metrics = [
    { label: 'Beat count', key: 'count',    unit: 'beats', desc: 'Total number of heartbeats detected' },
    { label: 'Mean RR',    key: 'meanRR',   unit: 'ms',    desc: 'Average time between successive heart'    },
    { label: 'Mean HR',    key: 'meanHR',   unit: 'bpm',   desc: 'Average Heart Rate in beats per minute'   },
    { label: 'RMSSD',      key: 'rmssd',    unit: 'ms',    desc: 'Root Mean Square of Successive Differences'    },
    { label: 'SDNN',       key: 'sdnn',     unit: 'ms',    desc: 'Standard Deviation of NN intervals'    },
    { label: 'pNN50',      key: 'pnn50',    unit: '%',     desc: 'Percentage of succesive NN intervals that vary by more than 50ms'     },
    { label: 'Min RR',     key: 'minRR',    unit: 'ms',    desc: 'Shortest interval between heartbeats'    },
    { label: 'Max RR',     key: 'maxRR',    unit: 'ms',    desc: 'Longest interval between heartbeats'    },
    { label: 'Duration',   key: 'duration', unit: 's',     desc: 'Total duration of the recording or phase'     },
  ];

  const table     = document.getElementById('summaryTable');
  const phaseCols = phaseMetrics.map((p, i) => {
    const c = PHASE_COLORS[i % PHASE_COLORS.length];
    return `<th style="color:${c.text}">${p.label}</th>`;
  }).join('');

  // Show change scores only when there are exactly 2 phases
  // Change = Phase 2 minus Phase 1 (absolute and percentage)
 const showChange = phaseMetrics.length === 2 &&
                     phaseMetrics[0].m &&
                     phaseMetrics[1].m;

  const changeHeaders = showChange
    ? `<th style="color:#444441;">Change (abs)</th>
       <th style="color:#444441;">Change (%)</th>`
    : '';

  const sessionCol = phaseMetrics.length > 0 ? '<th>Full session</th>' : '';

  table.innerHTML = `
    <thead><tr>
      <th>Metric</th><th>Unit</th>
      ${phaseCols}
      ${changeHeaders}
      ${sessionCol}
    </tr></thead>
    <tbody>
      ${metrics.map(m => {
        const phaseCells = phaseMetrics.map((p, i) => {
          const c   = PHASE_COLORS[i % PHASE_COLORS.length];
          const val = p.m ? p.m[m.key] : '—';
          return `<td style="color:${c.text};font-weight:500">${val}</td>`;
        }).join('');

        // Calculate absolute and percentage change between Phase 1 and Phase 2
        let changeCells = '';
        if (showChange) {
          const v1  = parseFloat(phaseMetrics[0].m[m.key]);
          const v2  = parseFloat(phaseMetrics[1].m[m.key]);
          const abs = v2 - v1;
          const pct = v1 !== 0 ? (abs / v1) * 100 : 0;

          // Colour: red for increase, blue for decrease, gray for no change
          const absColor = abs > 0 ? '#993C1D' : abs < 0 ? '#185FA5' : '#888780';
          const sign     = abs > 0 ? '+' : '';

          changeCells = `
            <td style="color:${absColor};font-weight:500">
              ${sign}${abs.toFixed(2)}
            </td>
            <td style="color:${absColor};font-weight:500">
              ${sign}${pct.toFixed(1)}%
            </td>`;
        }

        const sessionCell = phaseMetrics.length > 0
          ? `<td>${session ? session[m.key] : '—'}</td>`
          : '';

        return `<tr>
          <td class="metric-name" title = "${m.desc}">${m.label}</td>
          <td class="unit-cell">${m.unit}</td>
          ${phaseCells}
          ${changeCells}
          ${sessionCell}
        </tr>`;
      }).join('')}
    </tbody>`;

  // Add frequency domain rows if data is available
  if (phaseFreq && phaseFreq.length > 0) {
    const freqMetrics = [
      { label: 'LF power', key: 'lf',   unit: 'ms²', desc: 'Low Frequency power' },
      { label: 'HF power', key: 'hf',   unit: 'ms²', desc: 'High Frequency power' },
      { label: 'LF/HF',    key: 'lfhf', unit: ''   , desc: 'Ratio of Low High Frequency power' },
    ];

    const warnings = phaseFreq.filter(p => p.f.warning).map(p => p.label);

    const freqRows = freqMetrics.map(m => {
      const phaseCells = phaseFreq.map((p, i) => {
        const c   = PHASE_COLORS[i % PHASE_COLORS.length];
        const val = p.f[m.key] ?? '—';
        return `<td style="color:${c.text};font-weight:500">${val}</td>`;
      }).join('');

      const sessionCell = phaseFreq.length > 0
        ? `<td>${sessionFreq ? sessionFreq[m.key] ?? '—' : '—'}</td>`
        : '';

      // Change scores not applicable for frequency domain metrics
      const changeCell = phaseMetrics.length === 2 ? `<td>—</td><td>—</td>` : '';

      return `<tr>
        <td class="metric-name" title = "${m.desc}">${m.label}</td>
        <td class="unit-cell">${m.unit}</td>
        ${phaseCells}
        ${changeCell}
        ${sessionCell}
      </tr>`;
    }).join('');

    table.querySelector('tbody').innerHTML += freqRows;

    // Show warning if any phase was too short for reliable analysis
    if (warnings.length > 0) {
      table.querySelector('tbody').innerHTML += `
        <tr>
          <td colspan="20" style="font-size:11px;color:#888780;padding:8px 12px;">
            ⚠ Frequency domain: recording too short for reliable analysis in ${warnings.join(', ')} (minimum 60s per phase recommended)
          </td>
        </tr>`;
    }
  }
}

export function toggleDarkMode(){
    document.body.classList.toggle('dark')
}

export function switchTab(tab) {
  const panelSingle = document.getElementById('panelSingle');
  const panelBatch  = document.getElementById('panelBatch');
  const tabSingle   = document.getElementById('tabSingle');
  const tabBatch    = document.getElementById('tabBatch');
  const tabAbout    = document.getElementById('tabAbout');

  if (tab === 'single') {
    panelSingle.style.display = 'block';
    panelBatch.style.display  = 'none';
    panelAbout.style.display = 'none'

    tabSingle.style.borderBottom = '2px solid #185FA5';
    tabSingle.style.color        = '#185FA5';

    tabBatch.style.borderBottom  = '2px solid transparent';
    tabBatch.style.color         = '#5F5E5A';

    tabAbout.style.borderBottom  = '2px solid transparent';
    tabAbout.style.color         = 'green'

  } else if (tab === 'batch') {
    panelSingle.style.display = 'none';
    panelBatch.style.display  = 'block';
    panelAbout.style.display = 'none'

    tabSingle.style.borderBottom = '2px solid transparent';
    tabSingle.style.color        = '#5F5E5A';

    tabBatch.style.borderBottom  = '2px solid #185FA5';
    tabBatch.style.color         = '#185FA5';

    tabAbout.style.borderBottom = '2px solid transparent';
    tabAbout.style.color = 'green'
  }

  else if (tab === 'about'){

    panelSingle.style.display = 'none';
    panelBatch.style.display = 'none';
    panelAbout.style.display = 'block'
    
    tabSingle.style.borderBottom = '2px solid transparent';
    tabSingle.style.color = "green";

    tabBatch.style.borderBottom = '2px solid transparent';
    tabBatch.style.color = "orange";

    tabAbout.style.borderBottom = '2px solid blue';
    tabAbout.style.color = 'pink';

  }

  
}

export function renderSessionMeta(fileName,sessionMetrics){
    const box = document.getElementById("sessionMeta");
    if(!box) return;
    const meta = parseFilenameMeta(fileName);

    // Show a Harvey Duo badge next to the participant ID if applicable
    const duoBadge = meta.isDuo
      ? `<span style="font-size:11px;background:#EAF3DE;color:#27500A;
                      padding:2px 8px;border-radius:10px;margin-left:8px;">
           Harvey Duo · Device ${meta.duoSuffix}
         </span>`
      : '';

    box.innerHTML = `
    <p><strong>Filename:</strong> ${meta.filename}</p>
    <p><strong>Participant ID:</strong> ${meta.participantID}${duoBadge}</p>
    <p><strong>H10 sensor:</strong> ${meta.h10Mac}</p>
    <p><strong>Date:</strong> ${meta.date}</p>
    <p><strong>Time:</strong> ${meta.time}</p>
    <p><strong>Total duration:</strong> ${sessionMetrics.duration}s</p>
    `;
}

export function renderLegend(phases) {
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

export function renderArtefactPanel(currentMethod, currentThreshold) {
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
  document.getElementById("results").insertBefore(panel, metricsGrid);

  attachArtefactListeners();
}

// Attach change listeners to the radio buttons and threshold slider
export function attachArtefactListeners() {
  document.querySelectorAll('input[name="artefactMethod"]').forEach(radio => {
    radio.addEventListener('change', window.onSettingsChange);
  });
  const slider = document.getElementById('thresholdSlider');
  if (slider) {
    slider.addEventListener('input', () => {
      document.getElementById('thresholdLabel').textContent = slider.value + '%';
      window.onSettingsChange();
    });
  }
}

// Returns the currently selected artefact method from the radio buttons
export function getArtefactMethod() {
  const checked = document.querySelector('input[name="artefactMethod"]:checked');
  return checked ? checked.value : 'interpolate';
}

// Returns the current threshold slider value as an integer
export function getThreshold() {
  const slider = document.getElementById('thresholdSlider');
  return slider ? parseInt(slider.value) : 20;
}

export function renderQualitySummary(phaseQuality){
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
                <td>${p.q.heartBeatDataTotal}</td>
                <td>${p.q.HeartBeatDataretained}</td>
                <td>${p.q.messedUpBeats}</td>
                <td>${p.q.rating} (${p.q.percentRetained}%)</td>
                </tr>
            `).join('')}
    </tbody>

    `;
   
}

// Render the batch summary table in the UI
export function renderBatchTable(rows) {
  const table = document.getElementById('batchTable');
  if (!table || rows.length === 0) return;

  const headers = Object.keys(rows[0]);

  table.innerHTML = `
    <thead>
      <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
    </thead>
    <tbody>
      ${rows.map(row => `
        <tr>${headers.map(h => `<td>${row[h] ?? '—'}</td>`).join('')}</tr>
      `).join('')}
    </tbody>`;
}

export function renderGroupSummaryTable(rows) {
  const table = document.getElementById('groupSummaryTable');
  if (!table) return;

  // Get all column names except ParticipantID
  const allCols   = Object.keys(rows[0]).filter(k => k !== 'ParticipantID');

  // Group columns by metric name (e.g. RMSSD) across phases
  // Column format: Phase1_RMSSD → phase: Phase1, metric: RMSSD
  const metrics = [...new Set(allCols.map(c => c.split('_').slice(1).join('_')))];
  const phases  = [...new Set(allCols.map(c => c.split('_')[0]))];

  // Calculate mean and SD for each column
  function mean(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  function sd(arr) {
    const m = mean(arr);
    return Math.sqrt(arr.map(v => (v - m) ** 2).reduce((a, b) => a + b, 0) / arr.length);
  }

  // Build header row with one column per phase
  const phaseHeaders = phases.map((p, i) => {
    const c = PHASE_COLORS[i % PHASE_COLORS.length];
    return `<th style="color:${c.text}">${p.replace(/_/g, ' ')}</th>`;
  }).join('');

  // Build one row per metric
  const bodyRows = metrics.map(metric => {
    const cells = phases.map((phase, i) => {
      const col    = `${phase}_${metric}`;
      const values = rows.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
      if (values.length === 0) return `<td>—</td>`;
      const c      = PHASE_COLORS[i % PHASE_COLORS.length];
      const m      = mean(values).toFixed(2);
      const s      = sd(values).toFixed(2);
      return `<td style="color:${c.text};font-weight:500">${m} ± ${s}</td>`;
    }).join('');
    return `<tr>
      <td class="metric-name">${metric.replace(/_/g, ' ')}</td>
      ${cells}
    </tr>`;
  }).join('');

  table.innerHTML = `
    <thead><tr>
      <th>Metric</th>${phaseHeaders}
    </tr></thead>
    <tbody>${bodyRows}</tbody>`;
}

// Copies the methods statement text to the clipboard
export function copyMethodsStatement() {
  const stmt = document.getElementById('methodsStatement');
  if (!stmt) return;
  navigator.clipboard.writeText(stmt.value).then(() => {
    const btn      = stmt.nextElementSibling;
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  });
}

export function showAPAReport(){
  const report = generateAPAReport();
  document.getElementById(`apaReportBox`).value = report;
}

export function buildDemographicsHTML(participantID){

  const data = appState.demographics.get(participantID) || {};
  let html = `<div style = "margin-top: 8px; padding: 10px 14px; background: beige; border: 1px solid tan; border-radius: 4px; display: flex; gap: 12px; flex-wrap: wrap; align-items: center; box-shadow: inset 0 1px 3px rgba(0,0,0,0,02);">`;

  appState.demographicFields.forEach(field => {
    const val = data[field] || '';
    html += ` 
    
    <label style = "display:flex; flex-direction: column; gap: 4px; font-family: 'Georgia', serif;">
    <span style = "font-size:11px; color: saddlebrown; font-weight: 600; text-transform: uppercase;">${field}</span>
    <input type = "text" value = "${val}"
    style = "width: 90px; font-size: 13px; padding:4px 6px; border: 1px solid gray; border-radius:4px; background:white;"
    onchange = "updateDemographicValue('${participantID}', '${field}',this.value)">
    </label>
    `;
  });

  html += `<button class = "btn btn-sm" style = "font-size: 11px; height: fit-content; align-self: flex-end; background:white; border-color:tan; color: saddlebrown;" onclick = "addDemographicField()">+ Add Field</button>`;
  html += '</div>';
  return html;
}

export function renderManifest(manifest){
  document.getElementById('dropZone').style.display = 'none';
  document.getElementById('manifestPanel').style.display = 'block';

  const listEl = document.getElementById('manifestList');
  const warnEl = document.getElementById('manifestWarnings');

  warnEl.innerHTML = manifest.warnings.length > 0 ? manifest.warnings.map(w => `${w}`).join('<br>') : '';

  let html = '<div style = "display: flex; flex-direction:column; gap:16px;">';


  manifest.sessions.forEach((s,index) => {
    let name = s.baseID;
    let type = 'Solo session';
    if(s.kind == 'duo-pair') {name = `${s.baseID}.1 + ${s.baseID}.2`; type = 'Harvey Duo pair'; }
    else if( s.kind === 'duo-unmatched') {name = `${s.baseID}${s.meta.duoSuffix || ''}`; type = `Duo ${s.missingPair}`;}

    html += `
    
    <div style = "border: 1px solid gray; border-radius: 6px; padding: 12px; background:white;">
    <div style = "display: flex; justify-content: space-between; align-items: center;">
    <div style = "display: flex; align-items: center; gap: 12px;">
    <strong style = "font-size: 14px; color: black;">${name}</strong>
    <span style = "font-size: 12px; color:gray;">${type}</span>
    </div>
    <button class = "btn btn-sm" onclick = "removeManifestItem(${index})"> Remove</button>
    </div>
    ${buildDemographicsHTML(s.baseID)}
    </div>`;
    
  });

  manifest.demographics.forEach((d,index) => {
    html += `
    
    <div style = "border: 1px dashed green; border-radius:6px; padding: 12px; background: honeydew; display: flex; justify-content: space-between; align-items:center;">
    <div style = "display: flex; align-items: center; gap: 12px;">
    <strong style = "font-size: 14px; color: darkgreen;">${d.name}</strong>
    <span style = "font-size: 12px; color:green;"> Demographics file(Matched via ParticipantID)</span>
    </div>
    <button class = "btn btn-sm" style = "border-color: lightgreen; color: darkgreen; background:white;" onclick = "removeDemographicItem(${index})"> Remove </button>
    </div>`;
  });

  html += '</div>';
  listEl.innerHTML = html;
};

