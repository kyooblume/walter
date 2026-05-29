

import { appState } from "./config.js";
import { getValidRows, calcMetrics,calculateDataQuality, calcFrequencyDomain, calcSynchrony } from "./HRVMaths.js";
import { renderCharts, renderPoincare, renderTrajectoryChart, renderHistogram, renderRmssdOverTime, renderAccelerometer, resetZoom, applyAPA7Style, resetChartStyle } from "./chart.js";
import { buildPhases, parseBatchFile, classifyFiles } from "./fileParser.js";
import { showError, hideError, renderSessionMeta, renderLegend, renderMetricCards, renderTable, switchTab, toggleDarkMode, getArtefactMethod, getThreshold, renderBatchTable, renderGroupSummaryTable, copyMethodsStatement, renderArtefactPanel, renderQualitySummary, showAPAReport, renderManifest,buildDemographicsHTML } from "./ui.js";
import { downloadChart, copyChart, generateMethodsStatement, downloadQualityCSV, downloadCSV } from "./export.js";


// ----- Get DOM elements -----
const dropZone    = document.getElementById('dropZone');
const folderInput = document.getElementById('folderInput');
const fileInput   = document.getElementById('fileInput');
const uploadCard  = dropZone; // dropZone doubles as the upload card — no separate #uploadCard in HTML
const errorBox    = document.getElementById('errorBox');
const results     = document.getElementById('results');

// Stores the current manifest between file drops and processing
let currentManifest = null;

// Trigger file processing when user selects a file via the input
if(window.Chart && window.ChartAnnotation){
  Chart.register(window.ChartAnnotation);
}

fileInput.addEventListener('change', (event) => {
  const files = Array.from(event.target.files);
  processIncomingFiles(files);
});


if(folderInput){
  folderInput.addEventListener('change', (event) => {
    const files = Array.from(event.target.files);
    processIncomingFiles(files);
  });
}

if(dropZone){
  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('dragover');
  });


  dropZone.addEventListener('dragleave', () =>{
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (event) =>{
    event.preventDefault();
    dropZone.classList.remove('dragover');
    const files = Array.from(event.dataTransfer.files);
    processIncomingFiles(files);
  });
};

async function processIncomingFiles(files) {
  const csvFiles = files.filter(f => f.name.toLowerCase().endsWith('.csv'));

  if (csvFiles.length === 0) {
    alert("No CSV files found, Try again");
    return;
  }

  // Merge with any files already in the manifest (incremental adding)
  const existingFiles = currentManifest ? currentManifest.rawFiles : [];
  const allFiles      = [...existingFiles, ...csvFiles];

  // Classify files into solo / duo-pair / duo-unmatched / demographics
  const manifest    = await classifyFiles(allFiles);
  manifest.rawFiles = allFiles;
  currentManifest   = manifest;


  if (manifest.demographics.length > 0) {
    for (const file of manifest.demographics) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          res.data.forEach(row => {
            if (row.ParticipantID) {
              const id = row.ParticipantID.trim();
              const existing = appState.demographics.get(id) || {};
              appState.demographics.set(id, { ...existing, ...row });

              Object.keys(row).forEach(key => {
                if (key !== 'ParticipantID' && !appState.demographicFields.includes(key)) {
                  appState.demographicFields.push(key);
                }
              });
            }
          });
        }
      });
    }
  }

  // Show the manifest panel so the user can review before processing
  renderManifest(manifest);
}

