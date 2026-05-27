import { PHASE_COLORS, appState } from "./config.js";
import { handleArtefacts,getValidRows, calcPoincareSD } from "./HRVMaths.js";
import { getArtefactMethod, getThreshold } from "./ui.js";



const customCanvasBackgroundColor = {
  id: 'customCanvasBackgroundColor',
  beforeDraw: (chart,args,options) => {
    if(options.color && options.color !== 'transparent'){
      const{ctx} = chart;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = options.color;
      ctx.fillRect(0,0, chart.width, chart.height);
      ctx.restore();
    }
  }
};

Chart.register(customCanvasBackgroundColor);



let rrChartInst = null;
let hrChartInst = null;
let poincareChartInst = null;
let trajectoryChartInst = null;

// Read per-chart options from the collapsible options panel
// Falls back to safe defaults if the element doesn't exist yet
function getChartOptions(chartId) {
  const get = (id, fallback = false) => {
    const el = document.getElementById(`${chartId}_${id}`);
    return el ? el.checked : fallback;
  };
  const getVal = (id, fallback) => {
    const el = document.getElementById(`${chartId}_${id}`);
    return el && el.value !== '' ? parseFloat(el.value) : fallback;
  };
  const getRadio = (name, fallback) => {
    const el = document.querySelector(`input[name="${chartId}_${name}"]:checked`);
    return el ? el.value : fallback;
  };

  return {
    showPoints:       get('showPoints',       false),
    showPhaseShading: get('showPhaseShading', true),
    showArtefacts:    get('showArtefacts',    true),
    whiteBg:          get('whiteBg',          false),
    showGrid:         get('showGrid',         true),
    smoothing:        getRadio('smoothing',   'raw'),   // 'raw' | 'smooth'
    yMin:             getVal('yMin',          undefined),
    yMax:             getVal('yMax',          undefined),
  };
}


