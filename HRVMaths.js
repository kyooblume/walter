import { theseVaribales } from './config.js';

export function getValidRows(rows){
    return rows.filter(r=>{
    const rr = parseFloat(r.rr_ms);
    return rr >= 300 && rr <= 2000;
    })
}

export function handleArtefacts(rrArray, method, threshold) {
  const thresholdRate = threshold / 100;

  if (method === 'none' || rrArray.length < 2) {
    return { cleaned: [...rrArray], deletedIndices: new Set(), interpolatedCount: 0, isInterpolated: new Array(rrArray.length).fill(false),isDeleted: new Array(rrArray.length).fill(false), result: [...rrArray] };
  }

  const result     = [...rrArray];
  const isArtefact = new Array(result.length).fill(false);
  const isInterpolated = new Array(result.length).fill(false);
  const isDeleted = new Array(result.length).fill(false);
  let interpolatedCount = 0;

  // Step 1: Detect artefacts — flag beats deviating more than threshold% from previous
  for (let i = 1; i < result.length; i++) {
    const diff = Math.abs(result[i] - result[i - 1]) / result[i - 1];
    if (diff > thresholdRate) isArtefact[i] = true;
  }

  // Step 2: Apply interpolation if selected
  if (method === 'interpolate') {
    for (let i = 1; i < result.length - 1; i++) {
      if (!isArtefact[i]) continue;
      if (isArtefact[i - 1] || isArtefact[i + 1]) {
        isArtefact[i] = 'delete';
      } else {
        result[i]     = (result[i - 1] + result[i + 1]) / 2;
        isArtefact[i] = false;
        isInterpolated[i] = true;
        interpolatedCount++;
      }
    }
  }

  // Step 3: Remove beats marked for deletion and record their positions
  const deletedIndices = new Set();
  const cleaned = [];
  result.forEach((val, i) => {
    if (isArtefact[i] === true || isArtefact[i] === 'delete') {
      deletedIndices.add(cleaned.length);
      isDeleted[i] = true;
    } else {
      cleaned.push(val);
    }
  });

  return { cleaned, deletedIndices,interpolatedCount, isInterpolated, isDeleted, result };
}

export function calcMetrics(rows, method = 'interpolate', threshold = 20) {
  const rawRR = rows.map(r => parseFloat(r.rr_ms));
  const hr    = rows.map(r => parseFloat(r.hr_bpm)).filter(v => !isNaN(v));

  // Apply artefact handling to get cleaned RR array and deletion positions
  const { cleaned: rr, deletedIndices, interpolatedCount } = handleArtefacts(rawRR, method, threshold);

  const meanRR = rr.reduce((a, b) => a + b, 0) / rr.length;
  const meanHR = hr.length ? hr.reduce((a, b) => a + b, 0) / hr.length : 60000 / meanRR;

  // Calculate successive differences for RMSSD and pNN50
  // Skip differences that span a deletion gap (deletion boundary problem):
  // when a beat is deleted, the beats either side were not truly consecutive
  const diffs = [];
  for (let i = 1; i < rr.length; i++) {
    if (deletedIndices.has(i)) continue; // Skip boundary caused by a deleted beat
    diffs.push(rr[i] - rr[i - 1]);
  }

  const rmssd = diffs.length ? Math.sqrt(diffs.map(d => d * d).reduce((a, b) => a + b, 0) / diffs.length) : 0;
  const sdnn  = Math.sqrt(rr.map(v => (v - meanRR) ** 2).reduce((a, b) => a + b, 0) / rr.length);
  const pnn50 = diffs.length ? (diffs.filter(d => Math.abs(d) > 50).length / diffs.length) * 100 : 0;

  const startRow = theseVaribales.summaryData.allRows ? theseVaribales.summaryData.allRows.find (r => ( r.event || '').trim() === 'SESSION_START'):null;
  const t0 = startRow ? parseFloat(startRow.timestamp_ms) : parseFloat(rows[0].timestamp_ms);
  const t1 = parseFloat(rows[rows.length - 1].timestamp_ms);
  const duration = (t1 - t0) / 1000;

  return {
    count:    rr.length,
    meanRR:   meanRR.toFixed(2),
    meanHR:   meanHR.toFixed(2),
    rmssd:    rmssd.toFixed(2),
    sdnn:     sdnn.toFixed(2),
    pnn50:    pnn50.toFixed(2),
    minRR:    Math.min(...rr).toFixed(2),
    maxRR:    Math.max(...rr).toFixed(2),
    duration: duration.toFixed(1),
    deleted: deletedIndices.size,
    interpolated: interpolatedCount
  };
}


export function calculateDataQuality(heartBeatsRecorded,FilterdRows,AllMetrics){
    const heartBeatDataTotal = heartBeatsRecorded.length;
    let HeartBeatDataretained = FilterdRows.length;
    let messedUpBeats = heartBeatDataTotal - HeartBeatDataretained;
    
    if(AllMetrics){ //if all metrics exist 
      messedUpBeats = messedUpBeats + AllMetrics.deleted + AllMetrics.interpolated;
      HeartBeatDataretained = HeartBeatDataretained - AllMetrics.deleted
    }

    const percentRetained = heartBeatDataTotal > 0 ? (HeartBeatDataretained / heartBeatDataTotal) * 100:0;
    let rating = "good";
    if(percentRetained<85) rating = "Poor";
    else if(percentRetained<95) rating = "Fair";

    return { heartBeatDataTotal, HeartBeatDataretained, messedUpBeats, rating, percentRetained: percentRetained.toFixed(1)};
};