// ---- Duo Pair Processing (Task 4.1) ----
// Process two Harvey files from a Duo pair:
// 1. Clock alignment — synchronize timestamps
// 2. Phase structure — apply file1's phases to file2
// 3. Metrics & Synchrony — compute per-participant metrics and their correlation
async function processDuoPair(session, method, threshold) {
  const file1 = session.file1;
  const file2 = session.file2;

  // Parse both files
  const allRows1 = await new Promise((resolve, reject) => {
    Papa.parse(file1, {
      header: true,
      skipEmptyLines: true,
      complete: res => resolve(res.data),
      error: reject
    });
  });

  const allRows2 = await new Promise((resolve, reject) => {
    Papa.parse(file2, {
      header: true,
      skipEmptyLines: true,
      complete: res => resolve(res.data),
      error: reject
    });
  });

  if (!allRows1 || !allRows2) return null;

  // Step 1: Clock alignment
  // Find SESSION_START events and calculate offset
  const sessionStart1 = allRows1.find(r => (r.event || '').includes('SESSION_START'));
  const sessionStart2 = allRows2.find(r => (r.event || '').includes('SESSION_START'));

  let clockOffset = 0;
  if (sessionStart1 && sessionStart2) {
    const ts1 = parseFloat(sessionStart1.timestamp_ms);
    const ts2 = parseFloat(sessionStart2.timestamp_ms);
    if (!isNaN(ts1) && !isNaN(ts2)) {
      clockOffset = ts2 - ts1;
      // Apply offset to file2
      allRows2.forEach(r => {
        const ts = parseFloat(r.timestamp_ms);
        if (!isNaN(ts)) {
          r.timestamp_ms = (ts - clockOffset).toString();
        }
      });
    }
  }

  // Step 2: Phase structure from file1
  const phases = buildPhases(allRows1);

  // Step 3: Per-participant metrics and synchrony
  const result1 = await parseBatchFile(file1, method, threshold);
  const result2 = await parseBatchFile(file2, method, threshold);

  if (!result1 || !result2) return null;

  // Calculate synchrony for each phase
  const synchrony = phases.map(p => {
    const phaseValid1 = getValidRows(p.rows);
    const phaseValid2 = getValidRows(
      allRows2.filter(r => parseInt(r.phase, 10) === p.phaseNumber)
    );

    if (phaseValid1.length === 0 || phaseValid2.length === 0) {
      return { phase: p.label, r: null, warning: true };
    }

    return {
      phase: p.label,
      ...calcSynchrony(phaseValid1, phaseValid2)
    };
  });

  // Add synchrony columns to results
  const row1 = { ...result1 };
  const row2 = { ...result2 };

  synchrony.forEach(s => {
    const colName = `${s.phase.replace(/\s+/g, '')}_Synchrony_r`;
    row1[colName] = s.r || '—';
    row2[colName] = s.r || '—';
  });

  return { row1, row2, synchrony };
}

// ---- Manifest processing ----

async function initManifestProcessing() {
  if (!currentManifest || currentManifest.sessions.length === 0) return;
  await processManifest(currentManifest);
}

const btnProcess = document.getElementById('btnProcessManifest');
if (btnProcess) btnProcess.addEventListener('click', initManifestProcessing);

