import { theseVaribales } from "./config.js";
// Downloads a chart canvas as a PNG image
export function downloadChart(id, filename) {
  const canvas = document.getElementById(id);
  const link   = document.createElement('a');
  link.download = filename;
  link.href     = canvas.toDataURL('image/png');
  link.click();
}

export function downloadCSV() {
  if (!theseVaribales.summaryData.session) return;
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
  const methodsStmt = generateMethodsStatement(theseVaribales.summaryData.method, theseVaribales.summaryData.threshold);
  let csv = `# ${methodsStmt}\n`;

  // Add session notes as a comment line if the student has entered any
  const notesEl = document.getElementById('sessionNotes');
  const notes   = notesEl ? notesEl.value.trim() : '';
  if (notes) csv += `# Notes: ${notes}\n`;
  const phaseHeaders  = theseVaribales.summaryData.phases.map(p => p.label).join(',');

  // Include change score headers if exactly 2 phases
  const showChange    = theseVaribales.summaryData.phases.length === 2 &&
                        theseVaribales.summaryData.phases[0].m &&
                        theseVaribales.summaryData.phases[1].m;
  const changeHeaders = showChange ? ',Change (abs),Change (%)' : '';
  const sessionHeader = theseVaribales.summaryData.phases.length > 0 ? ',Full session' : '';

  csv += `Metric,Unit,${phaseHeaders}${changeHeaders}${sessionHeader}\n`;

  metrics.forEach(m => {
    const phaseCells = theseVaribales.summaryData.phases.map(p => p.m ? p.m[m.key] : '').join(',');

    // Calculate change scores for CSV
    let changeCells = '';
    if (showChange) {
      const v1  = parseFloat(theseVaribales.summaryData.phases[0].m[m.key]);
      const v2  = parseFloat(theseVaribales.summaryData.phases[1].m[m.key]);
      const abs = v2 - v1;
      const pct = v1 !== 0 ? (abs / v1) * 100 : 0;
      const sign = abs > 0 ? '+' : '';
      changeCells = `,${sign}${abs.toFixed(2)},${sign}${pct.toFixed(1)}%`;
    }

    const sessionCell = theseVaribales.summaryData.phases.length > 0
      ? ',' + (theseVaribales.summaryData.session ? theseVaribales.summaryData.session[m.key] : '')
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
  if (theseVaribales.batchResults.length === 0) return;

  const headers = Object.keys(theseVaribales.batchResults[0]);

  // No comment lines — SPSS requires clean CSV with no leading rows
  let csv = headers.join(',') + '\n';

  theseVaribales.batchResults.forEach(row => {
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