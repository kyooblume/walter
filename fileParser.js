import { appState } from "./config.js";
import { getValidRows,calcMetrics } from "./HRVMaths.js";

export function buildPhases(allRows){
        const phaseData = {};

        allRows.forEach(r => {
            const event = (r.event || '').trim();
            const rr = parseFloat(r.rr_ms);
            const phase = parseInt(r.phase,10);

            if(event!=='')return;
            if(!(rr >0)) return;
            if(isNaN(phase)) return;

            if (!phaseData[phase]){
                phaseData[phase] = [];
            }
            phaseData[phase].push(r);
        });
        const phaseNumbers = Object.keys(phaseData)
        .map(Number)
        .sort((a,b) => a-b);

        return phaseNumbers.map(n => ({
            label: appState.phaseLabels[n] || `Phase ${n}`,
            phaseNumber: n,
            rows: phaseData[n]
        }))
}

export function parseFilenameMeta(filename) {
  const baseName = filename.replace(/\.csv$/i, '');
  const parts    = baseName.split('_');
  const rawID    = parts[0] || 'unknown';

  // Detect Harvey Duo files — participant ID ends in .1 or .2
  // e.g. P001.1_D3-03-9A-46-91-9A_2026-05-12_14-30.csv
  const duoMatch  = rawID.match(/^(.+)\.([12])$/);
  const isDuo     = !!duoMatch;
  const baseID    = isDuo ? duoMatch[1] : rawID;   // e.g. P001
  const duoSuffix = isDuo ? duoMatch[2] : null;    // '1' or '2', or null

  // parts[1] is the H10 MAC address (dashes instead of colons)
  // e.g. D3-03-9A-46-91-9A → D3:03:9A:46:91:9A
  const macRaw   = parts[1] || 'unknown';
  const macClean = macRaw.replace(/-/g, ':');

  return {
    filename,
    participantID: rawID,      // full ID e.g. P001 or P001.1
    baseID,                    // base ID without Duo suffix e.g. P001
    isDuo,
    duoSuffix,                 // '1', '2', or null
    h10Mac: macClean,          // H10 sensor MAC address
    date:   parts[2] || 'unknown',
    time:   (parts[3] || 'unknown').replace(/-/g, ':'),
  };
}

// Parse a single CSV file and return one row of metrics
export function parseBatchFile(file, method, threshold) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: function(res) {
        const allRows = res.data;
        const cols    = res.meta.fields || [];

        if (!cols.includes('rr_ms') || !cols.includes('timestamp_ms')) {
          resolve(null);
          return;
        }

        const validRows = getValidRows(allRows);
        if (validRows.length < 10) { resolve(null); return; }

        const phases = buildPhases(allRows);
        const meta   = parseFilenameMeta(file.name);

        // Build one row: participantID + metrics per phase
        const row = { ParticipantID: meta.participantID };

        phases.forEach(p => {
          const phaseValid = getValidRows(p.rows);
          const m          = calcMetrics(phaseValid, method, threshold);
          if (!m) return;

          // SPSS-safe column names: no spaces, no special chars, no leading numbers
          const prefix = `${sanitiseColName(p.label)}_`;
          row[prefix + 'RMSSD']    = m.rmssd;
          row[prefix + 'SDNN']     = m.sdnn;
          row[prefix + 'MeanHR']   = m.meanHR;
          row[prefix + 'MeanRR']   = m.meanRR;
          row[prefix + 'pNN50pct'] = m.pnn50;
          row[prefix + 'MinRR']    = m.minRR;
          row[prefix + 'MaxRR']    = m.maxRR;
          row[prefix + 'Duration'] = m.duration;
          row[prefix + 'Beats']    = m.count;
        });

        resolve(row);
      },
      error: function(err) { reject(err); }
    });
  });
}

export function sanitiseColName(label) {
  return label
    .replace(/[^a-zA-Z0-9_]/g, '_') // Replace special chars with underscore
    .replace(/^(\d)/, 'P$1');        // Prefix with P if starts with a number
}