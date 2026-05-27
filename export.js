import { appState } from "./config.js";

// Derive a chart label from a filename like "walter_tachogram.png"
function deriveChartName(filename) {
  if (!filename) return 'chart';
  return filename.replace(/^walter_/, '').replace(/\.png$/i, '');
}

// Build the "visible phases" portion of the filename based on current zoom
function getVisiblePhasesLabel(chart) {
  try {
    const phases = appState.parsedPhases;
    if (!phases || !chart) return '';

    const xScale = chart.scales?.x;
    if (!xScale) return '';

    const startRow = appState.summaryData.allRows?.find(
      r => (r.event || '').trim() === 'SESSION_START'
    );
    const t0 = startRow
      ? parseFloat(startRow.timestamp_ms)
      : parseFloat(phases[0].rows[0].timestamp_ms);

    const xMin = xScale.min;
    const xMax = xScale.max;

    const visible = phases.filter(p => {
      const pStart = (parseFloat(p.rows[0].timestamp_ms) - t0) / 1000;
      const pEnd   = (parseFloat(p.rows[p.rows.length - 1].timestamp_ms) - t0) / 1000;
      return pEnd >= xMin && pStart <= xMax;
    });

    if (visible.length === 0 || visible.length === phases.length) return '';
    return visible.map(p => p.label).join('-').replace(/\s+/g, '');
  } catch { return ''; }
}

// Downloads a chart canvas as a PNG image with a title strip on top.
// Task 3.4 — filename format: {participantID}_{chartName}_{visiblePhases}_{date}.png
export function downloadChart(id, filename) {
  const canvas = document.getElementById(id);
  if (!canvas) return;

  const chart = window.Chart.getChart(id);
  const chartName = deriveChartName(filename);

  // Resolve participant ID — for single-file mode this is in summaryData.fileName
  let participantID = '';
  if (appState.summaryData?.fileName) {
    participantID = appState.summaryData.fileName.split('_')[0] || '';
  }

  const visiblePhases = chart ? getVisiblePhasesLabel(chart) : '';
  const date = new Date().toISOString().split('T')[0];

  // Build a title for the strip on top of the exported image
  const titleParts = [participantID, chartName, visiblePhases].filter(Boolean);
  const titleText  = `WALTER — ${titleParts.join(' · ') || chartName}`;

  // Build temp canvas with a white strip on top containing the title
  const tempCanvas  = document.createElement('canvas');
  const ctx         = tempCanvas.getContext('2d');
  tempCanvas.width  = canvas.width;
  tempCanvas.height = canvas.height + 40;

  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

  ctx.fillStyle = 'black';
  ctx.font      = '14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(titleText, tempCanvas.width / 2, 24);

  ctx.drawImage(canvas, 0, 40);

  // Filename: P001_tachogram_Phase1-Phase2_2026-05-12.png
  const nameParts = [participantID, chartName, visiblePhases, date].filter(Boolean);
  const link = document.createElement('a');
  link.download = nameParts.join('_') + '.png';
  link.href     = tempCanvas.toDataURL('image/png'); // ← fix: was 'canvas' (raw chart, no strip)
  link.click();
}

// Copies the chart (with title strip) to the clipboard. Task 3.4.
export function copyChart(id) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (!navigator.clipboard || !window.ClipboardItem) {
    alert('Clipboard image copy is not supported in this browser.');
    return;
  }

  canvas.toBlob(blob => {
    if (!blob) return;
    navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      .then(() => {
        // Find the Copy button next to this canvas and flash "Copied!"
        const card = document.getElementById(`card-${id}`);
        const btn  = card?.querySelector('button.btn-sm[onclick*="copyChart"]');
        if (btn) {
          const original = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = original; }, 1500);
        }
      })
      .catch(err => console.error('Clipboard write failed:', err));
  });
}

// Downloads the output results as a SPSS-ready CSV
export function downloadCSV() {
  const results = appState.outputResults;
  if (!results || results.length === 0) return;

  const headers = Object.keys(results[0]);
  let csv = headers.join(',') + '\n';


  results.forEach(row => {
     csv += headers.map(h => row[h] ?? '').join(',') + '\n';
     });

  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');

  // Task 4.3 — sensible filename: single participant → P001_2026-05-12_walter_summary.csv
  //                              multiple participants → walter_batch_{date}.csv
  const date = new Date().toISOString().split('T')[0];
  if (results.length === 1 && results[0].ParticipantID) {
    link.download = `${results[0].ParticipantID}_${date}_walter_summary.csv`;
  } else {
    link.download = `walter_batch_${date}.csv`;
  }
  link.href = URL.createObjectURL(blob);
  link.click();
}

// Cohen's d — Task 4.3.
// Reported when exactly 2 phases are present. Uses SDNN as the variability estimate.
export function cohensD(mean1, sd1, n1, mean2, sd2, n2) {
  const m1 = parseFloat(mean1), m2 = parseFloat(mean2);
  const s1 = parseFloat(sd1),   s2 = parseFloat(sd2);
  if ([m1, m2, s1, s2].some(v => isNaN(v)) || n1 + n2 - 2 <= 0) return '—';
  const pooledSD = Math.sqrt(((n1 - 1) * s1 ** 2 + (n2 - 1) * s2 ** 2) / (n1 + n2 - 2));
  return pooledSD > 0 ? ((m2 - m1) / pooledSD).toFixed(3) : '—';
}

// Downloads the data quality summary as a CSV file.
// Task 3.5 — supports both single-session (legacy) and multi-participant
// batches. For batches, one block per participant; for a single session,
// the original flat layout is preserved.
export function downloadQualityCSV() {
  // Pull per-participant details if the manifest path has run
  const sessionDetails = appState.sessionDetails;     // Map<participantID, details>
  const singleQuality  = appState.summaryData?.quality;

  // Methods statement — researchers paste this into their write-up.
  // Comment lines (#) work in most stats packages and are easy to strip.
  const method    = appState.summaryData?.method;
  const threshold = appState.summaryData?.threshold;
  const methodsLine = method
    ? `# methods: ${generateMethodsStatement(method, threshold)}\n`
    : '';

  let csv = methodsLine;
  let filename = 'walter_quality.csv';

  if (sessionDetails && sessionDetails.size > 0) {
    // Multi-participant — one row per (participant × phase).
    csv += 'ParticipantID,Phase,BeatsRecorded,BeatsRetained,BeatsHandled,PercentRetained,Rating\n';
    for (const [pid, details] of sessionDetails) {
      if (!details?.phaseQuality) continue;
      details.phaseQuality.forEach(p => {
        csv += `${pid},${p.label},${p.q.heartBeatDataTotal},${p.q.HeartBeatDataretained},${p.q.messedUpBeats},${p.q.percentRetained}%,${p.q.rating}\n`;
      });
    }
    const date = new Date().toISOString().split('T')[0];
    filename = `walter_quality_${date}.csv`;
  } else if (singleQuality && singleQuality.length > 0) {
    // Single session — keep the original simple layout.
    csv += 'Phase,Beats recorded,Beats retained,Beats handled,Rating,Percent retained\n';
    singleQuality.forEach(p => {
      csv += `${p.label},${p.q.heartBeatDataTotal},${p.q.HeartBeatDataretained},${p.q.messedUpBeats},${p.q.rating},${p.q.percentRetained}%\n`;
    });
  } else {
    return; // nothing to export
  }

  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.download = filename;
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
