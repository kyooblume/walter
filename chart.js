import { PHASE_COLORS, theseVaribales } from "./config.js";
import { handleArtefacts,getValidRows } from "./HRVMaths.js";
import { getArtefactMethod, getThreshold } from "./ui.js";


let rrChartInst = null;
let hrChartInst = null;
let poincareChartInst = null;
let trajectoryChartInst = null;


export function renderCharts(allValid, phases) {
  // Explicitly register the annotation plugin with Chart.js
  // Required in Chart.js v4 — loading the script alone is not enough
  if (window.ChartAnnotation) {
    Chart.register(window.ChartAnnotation);
  }

  const startRow = theseVaribales.summaryData.allRows.find(r => (r.event || "").trim() === 'SESSION_START');
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
      pointColors.push('#E02424');
      dotSizes.push(4);
    } else {
      pointColors.push('#185FA5');
      dotSizes.push(0);
    }
  });

  // Build annotation objects for phase boundary lines and labels
  const annotations = {};
  phases.forEach((p, i) => {
    if (i === 0) return; // No boundary line needed before the first phase
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

  // Build coloured background boxes for each phase
  const phaseBackgrounds = phases.map((p, i) => {
    const c    = PHASE_COLORS[i % PHASE_COLORS.length];
    const xMin = ((parseFloat(p.rows[0].timestamp_ms) - t0) / 1000).toFixed(2);
    const xMax = ((parseFloat(p.rows[p.rows.length - 1].timestamp_ms) - t0) / 1000).toFixed(2);
    return { type: 'box', xMin, xMax, backgroundColor: c.bg + '55', borderWidth: 0 };
  });

  const allAnnotations = { ...annotations };
  phaseBackgrounds.forEach((b, i) => { allAnnotations['bg' + i] = b; });

  // Destroy existing charts before creating new ones to avoid canvas conflicts
  if (rrChartInst) rrChartInst.destroy();
  if (hrChartInst) hrChartInst.destroy();

  // Shared chart options factory — used for both tachogram and HR chart
  const makeOptions = (ylabel, annots) => ({
    responsive: true, maintainAspectRatio: false, animation: false,
    elements: { point: { radius: 0 }, line: { borderWidth: 1.5, tension: 0.2 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          // Title shows the metric value
          title: ctx => `${ylabel}: ${ctx[0].parsed.y.toFixed(1)} ms`,
          // Body shows elapsed time, phase and interpolation status
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
          x: { min: 'original', max: 'original' }, // Can't pan beyond original data
        }
      }
    },
    scales: {
      x: { type: 'linear', title: { display: true, text: 'Time (s)', font: { size: 11 }, color: '#888780' }, ticks: { font: { size: 11 }, color: '#888780' }, grid: { color: '#F1EFE8' } },
      y: { title: { display: true, text: ylabel, font: { size: 11 }, color: '#888780' }, ticks: { font: { size: 11 }, color: '#888780' }, grid: { color: '#F1EFE8' } }
    }
  });


  rrChartInst = new Chart(document.getElementById('rrChart'),{

    type:'line',
    data: {datasets: [{
    data: rrData,
    borderColor: '#185FA5',
    backgroundColor: 'transparent',
    pointBackgroundColor: pointColors,
    pointBorderColor: pointColors,
    pointRadius: dotSizes,
    pointHoverRadius: 6

    }]},

    options: makeOptions('RR (ms)',allAnnotations)

  })

  hrChartInst = new Chart(document.getElementById('hrChart'), {
    type: 'line',
    data: { datasets: [{ data: hrData, borderColor: '#993C1D', backgroundColor: 'transparent' }] },
    options: makeOptions('HR (bpm)', allAnnotations)
  });
}

export function renderPoincare(phases) {
  if (poincareChartInst) poincareChartInst.destroy();

  // Build one dataset per phase, each with its own colour
  const datasets = phases.map((p, i) => {
    const c      = PHASE_COLORS[i % PHASE_COLORS.length];
    const rr     = getValidRows(p.rows).map(r => parseFloat(r.rr_ms));

    // Create (RR[n], RR[n+1]) pairs
    const points = [];
    for (let j = 0; j < rr.length - 1; j++) {
      points.push({ x: rr[j], y: rr[j + 1] });
    }

    return {
      label:           p.label,
      data:            points,
      backgroundColor: c.border + '99', // Semi-transparent fill
      borderColor:     c.border,
      borderWidth:     0.5,
      pointRadius:     3,
    };
  });

  poincareChartInst = new Chart(document.getElementById('poincareChart'), {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           false,
      plugins: {
        legend: { display: true, position: 'top' },
        tooltip: {
          callbacks: {
            label: ctx => `RR[n]: ${ctx.parsed.x.toFixed(0)}ms, RR[n+1]: ${ctx.parsed.y.toFixed(0)}ms`
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'RR[n] (ms)', font: { size: 11 }, color: '#888780' },
          ticks: { font: { size: 11 }, color: '#888780' },
          grid:  { color: '#F1EFE8' }
        },
        y: {
          title: { display: true, text: 'RR[n+1] (ms)', font: { size: 11 }, color: '#888780' },
          ticks: { font: { size: 11 }, color: '#888780' },
          grid:  { color: '#F1EFE8' }
        }
      }
    }
  });
}

// Resets zoom on a chart back to the original full view
export function resetZoom(id) {
  const inst = id === 'rrChart' ? rrChartInst : hrChartInst;
  if (inst) inst.resetZoom();
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