export function renderCharts(allValid, phases) {
  if (window.ChartAnnotation) {
    Chart.register(window.ChartAnnotation);
  }

  // Per-chart options (read from collapsible option panels)
  const rrOpts = getChartOptions('rrChart');
  const hrOpts = getChartOptions('hrChart');

  const startRow = appState.summaryData.allRows.find(r => (r.event || "").trim() === 'SESSION_START');
  const t0 = startRow ? parseFloat(startRow.timestamp_ms) : parseFloat(allValid[0].timestamp_ms);


  const method = getArtefactMethod();
  const threshold = getThreshold();
  const rawRR = allValid.map(r => parseFloat(r.rr_ms));

  const { isInterpolated, isDeleted, result: cleanedRR } = handleArtefacts(rawRR, method, threshold);

  const rrData = [];
  const hrData = [];
  const pointColors = [];
  const dotSizes = [];

  // Build a lookup map: timestamp → phase label
  // Used to show which phase each beat belongs to in the tooltip
  const timestampToPhase = {};
  phases.forEach(p => {
    p.rows.forEach(r => {
      timestampToPhase[r.timestamp_ms] = p.label;
    });
  });

  allValid.forEach((r, i) => {
    if (isDeleted[i]) return;

    const elapsedSec = ((parseFloat(r.timestamp_ms) - t0) / 1000).toFixed(2);
    const phaseLabel = timestampToPhase[r.timestamp_ms] || 'Unknown';
    const status     = isInterpolated[i] ? 'Interpolated' : 'Normal';

    // Store extra info in each point for the tooltip to display
    rrData.push({
      x:      elapsedSec,
      y:      cleanedRR[i],
      phase:  phaseLabel,
      status: status,
    });

    hrData.push({
      x: elapsedSec,
      y: parseFloat(r.hr_bpm),
      phase:  phaseLabel,
      status: status,
    });

    if (isInterpolated[i]) {
      // Artefact markers: always red, but hideable via showArtefacts option
      pointColors.push('#E02424');
      dotSizes.push(rrOpts.showArtefacts ? 4 : 0);
    } else {
      pointColors.push('#185FA5');
      dotSizes.push(rrOpts.showPoints ? 2 : 0);
    }
  });

  // Build annotation objects for phase boundary lines and labels
  const annotations = {};
  phases.forEach((p, i) => {
    if (i === 0) return;
    const t    = parseFloat(p.rows[0].timestamp_ms);
    const xVal = ((t - t0) / 1000).toFixed(2);
    const c    = PHASE_COLORS[i % PHASE_COLORS.length];
    annotations['line' + i] = {
      type: 'line', xMin: xVal, xMax: xVal,
      borderColor: c.border, borderWidth: 1.5, borderDash: [4, 3],
      label: {
        content: p.label, display: true, position: 'start',
        color: c.text, backgroundColor: c.bg,
        font: { size: 11 }, padding: 4, yAdjust: 8
      }
    };
  });

  // Build coloured background boxes for each phase (respects showPhaseShading option)
  const phaseBackgrounds = phases.map((p, i) => {
    const c    = PHASE_COLORS[i % PHASE_COLORS.length];
    const xMin = ((parseFloat(p.rows[0].timestamp_ms) - t0) / 1000).toFixed(2);
    const xMax = ((parseFloat(p.rows[p.rows.length - 1].timestamp_ms) - t0) / 1000).toFixed(2);
    return { type: 'box', xMin, xMax, backgroundColor: c.bg + '55', borderWidth: 0 };
  });

  // Build annotation sets for each chart (phase shading is per-chart option)
  const rrAnnotations  = { ...annotations };
  const hrAnnotations  = { ...annotations };
  if (rrOpts.showPhaseShading) phaseBackgrounds.forEach((b, i) => { rrAnnotations['bg' + i]  = b; });
  if (hrOpts.showPhaseShading) phaseBackgrounds.forEach((b, i) => { hrAnnotations['bg' + i]  = b; });

  // Destroy existing charts before creating new ones to avoid canvas conflicts
  if (rrChartInst) rrChartInst.destroy();
  if (hrChartInst) hrChartInst.destroy();

  // Shared chart options factory — accepts per-chart option object
  const makeOptions = (ylabel, annots, opts) => ({
    responsive: true, maintainAspectRatio: false, animation: false,
    elements: {
      point: { radius: 0 },
      line:  { borderWidth: 1.5, tension: opts.smoothing === 'smooth' ? 0.4 : 0 }
    },
    plugins: {
      customCanvasBackgroundColor: { color: opts.whiteBg ? '#ffffff' : 'transparent' },
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: ctx => `${ylabel}: ${ctx[0].parsed.y.toFixed(1)} ms`,
          label: ctx => {
            const pt = ctx.raw;
            if (!pt) return '';
            return [
              `Elapsed time : ${parseFloat(pt.x).toFixed(1)} s`,
              `Phase        : ${pt.phase  || '—'}`,
              `Status       : ${pt.status || 'Normal'}`,
            ];
          }
        }
      },
      annotation: { annotations: annots }, // Phase boundary lines and background boxes
      zoom: {
        zoom: {
          wheel:   { enabled: true },   // Mouse wheel zoom
          pinch:   { enabled: true },   // Mobile pinch zoom
          mode:    'x',                 // Only zoom on x axis (time)
        },
        pan: {
          enabled: true,
          mode:    'x',                 // Only pan on x axis
        },
        limits: {
          x: { min: 'original', max: 'original' },
        }
      }
    },
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: 'Time (s)', font: { size: 11 }, color: '#888780' },
        ticks: { font: { size: 11 }, color: '#888780' },
        grid:  { color: opts.showGrid ? '#F1EFE8' : 'transparent' }
      },
      y: {
        title: { display: true, text: ylabel, font: { size: 11 }, color: '#888780' },
        ticks: { font: { size: 11 }, color: '#888780' },
        grid:  { color: opts.showGrid ? '#F1EFE8' : 'transparent' },
        ...(opts.yMin !== undefined ? { min: opts.yMin } : {}),
        ...(opts.yMax !== undefined ? { max: opts.yMax } : {}),
      }
    }
  });


  rrChartInst = new Chart(document.getElementById('rrChart'), {
    type: 'line',
    data: { datasets: [{
      data: rrData,
      borderColor: '#185FA5',
      backgroundColor: 'transparent',
      pointBackgroundColor: pointColors,
      pointBorderColor: pointColors,
      pointRadius: dotSizes,
      pointHoverRadius: 6
    }]},
    options: makeOptions('RR (ms)', rrAnnotations, rrOpts)
  });

  hrChartInst = new Chart(document.getElementById('hrChart'), {
    type: 'line',
    data: { datasets: [{ data: hrData, borderColor: '#993C1D', backgroundColor: 'transparent', pointRadius: hrOpts.showPoints ? 2 : 0, pointHoverRadius: 6 }] },
    options: makeOptions('HR (bpm)', hrAnnotations, hrOpts)
  });

  // Double-click / double-tap resets zoom
  // Uses both ondblclick (PC) and touchstart timing (mobile)
  addDoubleClickReset('rrChart',       () => rrChartInst      && rrChartInst.resetZoom());
  addDoubleClickReset('hrChart',       () => hrChartInst      && hrChartInst.resetZoom());
}