// Process all sessions and render the output table
async function processManifest(manifest) {
  const progressEl  = document.getElementById('outputProgress');
  const outputPanel = document.getElementById('outputPanel');

  outputPanel.style.display = 'block';
  progressEl.style.display  = 'block';

  const method    = getArtefactMethod();
  const threshold = getThreshold();
  if(!appState.outputResults) appState.outputResults = [];
  const results   = appState.outputResults;
  const errors    = [];

  // Filter out unmatched Duo files if the checkbox is ticked
  const excludeUnmatched = document.getElementById('excludeUnmatchedDuo')?.checked;
  const sessions = manifest.sessions.filter(s =>
    !(excludeUnmatched && s.kind === 'duo-unmatched')
  );

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];

    const alreadyProcessed = results.find( r => r.ParticipantID === s.baseID || r.PairID === s.baseID);
    if(alreadyProcessed){
      continue
    }

    progressEl.textContent = `Processing ${i + 1} of ${sessions.length}: ${s.baseID}...`;

    try {
      let rowsToAdd = [];

      if (s.kind === 'solo' || s.kind === 'duo-unmatched') {
        // Single file — use existing parseBatchFile
        const row = await parseBatchFile(s.file || s.file1, method, threshold);
        if (row){

        const details = row._details;
        delete row.ParticipantID;
        const demogs = appState.demographics.get(s.baseID) || {};
        const participantID = s.kind === 'solo'
          ? s.baseID
          : (s.baseID + (s.meta?.duoSuffix ? '.' + s.meta.duoSuffix : ''));
        const orderedRow = {
          ParticipantID: participantID,
          PairID: '',
          IsDuoPaired: false,
          ...demogs,
          ...row
        };
        rowsToAdd.push(orderedRow);

        // Keep the raw parsed data so clicking the tray row can render
        // this participant's individual charts. (Map keyed by display ID.)
        if (!appState.sessionDetails) appState.sessionDetails = new Map();
        if (details) appState.sessionDetails.set(participantID, details);
        }

      } else if (s.kind === 'duo-pair') {
        // Duo pair — process both files with synchrony calculation
        const duoResult = await processDuoPair(s, method, threshold);
        if (duoResult) {
          const details1 = duoResult.row1._details;
          const details2 = duoResult.row2._details;
          delete duoResult.row1.ParticipantID;
          delete duoResult.row2.ParticipantID;
          const demogs = appState.demographics.get(s.baseID) || {};
          const orderedRow1 = { 
            ParticipantID: `${s.baseID}.1`, 
            PairID: s.baseID, 
            IsDuoPaired: true, 
            ...demogs,
            ...duoResult.row1
          };
          const orderedRow2 = { 
            ParticipantID: `${s.baseID}.2`, 
            PairID: s.baseID, 
            IsDuoPaired: true, 
            ...demogs,
            ...duoResult.row2
          };
          rowsToAdd.push(orderedRow1, orderedRow2);

          // Persist details for both participants in the pair
          if (!appState.sessionDetails) appState.sessionDetails = new Map();
          if (details1) appState.sessionDetails.set(`${s.baseID}.1`, details1);
          if (details2) appState.sessionDetails.set(`${s.baseID}.2`, details2);
        }
      }

      if(rowsToAdd.length > 0){
        results.push(... rowsToAdd)
      }
      else{
      errors.push(`${s.baseID}: could not process`);
      }
      
    } 
    catch (err) {
      errors.push(`${s.baseID}: ${err.message}`);
    }
  }

  progressEl.style.display = 'none';
  if (errors.length > 0) showError(`Some files could not be processed: ${errors.join(' | ')}`);
  if (results.length > 0) {
    appState.outputResults = results;

    document.getElementById('manifestPanel').style.display = 'none'

    // ── Show header controls now that data is loaded ──────────────────
    // Without this, users coming through the manifest path (the common path)
    // never see "+ Add files" or the Charts dropdown in the header.
    document.getElementById('btnHeaderAddFiles').style.display    = 'inline-block';
    document.getElementById('headerChartsDropdown').style.display = 'block';

    renderOutputTable(results);
    renderGroupSummaryTable(results)
    renderTrajectoryChart(results)
    renderSessionTray();

    // Auto-select the first session so the user sees a worked example
    // immediately instead of staring at "Results / Trajectory / Group summary"
    // with no individual chart on the page.
    if (results[0] && appState.sessionDetails?.get(results[0].ParticipantID)) {
      renderSessionFromDetails(
        appState.sessionDetails.get(results[0].ParticipantID),
        results[0].ParticipantID
      );
    }
  }
}




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

// Process all uploaded files one by one
async function processBatchFiles(files) {
  appState.batchResults = [];
  const progressEl = document.getElementById('batchProgress');
  const errorEl    = document.getElementById('batchError');
  const countEl    = document.getElementById('batchFileCount');

  progressEl.style.display = 'block';
  errorEl.style.display    = 'none';
  countEl.textContent      = `${files.length} file${files.length > 1 ? 's' : ''} selected`;

  const method    = getArtefactMethod();
  const threshold = getThreshold();
  const errors    = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    progressEl.textContent = `Processing ${i + 1} of ${files.length}: ${file.name}...`;

    try {
      const result = await parseBatchFile(file, method, threshold);
      if (result) {
        appState.batchResults.push(result);
      } else {
        errors.push(`${file.name}: could not process`);
      }
    } catch (err) {
      errors.push(`${file.name}: ${err.message}`);
    }
  }

  progressEl.style.display = 'none';

  if (errors.length > 0) {
    errorEl.style.display   = 'block';
    errorEl.textContent     = `Errors: ${errors.join(' | ')}`;
  }

  if (appState.batchResults.length > 0) {
    renderBatchTable(appState.batchResults);
    renderGroupVisualisation(appState.batchResults);
    document.getElementById('batchResults').style.display = 'block';
  }
}

