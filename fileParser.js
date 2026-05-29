import { appState } from "./config.js";
import { getValidRows, calcMetrics, calculateDataQuality, calcFrequencyDomain } from "./HRVMaths.js";

//gets rid of invalid rows and groups heartbeats 
//by there phase number and then sorts them into 
//groups

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

        // Collect per-phase data so the manifest path can render this
        // session's individual charts when its tray row is clicked.
        const phaseMetrics = [];

        phases.forEach(p => {
          const phaseValid = getValidRows(p.rows);
          const m          = calcMetrics(phaseValid, method, threshold);
          if (!m) return;

          phaseMetrics.push({ label: p.label, m });

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

        // Per-phase data quality (same calc the single-file UI uses)
        const phaseQuality = phases.map((p, i) => {
          const phaseValid = getValidRows(p.rows);
          return { label: p.label, q: calculateDataQuality(p.rows, phaseValid, phaseMetrics[i]?.m) };
        });

        // Frequency-domain metrics (per phase + session). Guarded — short
        // recordings throw a warning but shouldn't crash the whole parse.
        let sessionFreq = null;
        let phaseFreq   = null;
        try {
          sessionFreq = calcFrequencyDomain(validRows);
          phaseFreq   = phases.map(p => ({
            label: p.label,
            f:     calcFrequencyDomain(getValidRows(p.rows))
          }));
        } catch (e) { /* ignore — leave as null */ }

        // Non-enumerable wrapper keeps existing CSV builders unaffected:
        // Object.keys(row) won't pick this up.
        Object.defineProperty(row, '_details', {
          value: {
            fileName:       file.name,
            meta,
            allRows,
            allValid:       validRows,
            phases,
            sessionMetrics: calcMetrics(validRows, method, threshold),
            phaseMetrics,
            phaseQuality,
            sessionFreq,
            phaseFreq,
          },
          enumerable: false,
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

//check file column name to figure
//out if it contains heart rate data
// or demographics or somthing else

function detectFileKind(file){
  return new Promise(resolve =>{
    Papa.parse(file, {
      header: true,
      preview: 1,
      skipEmptyLines: true,
      complete: res => {

        const cols = res.meta.fields || [];
        const hasRR = cols.includes('rr_ms');
        const hasTime = cols.includes('timestamp_ms');
        const hasPID = cols.includes('ParticipantID');

        if(hasRR && hasTime) return resolve('harvey');
        if(hasPID && !hasRR) return resolve('demographics');
        resolve('unknown');
      },
      error: () => resolve('unknown')
    });
  });
}

//this sorts files into 
//into demographics and heart rate data 
// and groups matching heart rate sessions and 
//also flags any missing parter data 
export async function classifyFiles(fileList){
  const sessions = [];
  const warnings = [];
  const demographics = [];
  const harveyFiles = [];


  for(const file of fileList){
    if(!file.name.toLowerCase().endsWith('.csv')){
      warnings.push(`${file.name} not a CSV. Skipped`);
      continue;
    }

    const kind = await detectFileKind(file);
    if(kind === 'harvey') harveyFiles.push(file);
    else if (kind === 'demographics') demographics.push(file)
    else warnings.push(`${file.name} — not a recognised Harvey or demographics file. Skipped.`)
  }

  const parsed = harveyFiles.map(f => ({ file:f, meta: parseFilenameMeta(f.name)}));
  const duoCandidates = parsed.filter(p => p.meta.isDuo);
  const soloFiles = parsed.filter(p=> !p.meta.isDuo);

  const duoGroups = new Map();
  for(const p of duoCandidates) {
    const key = `${p.meta.baseID}__${p.meta.date}`;
    if (!duoGroups.has(key)) duoGroups.set(key,[]);
    duoGroups.get(key).push(p);
  }

  for(const[key,group] of duoGroups) {
    const has1 = group.find(p => p.meta.duoSuffix === '1')
    const has2 = group.find(p => p.meta.duoSuffix === '2')

    if(has1 && has2){
      sessions.push({
        kind:'duo-pair',
        baseID: has1.meta.baseID,
        date:   has1.meta.date,   // ← was has1.file (the File object itself)
        file1:  has1.file,
        file2:  has2.file,
        meta1:  has1.meta,
        meta2:  has2.meta,        // ← was 'meta'; dev guide and processDuoPair expect meta2
      });
    } else{
      const orphan = has1 || has2;
      const missing = has1 ? `.2` : `.1`

      sessions.push({
        kind: 'duo-unmatched',
        baseID: orphan.meta.baseID,
        date: orphan.meta.date,
        file: orphan.file,
        meta: orphan.meta,
        missingPair: missing,
      });
      warnings.push(
        `${orphan.file.name} - duo file with no ${missing} partner.`+
        `Will be processed as solo unles exclude unmatched Duo files is ticked`
      );
    }
  }


  for(const p of soloFiles){
    sessions.push({
      kind:'solo',
      baseID: p.meta.baseID,
      date:p.meta.date,
      file: p.file,
      meta: p.meta,
    })
  }

  const seen = new Set();
  for(const s of sessions){
    const id = s.kind === 'duo-pair' ? `${s.baseID} (pair)` : s.baseID;
    if(seen.has(id)){
      warnings.push(`${id} appears more than once in this drop. Check before processing`)
    }
    seen.add(id);
  }

  return { sessions, warnings, demographics };

}