import { theseVaribales } from "./config.js";
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
        const CurrentphaseNumbers = Object.keys(phaseData)
        .map(Number)
        .sort((a,b) => a-b);

        return CurrentphaseNumbers.map(n => ({
            label: theseVaribales.phaseLabels[n] || `Phase ${n}`,
            CurrentphaseNumbers:n,
            rows:phaseData[n]
        }))
}

export function parseFilenameMeta(filename){
    const baseName = filename.replace(/\.csv$/i,"")
    const parts = baseName.split("_")
    return{
        filename:filename,
        participantID:parts[0]||'unknown',
        sessionType:parts[1]||"Unknown",
        date:parts[2]||"Unknown"
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