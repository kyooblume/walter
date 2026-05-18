

import { theseVaribales } from "./config.js";
import { getValidRows, calcMetrics,calculateDataQuality, calcFrequencyDomain } from "./HRVMaths.js";
import { renderCharts, renderPoincare,renderTrajectoryChart,resetZoom } from "./chart.js";
import { buildPhases,parseBatchFile } from "./fileParser.js";
import { showError, hideError, renderSessionMeta, renderLegend, renderMetricCards, renderTable,switchTab,toggleDarkMode,getArtefactMethod,getThreshold,renderBatchTable,renderGroupSummaryTable, copyMethodsStatement,renderArtefactPanel,renderQualitySummary,showAPAReport } from "./ui.js";
import { downloadCSV,downloadBatchCSV,downloadChart,generateMethodsStatement} from "./export.js";


// ----- Get DOM elements -----
const fileInput  = document.getElementById('fileInput');
const uploadCard = document.getElementById('uploadCard');
const errorBox   = document.getElementById('errorBox');
const results    = document.getElementById('results');

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


 if (window.ChartAnnotation) {
    Chart.register(window.ChartAnnotation);
  }


const batchFileInputEl = document.getElementById('batchFileInput');
if (batchFileInputEl) {
  batchFileInputEl.addEventListener('change', e => {
    if (e.target.files.length > 0) processBatchFiles(e.target.files);
  });
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
  theseVaribales.batchResults = [];
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
        theseVaribales.batchResults.push(result);
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

  if (theseVaribales.batchResults.length > 0) {
    renderBatchTable(theseVaribales.batchResults);
    renderGroupVisualisation(theseVaribales.batchResults);
    document.getElementById('batchResults').style.display = 'block';
  }
}

// ============================================================
// Main render entry point — called after file upload and after settings changes
// ============================================================
function renderResults(fileName,allRows,allValid, phases) {
  uploadCard.style.display = 'none';
  results.style.display    = 'block';

  theseVaribales.parsedAllValid = allValid;
  theseVaribales.parsedPhases = phases;
  theseVaribales.summaryData.allRows = allRows

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

  theseVaribales.summaryData = { session: sessionMetrics, phases: phaseMetrics, method, threshold, quality: phaseQuality, fileName, allRows, allValid, phasesRaw: phases };
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
  if (!theseVaribales.parsedAllValid || !theseVaribales.parsedPhases) return;

  const method    = getArtefactMethod();
  const threshold = getThreshold();

  // Grey out the slider when method is 'none' (threshold has no effect)
  const slider = document.getElementById('thresholdSlider');
  if (slider) slider.disabled = (method === 'none');

  // Update the methods statement text in real time
  const stmtEl = document.getElementById('methodsStatement');
  if (stmtEl) stmtEl.value = generateMethodsStatement(method, threshold);

  // Recalculate and redraw metrics and table only (charts are not redrawn for performance)
  const sessionMetrics = calcMetrics(theseVaribales.parsedAllValid, method, threshold);
  const phaseMetrics   = theseVaribales.parsedPhases.map(p => ({
    label: p.label,
    m: calcMetrics(getValidRows(p.rows), method, threshold)
  }));

  renderMetricCards(sessionMetrics, phaseMetrics);
  renderTable(sessionMetrics, phaseMetrics);

  theseVaribales.summaryData = { session: sessionMetrics, phases: phaseMetrics, method, threshold };
}

function updatePhaseLabel(phaseNumber,newLabel){
    theseVaribales.phaseLabels[phaseNumber] = newLabel.trim() || `Phase ${phaseNumber}`;

    const newPhases = buildPhases(theseVaribales.summaryData.allRows)

    renderResults(
        theseVaribales.summaryData.fileName,
        theseVaribales.summaryData.allRows,
        theseVaribales.summaryData.allValid,
        newPhases
    );
}

//clears everthing and goes back to the upload screen 
function resetApp() {
  uploadCard.style.display = 'block';
  results.style.display    = 'none';
  fileInput.value          = '';
  theseVaribales.parsedAllValid           = null;
  // Clear session notes when resetting
  const notesEl = document.getElementById('sessionNotes');
  if (notesEl) notesEl.value = '';
  theseVaribales.parsedPhases = null;
  hideError();

  if(Chart.getChart("rrChart")) Chart.getChart("rrChart").destroy();
  if(Chart.getChart("hrChart")) Chart.getChart("hrChart").destroy();
  if(Chart.getChart("poincareChart")) Chart.getChart("poincareChart").destroy();

}

function resetBatch() {
  theseVaribales.batchResults = [];
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
  if(theseVaribales.parsedAllValid && theseVaribales.parsedPhases){
    renderCharts(theseVaribales.parsedAllValid, theseVaribales.parsedPhases);
    renderPoincare(theseVaribales.parsedPhases);
  }
  if (theseVaribales.batchResults && theseVaribales.batchResults.length > 0){
    renderTrajectoryChart(theseVaribales.batchResults);
  }
}

window.toggleChartSettings = toggleChartSettings;
window.switchTab = switchTab;
window.toggleDarkMode = toggleDarkMode;
window.resetApp = resetApp;
window.resetBatch = resetBatch;
window.downloadCSV = downloadCSV;
window.downloadBatchCSV = downloadBatchCSV;
window.updatePhaseLabel = updatePhaseLabel;
window.onSettingsChange = onSettingsChange;
window.resetZoom = resetZoom;
window.downloadChart = downloadChart;
window.copyMethodsStatement = copyMethodsStatement;
window.showAPAReport = showAPAReport;