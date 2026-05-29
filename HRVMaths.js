import { appState } from './config.js';

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

  // SESSION_START is the trial-relative t0. Look it up in the rows passed in
  // when possible; only fall back to appState (which is set for the single-file
  // path) if it isn't present. The previous version always consulted
  // appState.summaryData.allRows — so during batch/manifest processing, every
  // participant used the FIRST file's t0, producing wrong durations.
  let startRow = null;
  if (Array.isArray(rows)) {
    startRow = rows.find(r => (r.event || '').trim() === 'SESSION_START');
  }
  if (!startRow && appState.summaryData?.allRows) {
    startRow = appState.summaryData.allRows.find(r => (r.event || '').trim() === 'SESSION_START');
  }
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

//calculates the percentage of valid heartbeats
// kept after removing errors and then assigns the data
// a poor, fair, or good rating  
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


// ============================================================
// Frequency Domain Analysis
// Calculates LF power, HF power, and LF/HF ratio using FFT
// Method: linear interpolation at 4Hz, then FFT via mathjs
// Band definitions from Task Force (1996)
// ============================================================

// Step 1: Resample RR intervals onto a regular 4Hz grid using linear interpolation
// FFT requires evenly spaced data — raw RR data is irregularly spaced (one per heartbeat)
function interpolateRR(timestamps, rrValues, fs = 4) {
  // Convert timestamps to seconds from session start
  const t0      = timestamps[0];
  const timeSec = timestamps.map(t => (t - t0) / 1000);

  // Create evenly spaced time grid at fs Hz
  const tEnd    = timeSec[timeSec.length - 1];
  const grid    = [];
  for (let t = 0; t <= tEnd; t += 1 / fs) grid.push(t);

  // Linear interpolation: for each grid point find surrounding data points
  const interpolated = grid.map(t => {
    // Find the two surrounding data points
    let i = 0;
    while (i < timeSec.length - 1 && timeSec[i + 1] < t) i++;

    if (i >= timeSec.length - 1) return rrValues[rrValues.length - 1];

    const t1 = timeSec[i],     t2 = timeSec[i + 1];
    const v1 = rrValues[i],    v2 = rrValues[i + 1];

    // Linear interpolation formula: v1 + (v2-v1) * (t-t1)/(t2-t1)
    return v1 + (v2 - v1) * (t - t1) / (t2 - t1);
  });

  return interpolated;
}

// Step 2 & 3: Apply FFT and extract LF, HF power
// Requires mathjs to be loaded (window.math)
export function calcFrequencyDomain(rows) {
  // Need at least 60 seconds for reliable LF estimation (2 cycles at 0.04Hz)
  const t0  = parseFloat(rows[0].timestamp_ms);
  const t1  = parseFloat(rows[rows.length - 1].timestamp_ms);
  const dur = (t1 - t0) / 1000;

  if (dur < 60) {
    return { lf: null, hf: null, lfhf: null, warning: 'Recording too short for reliable frequency domain analysis (minimum 60s required)' };
  }

  // Check mathjs is available
  if (!window.math || !window.math.fft) {
    return { lf: null, hf: null, lfhf: null, warning: 'mathjs not loaded' };
  }

  const timestamps = rows.map(r => parseFloat(r.timestamp_ms));
  const rrValues   = rows.map(r => parseFloat(r.rr_ms));

  // Step 1: Resample at 4 Hz
  const fs           = 4;
  const interpolated = interpolateRR(timestamps, rrValues, fs);
  const N            = interpolated.length;

  // Step 2: Apply FFT via mathjs
  // mathjs.fft returns array of complex numbers { re, im }
  const fftResult = window.math.fft(interpolated);

  // Step 3: Calculate power spectrum
  // Power = real² + imaginary² for each frequency bin
  // Frequency resolution = fs / N (Hz per bin)
  const freqResolution = fs / N;

  let lf = 0;
  let hf = 0;

  // Only process first half of FFT output (second half is mirror image)
  for (let i = 0; i < N / 2; i++) {
    const freq  = i * freqResolution;
    const power = fftResult[i].re ** 2 + fftResult[i].im ** 2;

    // LF band: 0.04 – 0.15 Hz (Task Force, 1996)
    if (freq >= 0.04 && freq < 0.15) lf += power;

    // HF band: 0.15 – 0.40 Hz (Task Force, 1996)
    if (freq >= 0.15 && freq < 0.40) hf += power;
  }

  // Normalise by number of points
  lf = lf / N;
  hf = hf / N;

  return {
    lf:      lf.toFixed(2),
    hf:      hf.toFixed(2),
    lfhf:    hf > 0 ? (lf / hf).toFixed(3) : '—',
    warning: null
  };
}

// ============================================================
// Poincaré Analysis: SD1 and SD2
// Calculates the standard deviations of the scatter plot axes
// SD1 = short-term variability (perpendicular to identity line)
// SD2 = long-term variability (parallel to identity line)
// ============================================================