// ============================================================
// Main render entry point — called after file upload and after settings changes
// ============================================================
function renderResults(fileName,allRows,allValid, phases) {
  uploadCard.style.display = 'none';
  results.style.display    = 'block';

  // Show header controls now that data is loaded
  document.getElementById('btnHeaderAddFiles').style.display    = 'inline-block';
  document.getElementById('headerChartsDropdown').style.display = 'block';

  appState.parsedAllValid = allValid;
  appState.parsedPhases = phases;
  appState.summaryData.allRows = allRows

  const method    = getArtefactMethod();
  const threshold = getThreshold();

  const sessionMetrics = calcMetrics(allValid, method, threshold);
  const phaseMetrics   = phases.map(p => {
    const validRows = getValidRows(p.rows);
    return { label: p.label, m: calcMetrics(validRows, method, threshold) };
  });

  // Calculate frequency domain metrics per phase and full session
  const sessionFreq = calcFrequencyDomain(allValid);
  const phaseFreq   = phases.map(p => ({
    label: p.label,
    f:     calcFrequencyDomain(getValidRows(p.rows))
  }));

  renderSessionMeta(fileName,sessionMetrics)

  const phaseQuality = phases.map((p,i) => {
    const validRows = getValidRows(p.rows);
    const metrics = phaseMetrics[i].m;
    return{
        label: p.label,
        q: calculateDataQuality(p.rows,validRows, metrics)
    };
  });

  renderLegend(phases);
  renderArtefactPanel(method, threshold);
  renderMetricCards(sessionMetrics, phaseMetrics);
  renderQualitySummary(phaseQuality);
  renderCharts(allValid, phases);
  renderPoincare(phases);
  renderTable(sessionMetrics, phaseMetrics, sessionFreq, phaseFreq);

  appState.summaryData = { session: sessionMetrics, phases: phaseMetrics, method, threshold, quality: phaseQuality, fileName, allRows, allValid, phasesRaw: phases };
}

// Called after batch processing completes
function renderGroupVisualisation(rows) {
  if (!rows || rows.length === 0) return;

  renderGroupSummaryTable(rows);
  renderTrajectoryChart(rows);
}

// Called whenever a setting changes — recalculates metrics and redraws table
// Uses the saved parsed data so the student does not need to re-upload
function onSettingsChange() {
  if (!appState.parsedAllValid || !appState.parsedPhases) return;

  const method    = getArtefactMethod();
  const threshold = getThreshold();

  // Grey out the slider when method is 'none' (threshold has no effect)
  const slider = document.getElementById('thresholdSlider');
  if (slider) slider.disabled = (method === 'none');

  // Update the methods statement text in real time
  const stmtEl = document.getElementById('methodsStatement');
  if (stmtEl) stmtEl.value = generateMethodsStatement(method, threshold);

  // Recalculate and redraw metrics and table only (charts are not redrawn for performance)
  const sessionMetrics = calcMetrics(appState.parsedAllValid, method, threshold);
  const phaseMetrics   = appState.parsedPhases.map(p => ({
    label: p.label,
    m: calcMetrics(getValidRows(p.rows), method, threshold)
  }));

  renderMetricCards(sessionMetrics, phaseMetrics);
  renderTable(sessionMetrics, phaseMetrics);

  appState.summaryData = { ...appState.summaryData, session: sessionMetrics, phases: phaseMetrics, method, threshold };
}



function updatePhaseLabel(phaseNumber,newLabel){
    appState.phaseLabels[phaseNumber] = newLabel.trim() || `Phase ${phaseNumber}`;

    const newPhases = buildPhases(appState.summaryData.allRows)

    renderResults(
        appState.summaryData.fileName,
        appState.summaryData.allRows,
        appState.summaryData.allValid,
        newPhases
    );
}

