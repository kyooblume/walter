import { appState } from "./config.js";
// Downloads a chart canvas as a PNG image
export function downloadChart(id, filename) {
  const canvas = document.getElementById(id);
  const link   = document.createElement('a');
  const chart = window.Chart.getChart(id);

  const originalFile = appState.summaryData?.fileName?.replace(/\.csv$/i, '') || 'participant';
  const cleanBase = filename ? filename.replace('.png', '') : 'chart';
  let phaseText = 'All-Phases';

  if(chart && id !== 'poincareChart' && id !== 'trajectoryChart' && appState.parsedPhases){
    const minX = chart.scales.x.min;
    const maxX = chart.scales.x.max;

    const startRow = appState.summaryData.allRows.find( r=> (r.event || ""). trim() === 'SESSION_START');
    const t0 = startRow ? parseFloat(startRow.timestamp_ms) : parseFloat(appState.summaryData.allValid[0].timestamp_ms);


  const visablePhases = appState.parsedPhases.filter( p=> {
    const pStart = (parseFloat(p.rows[0].timestamp_ms) - t0) / 1000;
    const pEnd = (parseFloat(p.rows[p.rows.length - 1].timestamp_ms) - t0) / 1000;
    return (pEnd >= minX && pStart <= maxX);
  });

  if(visablePhases.length > 0 ){
    phaseText = visablePhases.map(p => p.label.replace(/\s+/g, '')).join('-');
  }
  }




  link.download = `${originalFile}_${cleanBase}_${phaseText}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

export function downloadCSV() {
  if (!appState.summaryData.session) return;
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
  const methodsStmt = generateMethodsStatement(appState.summaryData.method, appState.summaryData.threshold);
  let csv = `# ${methodsStmt}\n`;

  // Add session notes as a comment line if the student has entered any
  const notesEl = document.getElementById('sessionNotes');
  const notes   = notesEl ? notesEl.value.trim() : '';
  if (notes) csv += `# Notes: ${notes}\n`;
  const phaseHeaders  = appState.summaryData.phases.map(p => p.label).join(',');

  // Include change score headers if exactly 2 phases
  const showChange    = appState.summaryData.phases.length === 2 &&
                        appState.summaryData.phases[0].m &&
                        appState.summaryData.phases[1].m;
  const changeHeaders = showChange ? ',Change (abs),Change (%)' : '';
  const sessionHeader = appState.summaryData.phases.length > 0 ? ',Full session' : '';

  csv += `Metric,Unit,${phaseHeaders}${changeHeaders}${sessionHeader}\n`;

  metrics.forEach(m => {
    const phaseCells = appState.summaryData.phases.map(p => p.m ? p.m[m.key] : '').join(',');

    // Calculate change scores for CSV
    let changeCells = '';
    if (showChange) {
      const v1  = parseFloat(appState.summaryData.phases[0].m[m.key]);
      const v2  = parseFloat(appState.summaryData.phases[1].m[m.key]);
      const abs = v2 - v1;
      const pct = v1 !== 0 ? (abs / v1) * 100 : 0;
      const sign = abs > 0 ? '+' : '';
      changeCells = `,${sign}${abs.toFixed(2)},${sign}${pct.toFixed(1)}%`;
    }

    const sessionCell = appState.summaryData.phases.length > 0
      ? ',' + (appState.summaryData.session ? appState.summaryData.session[m.key] : '')
      : '';
    csv += `${m.label},${m.unit},${phaseCells}${changeCells}${sessionCell}\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.download = 'walter_summary.csv';
  link.href     = URL.createObjectURL(blob);
  link.click();
}

// Download the batch results as a SPSS-ready CSV
export function downloadBatchCSV() {
  if (appState.batchResults.length === 0) return;

  const headers = Object.keys(appState.batchResults[0]);

  // No comment lines — SPSS requires clean CSV with no leading rows
  let csv = headers.join(',') + '\n';

  appState.batchResults.forEach(row => {
    csv += headers.map(h => row[h] ?? '').join(',') + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.download = 'walter_batch_summary.csv';
  link.href     = URL.createObjectURL(blob);
  link.click();
}

export function generateMethodsStatement(method, threshold) {
  if (method === 'interpolate') {
    return `Artefact handling: RR intervals deviating more than ${threshold}% from the preceding interval were replaced using linear interpolation between neighbouring beats.`;
  }
  if (method === 'delete') {
    return `Artefact handling: RR intervals deviating more than ${threshold}% from the preceding interval were removed from the series.`;
  }
  return 'Artefact handling: No successive difference filtering was applied. Only physiological range filtering (300–2000ms) was used.';
}

export function generateAPAReport(){
  const data = appState.summaryData;
  if (!data || !data.phases) return "No data available to generate report"


  const methods = generateMethodsStatement(data.method, data.threshold);
  const totalBeats = data.session.count;
  const methodsText = ` Heart rate variability data was processed using WALTER Heart Rate Variability Analyser. ${methods} A total of ${totalBeats} beats were analyzed across the session`

  let resultsText = "The statistics for RMSSD (ms) across the session phases were: ";
  const phaseStrings = data.phases.map(p => {
    return `${p.label} (M = ${p.m.rmssd})`;
  });

  resultsText += phaseStrings.join(", ") + "."

  return `### APA 7 Methods & Results Draft\n\n${methodsText}\n\n${resultsText}`;


}