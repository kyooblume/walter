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

  link.download = 'walter_output.csv';
  link.href     = URL.createObjectURL(blob);
  link.click();
}

// Downloads the data quality summary as a CSV file
export function downloadQualityCSV() {
  const quality = appState.summaryData?.quality;
  if (!quality || quality.length === 0) return;

  let csv = 'Phase,Beats recorded,Beats retained,Beats handled,Rating,Percent retained\n';
  quality.forEach(p => {
    csv += `${p.label},${p.q.heartBeatDataTotal},${p.q.HeartBeatDataretained},${p.q.messedUpBeats},${p.q.rating},${p.q.percentRetained}%\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.download = 'walter_quality.csv';
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