//clears everthing and goes back to the upload screen 
function resetApp() {
  uploadCard.style.display = 'block';
  results.style.display    = 'none';
  fileInput.value          = '';

  // Hide header controls until data is loaded again
  document.getElementById('btnHeaderAddFiles').style.display    = 'none';
  document.getElementById('headerChartsDropdown').style.display = 'none';
  document.getElementById('headerChartsPanel').style.display    = 'none';
  appState.parsedAllValid           = null;
  // Clear session notes when resetting
  const notesEl = document.getElementById('sessionNotes');
  if (notesEl) notesEl.value = '';
  appState.parsedPhases = null;
  hideError();

  if(Chart.getChart("rrChart")) Chart.getChart("rrChart").destroy();
  if(Chart.getChart("hrChart")) Chart.getChart("hrChart").destroy();
  if(Chart.getChart("poincareChart")) Chart.getChart("poincareChart").destroy();

}

function resetBatch() {
  // Legacy batch tab UI was replaced by the unified pipeline (Group 2).
  // Guard every lookup — the old DOM nodes no longer exist.
  appState.batchResults = [];
  const ids = ['batchResults', 'batchFileCount', 'batchError', 'batchFileInput'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'batchFileInput') el.value = '';
    else if (id === 'batchFileCount' || id === 'batchError') {
      el.textContent = '';
      el.style.display = 'none';
    } else el.style.display = 'none';
  });
  if (window.Chart && Chart.getChart("trajectoryChart")) {
    Chart.getChart("trajectoryChart").destroy();
  }
}

// keyabord shortcuts

//alt u to upload a file 
//alt m for dark mode 
document.addEventListener('keydown', (e) => {
  if ((e.altKey || e.metaKey) && e.key.toLowerCase() === 'u'){
    e.preventDefault();
    // Single unified path — always opens the main file input
    document.getElementById('fileInput').click();
  }

    if(e.altKey && e.key.toLowerCase() === 'm'){
      e.preventDefault();
      window.toggleDarkMode();
    }
  
});

