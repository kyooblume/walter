

import { appState } from "./config.js";
import { getValidRows, calcMetrics,calculateDataQuality, calcFrequencyDomain } from "./HRVMaths.js";
import { renderCharts, renderPoincare,renderTrajectoryChart,resetZoom } from "./chart.js";
import { buildPhases, parseBatchFile, classifyFiles } from "./fileParser.js";
import { showError, hideError, renderSessionMeta, renderLegend, renderMetricCards, renderTable, switchTab, toggleDarkMode, getArtefactMethod, getThreshold, renderBatchTable, renderGroupSummaryTable, copyMethodsStatement, renderArtefactPanel, renderQualitySummary, showAPAReport, renderManifest } from "./ui.js";
import { downloadCSV, downloadBatchCSV, downloadChart, generateMethodsStatement, downloadQualityCSV } from "./export.js";


// ----- Get DOM elements -----
const dropZone    = document.getElementById('dropZone');
const folderInput = document.getElementById('folderInput');
const fileInput   = document.getElementById('fileInput');
const uploadCard  = document.getElementById('uploadCard');
const errorBox    = document.getElementById('errorBox');
const results     = document.getElementById('results');

// Stores the current manifest between file drops and processing
let currentManifest = null;

// Trigger file processing when user selects a file via the input
if(window.Chart.ChartAnnotation){
  chart.register(window.ChartAnnotation);
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

  // Show the manifest panel so the user can review before processing
  renderManifest(manifest);
}

// ---- Manifest processing ----

// Called when the user clicks "Process files" in the manifest panel
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

        delete row.ParticipantID;
        const orderedRow = {
          ParticipantID: s.kind === 'solo' ? s.baseID : (s.meta?.duoSuffix ? '.' + s.meta.duoSuffix:'')),
          PairID: '',
          IsDuoPaired: false,
          ...row
        };
        rowsToAdd.push(orderedRow)
        }

      } else if (s.kind === 'duo-pair') {
        // Duo pair — process both files, prefix D1_/D2_ to distinguish sensors
        const row1 = await parseBatchFile(s.file1, method, threshold);
        const row2 = await parseBatchFile(s.file2, method, threshold);
        if (row1 && row2) {
          delete row1.ParticipantID;
          delete row2.ParticipantID;
          const orderedRow1 = { ParticipantID: `${s.baseID}.1`, PairID: s.baseID, IsDuoPaired: true, ...row1};
          const orderedRow2 = { ParticipantID: `${s.baseID}.2`, PairID: s.baseID, IsDuoPaired: true, ...row2};
          rowsToAdd.push(orderedRow1, orderedRow2);
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

    renderOutputTable(results);
    renderGroupSummaryTable(results)
    renderTrajectoryChart(results)
    renderSessionTray();
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
  appState.batchResults = [];
  document.getElementById('batchResults').style.display  = 'none';
  document.getElementById('batchFileCount').textContent  = '';
  document.getElementById('batchError').style.display    = 'none';
  document.getElementById('batchFileInput').value        = '';
  if (Chart.getChart("trajectoryChart")) Chart.getChart("trajectoryChart").destroy();
}

// keyabord shortcuts

//alt u to upload a file 
//alt m for dark mode 
document.addEventListener('keydown', (e) => {
  if ((e.altKey || e.metaKey) && e.key.toLowerCase() === 'u'){
    e.preventDefault();

    const panelSingle = document.getElementById('panelSingle');
    if (window.getComputedStyle(panelSingle).display !== 'none'){
      document.getElementById('fileInput').click();
    } else{
      document.getElementById('batchFileInput').click();
    }
  }

    if(e.altKey && e.key.toLowerCase() === 'm'){
      e.preventDefault();
      window.toggleDarkMode();
    }
  
});

function toggleChartSettings(){
  if(appState.parsedAllValid && appState.parsedPhases){
    renderCharts(appState.parsedAllValid, appState.parsedPhases);
    renderPoincare(appState.parsedPhases);
  }
  if (appState.batchResults && appState.batchResults.length > 0){
    renderTrajectoryChart(appState.batchResults);
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
    const addPartner = isWarn
      ? `<button class="btn btn-sm" style="font-size:11px;padding:3px 8px;" onclick="document.getElementById('fileInput').click()">+ Add ${s.missingPair}</button>`
      : '';
    return `<div class="tray-row" onclick="onTrayRowClick(${i})">
      <span class="tray-dot ${isWarn ? 'warn' : ''}"></span>
      <span class="tray-id">${label}</span>
      <span class="tray-type">${typeLabel} ${addPartner}</span>
      <button class="tray-remove" onclick="event.stopPropagation(); removeTraySession(${i})">✕</button>
    </div>`;
  }).join('');
}

function onTrayRowClick(index) {
  document.querySelectorAll('.tray-row').forEach((r, i) => {
    r.style.background = i === index ? '#E6F1FB' : '';
  });
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
  const headers = Object.keys(rows[0]);
  table.innerHTML = `
    <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row =>
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
};



window.toggleChartSettings = toggleChartSettings;
window.switchTab = switchTab;
window.toggleDarkMode = toggleDarkMode;
window.resetApp = resetApp;
window.resetBatch = resetBatch;
window.resetManifest = resetManifest;
window.downloadCSV = downloadCSV;
window.downloadBatchCSV = downloadBatchCSV;
window.downloadOutputCSV = downloadOutputCSV;
window.updatePhaseLabel = updatePhaseLabel;
window.onSettingsChange = onSettingsChange;
window.resetZoom = resetZoom;
window.downloadChart = downloadChart;
window.copyMethodsStatement = copyMethodsStatement;
window.showAPAReport = showAPAReport;
window.renderManifest = renderManifest;
window.renderSessionTray = renderSessionTray;
window.removeTraySession = removeTraySession;
window.onTrayRowClick = onTrayRowClick;
window.appState = appState;