export function renderPoincare(phases) {
  if (poincareChartInst) poincareChartInst.destroy();

  const pcOpts = getChartOptions('poincareChart');

  // Build one dataset per phase
  const datasets = phases.map((p, i) => {
    const c   = PHASE_COLORS[i % PHASE_COLORS.length];
    const rr  = getValidRows(p.rows).map(r => parseFloat(r.rr_ms));
    const points = [];
    for (let j = 0; j < rr.length - 1; j++) {
      points.push({ x: rr[j], y: rr[j + 1] });
    }
    const sd = calcPoincareSD(p.rows);
    // meanRR needed to centre the ellipse
    const meanRR = rr.length ? rr.reduce((a, b) => a + b, 0) / rr.length : 0;

    return {
      label:           p.label,
      data:            points,
      backgroundColor: c.border + '99',
      borderColor:     c.border,
      borderWidth:     0.5,
      pointRadius:     3,
      sd1:             parseFloat(sd.sd1),
      sd2:             parseFloat(sd.sd2),
      ratio:           sd.sd1_sd2_ratio,
      meanRR,
      phaseColor:      c.border,
    };
  });

  // Determine axis range across all points for the identity line
  const allRR = datasets.flatMap(d => d.data.flatMap(p => [p.x, p.y]));
  const minRR = allRR.length ? Math.min(...allRR) : 300;
  const maxRR = allRR.length ? Math.max(...allRR) : 1200;

  // Identity line: 45° dashed diagonal (RR[n] = RR[n+1])
  const annotations = {
    identityLine: {
      type:        'line',
      xMin: minRR, xMax: maxRR,
      yMin: minRR, yMax: maxRR,
      borderColor: '#BBBBBB',
      borderWidth: 1,
      borderDash:  [4, 4],
    }
  };

  // SD1/SD2 ellipse plugin — draws directly on the canvas in afterDraw
  // Centred on mean RR, axes = SD2 (along identity line) and SD1 (perpendicular)
  const sd1sd2EllipsePlugin = {
    id: 'sd1sd2Ellipse',
    afterDraw(chart) {
      const { ctx, scales: { x, y } } = chart;

      chart.data.datasets.forEach(dataset => {
        if (!dataset.sd1 || !dataset.sd2 || !dataset.meanRR) return;

        const cx = x.getPixelForValue(dataset.meanRR);
        const cy = y.getPixelForValue(dataset.meanRR);

        // Convert SD values from ms to pixels using the axis scale
        const pxPerMs = Math.abs(x.getPixelForValue(1) - x.getPixelForValue(0));
        const sd1px   = dataset.sd1 * pxPerMs;
        const sd2px   = dataset.sd2 * pxPerMs;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-Math.PI / 4); // 45° rotation — SD2 along identity line

        ctx.beginPath();
        ctx.ellipse(0, 0, sd2px, sd1px, 0, 0, 2 * Math.PI);
        ctx.strokeStyle = dataset.phaseColor;
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.stroke();
        ctx.restore();
      });
    }
  };

  poincareChartInst = new Chart(document.getElementById('poincareChart'), {
    type:    'scatter',
    data:    { datasets },
    plugins: [sd1sd2EllipsePlugin],
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           false,
      plugins: {
        customCanvasBackgroundColor: { color: pcOpts.whiteBg ? '#ffffff' : 'transparent' },
        legend: { display: true, position: 'top' },
        tooltip: {
          callbacks: {
            label: ctx => {
              const d = ctx.dataset;
              return [
                `RR[n]: ${ctx.parsed.x.toFixed(0)} ms,  RR[n+1]: ${ctx.parsed.y.toFixed(0)} ms`,
                `SD1: ${d.sd1} ms · SD2: ${d.sd2} ms · SD1/SD2: ${d.ratio}`,
              ];
            }
          }
        },
        annotation: { annotations },
        zoom: {
          zoom:   { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' },
          pan:    { enabled: true, mode: 'xy' },
          limits: { x: { min: 'original', max: 'original' }, y: { min: 'original', max: 'original' } }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'RR[n] (ms)', font: { size: 11 }, color: '#888780' },
          ticks: { font: { size: 11 }, color: '#888780' },
          grid:  { color: pcOpts.showGrid ? '#F1EFE8' : 'transparent' }
        },
        y: {
          title: { display: true, text: 'RR[n+1] (ms)', font: { size: 11 }, color: '#888780' },
          ticks: { font: { size: 11 }, color: '#888780' },
          grid:  { color: pcOpts.showGrid ? '#F1EFE8' : 'transparent' }
        }
      }
    }
  });

  // Update the card header to show SD1/SD2 values per phase
  const headerEl = document.querySelector('#card-poincareChart .card-title');
  if (headerEl) {
    const sdSummary = datasets.map(d =>
      `<span style="font-size:12px; font-weight:400; color:#5F5E5A; margin-left:12px;">${d.label}: SD1 ${d.sd1} ms · SD2 ${d.sd2} ms</span>`
    ).join('');
    headerEl.innerHTML = `Poincaré plot — RR[n] vs RR[n+1] ${sdSummary}`;
  }

  // Remove old SD legend div (values now in header)
  const oldLegend = document.getElementById('poincareSDLegend');
  if (oldLegend) oldLegend.remove();

  addDoubleClickReset('poincareChart', () => poincareChartInst && poincareChartInst.resetZoom());
}