// ---- Chart options panel toggle ----
function toggleChartOptionsPanel(chartId) {
  const panel = document.getElementById(`opts-${chartId}`);
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

// Re-render the relevant chart(s) after options are changed
function applyChartOptions(chartId) {
  if (!appState.parsedAllValid || !appState.parsedPhases) return;
  if (chartId === 'rrChart' || chartId === 'hrChart') {
    renderCharts(appState.parsedAllValid, appState.parsedPhases);
  } else if (chartId === 'poincareChart') {
    renderPoincare(appState.parsedPhases);
  } else if (chartId === 'histogramChart') {
    renderHistogram(appState.parsedAllValid, appState.parsedPhases);
  } else if (chartId === 'rmssdOverTimeChart') {
    renderRmssdOverTime(appState.parsedAllValid, appState.parsedPhases);
  } else if (chartId === 'accelerometerChart') {
    renderAccelerometer(appState.summaryData.allRows, appState.parsedPhases);
  }
}

// Backwards-compatible alias. The inline tachogram options panel used to call
// toggleChartSettings(), but the per-chart options now flow through
// applyChartOptions(). Keep the alias so existing HTML onchange handlers work.
function toggleChartSettings() {
  if (appState.parsedAllValid && appState.parsedPhases) {
    renderCharts(appState.parsedAllValid, appState.parsedPhases);
    renderPoincare(appState.parsedPhases);
  }
  if (appState.batchResults && appState.batchResults.length > 0) {
    renderTrajectoryChart(appState.batchResults);
  }
}

// ---- Chart visibility toggle (Task 3.2) ----
function toggleChart(chartId) {
  const cardId  = `card-${chartId}`;
  const card    = document.getElementById(cardId);

  // In single-file mode the Processing Options panel has these checkboxes;
  // in manifest mode only the header dropdown exists. Fall back to the header
  // version (prefix 'hdr_') so toggling charts works in BOTH modes.
  const checkboxIdMap = {
    'rrChart':            'chartTachogram',
    'hrChart':            'chartHR',
    'poincareChart':      'chartPoincare',
    'histogramChart':     'chartHistogram',
    'rmssdOverTimeChart': 'chartRmssd',
    'accelerometerChart': 'chartAccelerometer',
  };

  const procBox = document.getElementById(checkboxIdMap[chartId]);
  const hdrBox  = document.getElementById('hdr_' + checkboxIdMap[chartId]);
  const checkbox = procBox || hdrBox;
  if (!card || !checkbox) return;

  if (checkbox.checked) {
    card.style.display = 'block';
    if (appState.parsedAllValid && appState.parsedPhases) {
      if (chartId === 'rrChart' || chartId === 'hrChart') {
        renderCharts(appState.parsedAllValid, appState.parsedPhases);
      } else if (chartId === 'poincareChart') {
        renderPoincare(appState.parsedPhases);
      } else if (chartId === 'histogramChart') {
        renderHistogram(appState.parsedAllValid, appState.parsedPhases);
      } else if (chartId === 'rmssdOverTimeChart') {
        renderRmssdOverTime(appState.parsedAllValid, appState.parsedPhases);
      } else if (chartId === 'accelerometerChart') {
        renderAccelerometer(appState.summaryData.allRows, appState.parsedPhases);
      }
    }
  } else {
    card.style.display = 'none';
    const inst = Chart.getChart(chartId);
    if (inst) inst.destroy();
  }
}

// ---- Session Tray (Task 2.4) ----
// Shows persistent list of loaded sessions during/after processing
// Only visible when 2+ sessions loaded
function renderSessionTray() {
  const tray    = document.getElementById('sessionTray');
  const trayList = document.getElementById('trayList');
  if (!tray || !trayList || !currentManifest) return;

  const sessions = currentManifest.sessions;

  // Only show when 2+ sessions
  if (sessions.length < 2) {
    tray.style.display = 'none';
    return;
  }

  tray.style.display = 'block';

  trayList.innerHTML = sessions.map((s, i) => {
    const isDuo     = s.kind === 'duo-pair';
    const isWarn    = s.kind === 'duo-unmatched';
    const label     = isDuo ? `${s.baseID}.1 + ${s.baseID}.2` : s.baseID;
    const typeLabel = isDuo ? 'Duo pair' : isWarn ? `Duo — missing ${s.missingPair}` : 'Solo';

    return `
    <div class="tray-row" style= "flex-direction:column; align-items:stretch; cursor:default; padding: 12px 0;">
     <div style = "display: flex; align-items: center; gap:8px; cursor:pointer; width:100%;" onclick="onTrayRowClick(${i})">
      <span class="tray-dot ${isWarn ? 'warn' : ''}"></span>
      <span class="tray-id">${label}</span>
      <span class="tray-type">${typeLabel}</span>
      <button class="tray-remove" onclick="event.stopPropagation(); removeTraySession(${i})">✕</button>
    </div>`;
  }).join('');
}

window.updateDemographicValue = (participantID, field, value) => {
  const existing = appState.demographics.get(participantID) || {};
  existing[field] = value;
  appState.demographics.set(participantID,existing);
};

window.addDemographicField = () => {
  const newField = prompt("Enter new Demographic column name ( e.g., Condition, Group):");
  if(newField && newField.trim() !== ""){
    const fieldName = newField.trim();
    if(!appState.demographicFields.includes(fieldName)){
      appState.demographicFields.push(fieldName);
      if(document.getElementById('manifestPanel').style.display === 'block'){
        window.renderManifest(currentManifest);
      } else{
        renderSessionTray();
      }
    }
  }
};

function onTrayRowClick(index) {
  document.querySelectorAll('.tray-row').forEach((r, i) => {
    r.style.background = i === index ? '#E6F1FB' : '';
  });

  // Resolve which participant ID to display for this tray row.
  // Duo rows show two participants — default to .1, but if the row was
  // clicked specifically with the .2 chip we honour that.
  const session = currentManifest?.sessions[index];
  if (!session) return;

  let participantID;
  if (session.kind === 'solo') {
    participantID = session.baseID;
  } else if (session.kind === 'duo-unmatched') {
    participantID = session.baseID + (session.meta?.duoSuffix ? '.' + session.meta.duoSuffix : '');
  } else if (session.kind === 'duo-pair') {
    participantID = `${session.baseID}.1`;
  }

  const details = appState.sessionDetails?.get(participantID);
  if (!details) {
    console.warn(`No details cached for ${participantID}`);
    return;
  }
  renderSessionFromDetails(details, participantID);
}

// Render the per-session detail view (metric cards, charts, quality table)
// for one participant. Used by the tray-click handler in manifest mode so the
// student can see individual tachograms / Poincaré plots for any participant.
function renderSessionFromDetails(details, participantID) {
  const resultsDiv = document.getElementById('results');
  if (!resultsDiv) return;
  resultsDiv.style.display = 'block';

  // chart.js helpers read these directly. Set them BEFORE rendering so each
  // chart sees the right data instead of whichever participant rendered last.
  appState.parsedAllValid = details.allValid;
  appState.parsedPhases   = details.phases;
  appState.summaryData    = {
    fileName:   details.fileName,
    allRows:    details.allRows,
    allValid:   details.allValid,
    phasesRaw:  details.phases,
    session:    details.sessionMetrics,
    phases:     details.phaseMetrics,
    quality:    details.phaseQuality,
    method:     getArtefactMethod(),
    threshold:  getThreshold(),
  };

  renderSessionMeta(details.fileName, details.sessionMetrics);
  renderLegend(details.phases);
  renderMetricCards(details.sessionMetrics, details.phaseMetrics);
  renderQualitySummary(details.phaseQuality);
  renderTable(details.sessionMetrics, details.phaseMetrics, details.sessionFreq, details.phaseFreq);

  // Render every chart whose Charts-dropdown checkbox is currently ticked.
  // toggleChart() reads the checkbox state and either renders or hides the card.
  ['rrChart', 'hrChart', 'rmssdOverTimeChart',
   'poincareChart', 'histogramChart', 'accelerometerChart'].forEach(id => {
    toggleChart(id);
  });

  // Scroll the detail panel into view so the click feels responsive.
  resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function removeTraySession(index) {
  if (!currentManifest) return;
  const removed = currentManifest.sessions[index];

  // Remove from output results
  if (appState.outputResults) {
    appState.outputResults = appState.outputResults.filter(
      r => r.ParticipantID !== removed.baseID
    );
  }

  // Remove from manifest
  currentManifest.sessions.splice(index, 1);

  // Re-render
  if (appState.outputResults && appState.outputResults.length > 0) {
    renderSessionTray();
    renderOutputTable(appState.outputResults);
    renderGroupSummaryTable(appState.outputResults);
    renderTrajectoryChart(appState.outputResults);
  } else {
    resetManifest();
  }
}

// Renders the output results table — one row per participant
function renderOutputTable(rows) {
  const table = document.getElementById('outputTable');
  if (!table || rows.length === 0) return;

  const combine = document.getElementById('combineDuoRows')?.checked;
  let displayRows = rows;

  if(combine){
    displayRows = [];
    const pairs = new Map();
    const solos = [];

    rows.forEach(r => {
      if(r.IsDuoPaired && r.PairID){
        if(!pairs.has(r.PairID)) pairs.set(r.PairID, []);
        pairs.get(r.PairID).push(r);
      } else{
        solos.push(r)
      }
    });

    pairs.forEach((pairRows, pairID) =>{
      const combined = { PairID: pairID };
      const p1 = pairRows.find(r => r.ParticipantID.endsWith('.1')) || pairRows[0];
      const p2 = pairRows.find(r => r.ParticipantID.endsWith('.2')) || pairRows[1];

      if(p1) Object.keys(p1).forEach(k => {if (!['ParticipantID', 'PairID', 'IsDuoPaired'].includes(k) && !k.includes('_Synchrony_r')) combined[`P1_${k}`] = p1[k];});
      if(p2) Object.keys(p2).forEach(k => {if (!['ParticipantID', 'PairID', 'IsDuoPaired'].includes(k) && !k.includes('_Synchrony_r')) combined[`P2_${k}`] = p2[k];});

      if(p1) Object.keys(p1).forEach(k => {if (k.includes('_Synchrony_r')) combined[k] = p1[k]; });
      displayRows.push(combined);
    });

    solos.forEach(s => {
      const mapped = { PairID: s.ParticipantID || s.PairID };
      Object.keys(s).forEach(k => { if (!['ParticipantID', 'PairID', 'IsDuoPaired'].includes(k)) mapped[`P1_${k}`] = s[k]; });
      displayRows.push(mapped);
    });
  }

  appState.currentDisplayRows = displayRows;



  const headers = Object.keys(rows[0]);
  table.innerHTML = `
    <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${displayRows.map(row =>
      `<tr>${headers.map(h => `<td>${row[h] ?? '—'}</td>`).join('')}</tr>`
    ).join('')}</tbody>`;
}

// Resets everything back to the drop zone
function resetManifest() {
  currentManifest = null;
  appState.outputResults = [];
  document.getElementById('dropZone').style.display      = 'block';
  document.getElementById('manifestPanel').style.display  = 'none';
  document.getElementById('outputPanel').style.display    = 'none';
  if (document.getElementById('fileInput'))   document.getElementById('fileInput').value   = '';
  if (document.getElementById('folderInput')) document.getElementById('folderInput').value = '';
}

window.removeManifestItem = (index) => {
  if(!currentManifest) return;


const sessionToRemove = currentManifest.sessions[index];
if(appState.outputResults){
  appState.outputResults = appState.outputResults.filter(r => r.ParticipantID !== sessionToRemove.baseID);
}

currentManifest.sessions.splice(index,1);

if(document.getElementById('manifestPanel').style.display === 'block'){
  window.renderManifest(currentManifest);
}else{
  if(appState.outputResults && appState.outputResults.length > 0){
    renderOutputTable(appState.outputResults);
    renderGroupSummaryTable(appState.outputResults);
    renderTrajectoryChart(appState.outputResults);
  } else{
    resetManifest();
  }
}
};

window.removeDemographicItem = (index) => {
  if(!currentManifest) return;
  currentManifest.demographics.splice(index, 1);
  if(document.getElementById('manifestPanel').style.display === 'block'){
    window.renderManifest(currentManifest);
  }
};



// ---- Header Charts dropdown ----
function toggleHeaderCharts() {
  const panel = document.getElementById('headerChartsPanel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

// Close the dropdown when clicking outside it
document.addEventListener('click', e => {
  const dropdown = document.getElementById('headerChartsDropdown');
  if (dropdown && !dropdown.contains(e.target)) {
    const panel = document.getElementById('headerChartsPanel');
    if (panel) panel.style.display = 'none';
  }
});

// Sync header checkbox → Processing Options checkbox → toggleChart
function syncChartCheckbox(hdrCheckbox, targetCheckboxId, chartId) {
  const target = document.getElementById(targetCheckboxId);
  if (target) {
    target.checked = hdrCheckbox.checked;
  }
  toggleChart(chartId);
}

window.onOutputLayoutChange = () => {
  if(appState.outputResults && appState.outputResults.length > 0)
    renderOutputTable(appState.outputResults);
}

window.applyAPA7Style = applyAPA7Style;
window.resetZoom = resetZoom;
window.resetChartStyle = resetChartStyle;
window.downloadQualityCSV = downloadQualityCSV;
window.toggleHeaderCharts  = toggleHeaderCharts;
window.syncChartCheckbox   = syncChartCheckbox;
window.applyChartOptions = applyChartOptions;
window.toggleChartSettings = toggleChartSettings;
window.toggleChart = toggleChart;
window.switchTab = switchTab;
window.toggleDarkMode = toggleDarkMode;
window.resetApp = resetApp;
window.resetBatch = resetBatch;
window.resetManifest = resetManifest;
window.downloadChart = downloadChart;
window.copyChart = copyChart;
window.downloadCSV = downloadCSV;
window.copyMethodsStatement = copyMethodsStatement;
window.showAPAReport = showAPAReport;
window.renderManifest = renderManifest;
window.renderSessionTray = renderSessionTray;
window.removeTraySession = removeTraySession;
window.onTrayRowClick = onTrayRowClick;
window.appState = appState;