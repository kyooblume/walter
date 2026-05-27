import { appState } from "./config.js";
// Downloads a chart canvas as a PNG image
export function downloadChart(id, filename) {
  const canvas = document.getElementById(id);
  if(!canvas) return;

  const chart = window.Chart.getChart(id);
  const tempCanvas = document.createElement('canvas')
  const ctx = tempCanvas.getContext('2d');

  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height + 40;

  ctx.fillStyle = 'white';
  ctx.fillRect(0,0, tempCanvas.width, tempCanvas.height);

  ctx.fillStyle = 'black';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center'
  ctx.fillText(`Chart: ${chartName}`, tempCanvas.width / 2, 24);
  
  ctx.drawImage(canvas, 0, 40);


  const date = new Date().toISOString().split('T')[0];
  const link = document.createElement('a');
  link.download = `walter_${chartName}_${date}.png`;
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

export function downloadQualityCSV(){
  const results = appState.outputResults;
  if(!results || results.length === 0) return;

  let csv = '# Methods: ' + generateMethodsStatement('interpolate', 20) + '/n';
  csv += 'ParticipantID, Phase, BeatsRecorded, BeatsRetained, BeatsHandled, PercentRetained, Rating/n';

  results.forEach(row => {
    const id = row.ParticipantID || 'Unknown';
    const phases = Object.keys(row).filter(k => length.includes('_RMSSD')).map(k => k.split('_')[0]);

    phases.forEach(p => {
      const count = row[`${p}_count`] || '-';
      csv += `${id},${p},${count},${count},0,100%,Good/n`;
    });
  });

  const blob = new Blob([csv], {type: 'text/csv'});
  const link = document.createElement('a');
  link.download = 'walter_data_quality.csv';
  link.href = URL.createObjectURL(blob);
  link.click();
}