// Helper: attaches both ondblclick (PC) and double-tap detection (mobile)
// to a canvas element, calling the provided reset function on activation
function addDoubleClickReset(canvasId, resetFn) {
  const el = document.getElementById(canvasId);
  if (!el) return;

  // PC: standard double-click
  el.ondblclick = resetFn;

  // Mobile: detect two taps within 300ms
  let lastTap = 0;
  el.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - lastTap < 300) {
      e.preventDefault(); // Prevent zoom-in browser default
      resetFn();
    }
    lastTap = now;
  }, { passive: false });
}

// Resets zoom on a chart back to the original full view
export function resetZoom(id) {
  if      (id === 'rrChart'            && rrChartInst)            rrChartInst.resetZoom();
  else if (id === 'hrChart'            && hrChartInst)            hrChartInst.resetZoom();
  else if (id === 'poincareChart'      && poincareChartInst)      poincareChartInst.resetZoom();
  else if (id === 'rmssdOverTimeChart' && rmssdOverTimeChartInst) rmssdOverTimeChartInst.resetZoom();
  else if (id === 'accelerometerChart' && accelerometerChartInst) accelerometerChartInst.resetZoom();
}

// ---- RR interval histogram ----
// Shows the distribution of RR interval durations as a bar chart
let histogramChartInst = null;