export function calcPoincareSD(rows) {
  const rr = getValidRows(rows).map(r => parseFloat(r.rr_ms));
  
  if (rr.length < 2) return { sd1: null, sd2: null, sd1_sd2_ratio: null };

  // Create (RR[n], RR[n+1]) pairs
  const pairs = [];
  for (let i = 0; i < rr.length - 1; i++) {
    pairs.push({ x: rr[i], y: rr[i + 1] });
  }

  // Step 1: Calculate successive differences
  // x = RR[n]
  // y = RR[n+1]
  // d1 = (y - x) / sqrt(2)   — perpendicular to identity line
  // d2 = (x + y) / sqrt(2)   — parallel to identity line

  const d1Values = [];
  const d2Values = [];

  pairs.forEach(p => {
    const d1 = (p.y - p.x) / Math.sqrt(2);
    const d2 = (p.x + p.y) / Math.sqrt(2);
    d1Values.push(d1);
    d2Values.push(d2);
  });

  // Step 2: Calculate standard deviations
  const meanD1 = d1Values.reduce((a, b) => a + b, 0) / d1Values.length;
  const meanD2 = d2Values.reduce((a, b) => a + b, 0) / d2Values.length;

  const sd1 = Math.sqrt(
    d1Values.map(d => (d - meanD1) ** 2).reduce((a, b) => a + b, 0) / d1Values.length
  );

  const sd2 = Math.sqrt(
    d2Values.map(d => (d - meanD2) ** 2).reduce((a, b) => a + b, 0) / d2Values.length
  );

  const ratio = sd2 > 0 ? (sd1 / sd2).toFixed(3) : '—';

  return {
    sd1: sd1.toFixed(2),
    sd2: sd2.toFixed(2),
    sd1_sd2_ratio: ratio
  };
}

// ============================================================
// Duo Pair Synchrony: Pearson correlation of RMSSD time series
// Measures how synchronized two Polar H10 sensors are during a phase
// ============================================================

// Resample RMSSD values onto a regular 1-second grid using linear interpolation
function resampleToGrid(rows, fs = 1) {
  const timestamps = rows.map(r => parseFloat(r.timestamp_ms));
  const rmssdValues = rows.map(r => {
    const rmssd = parseFloat(r.rmssd_ms);
    return isNaN(rmssd) ? 0 : rmssd;
  });

  if (timestamps.length < 2) return rmssdValues;

  // Convert timestamps to seconds from start
  const t0 = timestamps[0];
  const timeSec = timestamps.map(t => (t - t0) / 1000);
  const tEnd = timeSec[timeSec.length - 1];

  // Create evenly spaced grid at fs Hz
  const grid = [];
  for (let t = 0; t <= tEnd; t += 1 / fs) {
    grid.push(t);
  }

  // Linear interpolation for each grid point
  const resampled = grid.map(t => {
    // Find surrounding data points
    let i = 0;
    while (i < timeSec.length - 1 && timeSec[i + 1] < t) i++;

    if (i >= timeSec.length - 1) return rmssdValues[rmssdValues.length - 1];

    const t1 = timeSec[i];
    const t2 = timeSec[i + 1];
    const v1 = rmssdValues[i];
    const v2 = rmssdValues[i + 1];

    // Linear interpolation
    return v1 + (v2 - v1) * (t - t1) / (t2 - t1);
  });

  return resampled;
}

// Calculate Pearson correlation coefficient
function pearsonR(arr1, arr2) {
  if (arr1.length === 0 || arr2.length === 0 || arr1.length !== arr2.length) return 0;

  const n = arr1.length;
  const mean1 = arr1.reduce((a, b) => a + b, 0) / n;
  const mean2 = arr2.reduce((a, b) => a + b, 0) / n;

  let sumCov = 0;
  let sumVar1 = 0;
  let sumVar2 = 0;

  for (let i = 0; i < n; i++) {
    const dev1 = arr1[i] - mean1;
    const dev2 = arr2[i] - mean2;
    sumCov += dev1 * dev2;
    sumVar1 += dev1 * dev1;
    sumVar2 += dev2 * dev2;
  }

  const sd1 = Math.sqrt(sumVar1 / n);
  const sd2 = Math.sqrt(sumVar2 / n);

  if (sd1 === 0 || sd2 === 0) return 0;
  return sumCov / (n * sd1 * sd2);
}

// Calculate synchrony (Pearson r) between two participants in a phase
// Returns { r, warning } where r is correlation or null if SYNC_LOST detected
export function calcSynchrony(rows1, rows2) {
  if (!rows1 || !rows2 || rows1.length === 0 || rows2.length === 0) {
    return { r: null, warning: 'Insufficient data' };
  }

  // Check for SYNC_LOST events
  const hasSyncLost1 = rows1.some(r => (r.event || '').includes('SYNC_LOST'));
  const hasSyncLost2 = rows2.some(r => (r.event || '').includes('SYNC_LOST'));

  if (hasSyncLost1 || hasSyncLost2) {
    return { r: null, warning: true };
  }

  // Resample both onto 1-second grid
  const resampled1 = resampleToGrid(rows1, 1);
  const resampled2 = resampleToGrid(rows2, 1);

  // Calculate Pearson r
  const r = pearsonR(resampled1, resampled2);

  return {
    r: r.toFixed(2),
    warning: false
  };
}