export function renderHistogram(allValid, phases) {
  if (histogramChartInst) histogramChartInst.destroy();

  const canvas = document.getElementById('histogramChart');
  if (!canvas) return;

  const opts = getChartOptions('histogramChart');

  // Build one dataset per phase
  const BIN_WIDTH = 25; // ms per bin
  const BIN_MIN   = 300;
  const BIN_MAX   = 2000;
  const binCount  = (BIN_MAX - BIN_MIN) / BIN_WIDTH;
  const labels    = Array.from({ length: binCount }, (_, i) => BIN_MIN + i * BIN_WIDTH);

  const datasets = phases.map((p, i) => {
    const c   = PHASE_COLORS[i % PHASE_COLORS.length];
    const rr  = getValidRows(p.rows).map(r => parseFloat(r.rr_ms));
    const bins = new Array(binCount).fill(0);

    rr.forEach(v => {
      const idx = Math.floor((v - BIN_MIN) / BIN_WIDTH);
      if (idx >= 0 && idx < binCount) bins[idx]++;
    });

    return {
      label:           p.label,
      data:            bins,
      backgroundColor: c.border + 'AA',
      borderColor:     c.border,
      borderWidth:     1,
    };
  });

  histogramChartInst = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           false,
      plugins: {
        customCanvasBackgroundColor: { color: opts.whiteBg ? '#ffffff' : 'transparent' },
        legend: { display: true, position: 'top' },
        tooltip: {
          callbacks: {
            title: ctx => `${ctx[0].label}–${parseInt(ctx[0].label) + BIN_WIDTH} ms`,
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y} beats`,
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'RR interval (ms)', font: { size: 11 }, color: '#888780' },
          ticks: { font: { size: 11 }, color: '#888780', maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
          grid:  { color: opts.showGrid ? '#F1EFE8' : 'transparent' }
        },
        y: {
          title: { display: true, text: 'Beat count', font: { size: 11 }, color: '#888780' },
          ticks: { font: { size: 11 }, color: '#888780' },
          grid:  { color: opts.showGrid ? '#F1EFE8' : 'transparent' }
        }
      }
    }
  });
}

// ---- RMSSD over time ----
// Rolling RMSSD calculated in a sliding window of N beats, plotted over elapsed time
let rmssdOverTimeChartInst = null;

export function renderRmssdOverTime(allValid, phases) {
  if (rmssdOverTimeChartInst) rmssdOverTimeChartInst.destroy();

  const canvas = document.getElementById('rmssdOverTimeChart');
  if (!canvas) return;

  const opts = getChartOptions('rmssdOverTimeChart');

  const startRow = appState.summaryData.allRows.find(r => (r.event || '').trim() === 'SESSION_START');
  const t0 = startRow ? parseFloat(startRow.timestamp_ms) : parseFloat(allValid[0].timestamp_ms);

  const WINDOW = 20; // rolling window size in beats
  const rmssdData = [];

  const rr = allValid.map(r => parseFloat(r.rr_ms));

  for (let i = WINDOW; i < rr.length; i++) {
    const window = rr.slice(i - WINDOW, i);
    const diffs  = window.slice(1).map((v, j) => v - window[j]);
    const rmssd  = Math.sqrt(diffs.map(d => d * d).reduce((a, b) => a + b, 0) / diffs.length);
    const elapsedSec = ((parseFloat(allValid[i].timestamp_ms) - t0) / 1000).toFixed(2);
    rmssdData.push({ x: elapsedSec, y: rmssd });
  }

  // Phase annotations (boundaries + optional shading)
  const annotations = {};
  const phaseBackgrounds = [];
  phases.forEach((p, i) => {
    if (i > 0) {
      const t    = parseFloat(p.rows[0].timestamp_ms);
      const xVal = ((t - t0) / 1000).toFixed(2);
      const c    = PHASE_COLORS[i % PHASE_COLORS.length];
      annotations['line' + i] = {
        type: 'line', xMin: xVal, xMax: xVal,
        borderColor: c.border, borderWidth: 1.5, borderDash: [4, 3],
        label: { content: p.label, display: true, position: 'start', color: c.text, backgroundColor: c.bg, font: { size: 11 }, padding: 4, yAdjust: 8 }
      };
    }
    if (opts.showPhaseShading) {
      const c    = PHASE_COLORS[i % PHASE_COLORS.length];
      const xMin = ((parseFloat(p.rows[0].timestamp_ms) - t0) / 1000).toFixed(2);
      const xMax = ((parseFloat(p.rows[p.rows.length - 1].timestamp_ms) - t0) / 1000).toFixed(2);
      phaseBackgrounds.push({ type: 'box', xMin, xMax, backgroundColor: c.bg + '55', borderWidth: 0 });
    }
  });
  phaseBackgrounds.forEach((b, i) => { annotations['bg' + i] = b; });

  rmssdOverTimeChartInst = new Chart(canvas, {
    type: 'line',
    data: { datasets: [{
      data:            rmssdData,
      borderColor:     '#3B6D11',
      backgroundColor: 'transparent',
      pointRadius:     opts.showPoints ? 2 : 0,
      pointHoverRadius: 5,
      borderWidth:     1.5,
      tension:         opts.smoothing === 'smooth' ? 0.4 : 0,
    }]},
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           false,
      plugins: {
        customCanvasBackgroundColor: { color: opts.whiteBg ? '#ffffff' : 'transparent' },
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ctx => `RMSSD: ${ctx[0].parsed.y.toFixed(1)} ms`,
            label: ctx => `Elapsed time: ${parseFloat(ctx.raw.x).toFixed(1)} s`,
          }
        },
        annotation: { annotations },
        zoom: {
          zoom:  { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
          pan:   { enabled: true, mode: 'x' },
          limits: { x: { min: 'original', max: 'original' } }
        }
      },
      scales: {
        x: {
          type:  'linear',
          title: { display: true, text: 'Time (s)', font: { size: 11 }, color: '#888780' },
          ticks: { font: { size: 11 }, color: '#888780' },
          grid:  { color: opts.showGrid ? '#F1EFE8' : 'transparent' },
          ...(opts.yMin !== undefined ? { min: opts.yMin } : {}),
        },
        y: {
          title: { display: true, text: `RMSSD (ms) — rolling ${WINDOW}-beat window`, font: { size: 11 }, color: '#888780' },
          ticks: { font: { size: 11 }, color: '#888780' },
          grid:  { color: opts.showGrid ? '#F1EFE8' : 'transparent' },
          ...(opts.yMin !== undefined ? { min: opts.yMin } : {}),
          ...(opts.yMax !== undefined ? { max: opts.yMax } : {}),
        }
      }
    }
  });

  addDoubleClickReset('rmssdOverTimeChart', () => rmssdOverTimeChartInst && rmssdOverTimeChartInst.resetZoom());
}

// ---- Accelerometer data ----
// Plots acc_x, acc_y, acc_z over time if the Harvey file contains these columns
let accelerometerChartInst = null;

export function renderAccelerometer(allRows, phases) {
  if (accelerometerChartInst) accelerometerChartInst.destroy();

  const canvas = document.getElementById('accelerometerChart');
  if (!canvas) return;

  const opts = getChartOptions('accelerometerChart');

  // Check if accelerometer columns exist
  const hasAcc = allRows.length > 0 && 'acc_x' in allRows[0];
  if (!hasAcc) {
    // Show a friendly message inside the canvas parent instead of a broken chart
    const parent = canvas.parentElement;
    let msg = document.getElementById('accNoDataMsg');
    if (!msg) {
      msg = document.createElement('p');
      msg.id = 'accNoDataMsg';
      msg.style.cssText = 'font-size:13px; color:#888780; text-align:center; padding:40px 0;';
      parent.appendChild(msg);
    }
    msg.textContent = 'Accelerometer columns (acc_x, acc_y, acc_z) not found in this file.';
    canvas.style.display = 'none';
    return;
  }

  // Remove any previous "no data" message
  const existingMsg = document.getElementById('accNoDataMsg');
  if (existingMsg) existingMsg.remove();
  canvas.style.display = 'block';

  const startRow = appState.summaryData.allRows.find(r => (r.event || '').trim() === 'SESSION_START');
  const t0 = startRow ? parseFloat(startRow.timestamp_ms) : parseFloat(allRows[0].timestamp_ms);

  const accData = { x: [], y: [], z: [] };
  allRows.forEach(r => {
    if (!r.acc_x) return;
    const elapsed = ((parseFloat(r.timestamp_ms) - t0) / 1000).toFixed(2);
    accData.x.push({ x: elapsed, y: parseFloat(r.acc_x) });
    accData.y.push({ x: elapsed, y: parseFloat(r.acc_y) });
    accData.z.push({ x: elapsed, y: parseFloat(r.acc_z) });
  });

  // Phase annotations
  const annotations = {};
  phases.forEach((p, i) => {
    if (i === 0) return;
    const t    = parseFloat(p.rows[0].timestamp_ms);
    const xVal = ((t - t0) / 1000).toFixed(2);
    const c    = PHASE_COLORS[i % PHASE_COLORS.length];
    annotations['line' + i] = {
      type: 'line', xMin: xVal, xMax: xVal,
      borderColor: c.border, borderWidth: 1.5, borderDash: [4, 3],
      label: { content: p.label, display: true, position: 'start', color: c.text, backgroundColor: c.bg, font: { size: 11 }, padding: 4, yAdjust: 8 }
    };
  });

  accelerometerChartInst = new Chart(canvas, {
    type: 'line',
    data: { datasets: [
      { label: 'X', data: accData.x, borderColor: '#185FA5', backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1, tension: 0 },
      { label: 'Y', data: accData.y, borderColor: '#993C1D', backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1, tension: 0 },
      { label: 'Z', data: accData.z, borderColor: '#3B6D11', backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1, tension: 0 },
    ]},
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           false,
      plugins: {
        customCanvasBackgroundColor: { color: opts.whiteBg ? '#ffffff' : 'transparent' },
        legend: { display: true, position: 'top' },
        annotation: { annotations },
        zoom: {
          zoom:  { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
          pan:   { enabled: true, mode: 'x' },
          limits: { x: { min: 'original', max: 'original' } }
        }
      },
      scales: {
        x: {
          type:  'linear',
          title: { display: true, text: 'Time (s)', font: { size: 11 }, color: '#888780' },
          ticks: { font: { size: 11 }, color: '#888780' },
          grid:  { color: opts.showGrid ? '#F1EFE8' : 'transparent' }
        },
        y: {
          title: { display: true, text: 'Acceleration (mg)', font: { size: 11 }, color: '#888780' },
          ticks: { font: { size: 11 }, color: '#888780' },
          grid:  { color: opts.showGrid ? '#F1EFE8' : 'transparent' }
        }
      }
    }
  });

  addDoubleClickReset('accelerometerChart', () => accelerometerChartInst && accelerometerChartInst.resetZoom());
}

// ---- RMSSD trajectory chart ----
// One line per participant showing RMSSD across phases
export function renderTrajectoryChart(rows) {
  if (trajectoryChartInst) trajectoryChartInst.destroy();

  const canvas = document.getElementById('trajectoryChart');
  if (!canvas) return;

  // Find all RMSSD columns and sort by phase number
  const rmssdCols = Object.keys(rows[0])
    .filter(k => k.endsWith('_RMSSD'))
    .sort();

  // X axis labels: phase names
  const labels = rmssdCols.map(c => c.replace('_RMSSD', '').replace(/_/g, ' '));

  // One dataset per participant
  const datasets = rows.map((row, i) => {
    // Cycle through a set of colours for individual lines
    const colours = ['#185FA5', '#993C1D', '#3B6D11', '#534AB7', '#BA7517',
                     '#0C7C7C', '#8B2E8B', '#2E6B2E', '#8B4513', '#4169E1'];
    const colour  = colours[i % colours.length];

    return {
      label:       row.ParticipantID || `P${i + 1}`,
      data:        rmssdCols.map(col => parseFloat(row[col]) || null),
      borderColor: colour,
      backgroundColor: colour + '33',
      borderWidth: 1.5,
      pointRadius: 4,
      tension:     0.2,
    };
  });

  trajectoryChartInst = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           false,
      plugins: {
        customCanvasBackgroundColor: { color: getChartOptions('trajectoryChart').whiteBg ? '#ffffff' : 'transparent' },
        legend: { display: true, position: 'right' },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(2) ?? '—'} ms`
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Phase', font: { size: 11 }, color: '#888780' },
          ticks: { font: { size: 11 }, color: '#888780' },
          grid:  { color: '#F1EFE8' }
        },
        y: {
          title: { display: true, text: 'RMSSD (ms)', font: { size: 11 }, color: '#888780' },
          ticks: { font: { size: 11 }, color: '#888780' },
          grid:  { color: '#F1EFE8' }
        }
      }
    }
  });
}

export function applyAPA7Style(id){
  const chart = Chart.getChart(id);
  if(!chart) return;

  chart.options.plugins.customCanvasBackgroundColor.color = 'transparent';

  ['x', 'y'].forEach(axis => {
    if(chart.options.scales[axis => {
      chart.options.scales[axis].grid.color = 'transparent';
      chart.options.scales[axis].ticks.color = 'black';
      chart.options.scales[axis].title.color = 'black';
    }
  ]);

  const annots = chart.options.plugins.annotation?.annotations;
  if(annots){
    Object.keys(annots).forEach(key => {
      if(annots[key].type === 'box') annots[key].backgroundColor = 'transparent';
    });
  }
  chart.update();
})
}