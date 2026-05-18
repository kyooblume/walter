# Walter — Development Guide

Read the whole document before writing any code. If anything is unclear, ask before coding — fixing a misunderstanding before you start is far cheaper than after.

---

## The shape of the work

Walter today has two separate tabs (Single / Batch) and three separate processing paths. Harvey Duo would add another path. This is going to be confusing for students who are not typically fluent in data processing.

The simplification: **one drop zone, one pipeline, one output table.** Students drop any combination of files — solo, Duo paired, unpaired Duo, batch, mixed — and Walter figures out the rest.

```
┌────────────────────┐     ┌────────────────────┐     ┌────────────────────┐
│   1. DATA IMPORT   │ ──▶ │  2. DATA PROCESS   │ ──▶ │  3. DATA DOWNLOAD  │
│   Drop anything    │     │   Classify, parse, │     │   Long CSV         │
│   Walter classifies│     │   compute metrics  │     │   Quality CSV      │
│   Show manifest    │     │   per participant  │     │   Optional charts  │
└────────────────────┘     └────────────────────┘     └────────────────────┘
```

**The default output is one row per participant.** Duo participants get their own row, just like solo participants — with two extra columns (`PairID`, `IsDuoPaired`) linking the pair for analysis in SPSS/JASP. A checkbox in Processing Options lets the researcher request the alternative paired layout (P1/P2 side-by-side in one row).

Charts are a separate, optional layer. The tachogram is on by default. All other charts are off by default. Each chart has its own PNG download button.

---

## Important: Harvey filename format has changed

Read this section before touching the parser.

When Walter was first built, Harvey filenames looked like:

```
P001_REST_2026-04-03_14-32.csv
```

The four parts were: participant ID, session type, date, time.

**Harvey no longer includes session type.** Current format:

```
P001_D3-03-9A-46-91-9A_2026-05-12_14-30.csv
```

The four parts are now: participant ID, H10 sensor MAC address (dashes replace colons), date, time.

For Harvey Duo, the participant ID gets a `.1` or `.2` suffix indicating which Harvey device recorded the file:

```
P001.1_D3-03-9A-46-91-9A_2026-05-12_14-30.csv   (participant 1)
P001.2_XX-XX-XX-XX-XX-XX_2026-05-12_14-30.csv   (participant 2)
```

The base participant ID is `P001`. Walter must detect the suffix automatically — the student should never need to select "Duo mode" manually.

---

## Input scenarios Walter must handle

| Files dropped | Walter detects | Walter does |
|---|---|---|
| One solo CSV | Solo session | Process, output one row. |
| Multiple solo CSVs | Multiple solos | Process all, output one row per participant. |
| `.1` and `.2` with matching base ID + date | Duo pair | Process together (clock-align). One row per participant by default; one row per pair if checkbox ticked. |
| Multiple Duo pairs | Multiple pairs | Same as above for each pair. |
| Mix of solo and Duo | Mixed | One table. Solo rows have `IsDuoPaired = FALSE`. Duo rows have `IsDuoPaired = TRUE` and a shared `PairID`. |
| `.1` or `.2` with no partner | Unmatched Duo | Treat as solo with `IsDuoPaired = FALSE`. If "Exclude unmatched Duo files" is ticked, skip with warning. |
| CSV with `ParticipantID` but no `rr_ms`/`timestamp_ms` | Demographics file | Match rows to loaded sessions by ID, attach for export. |
| File with fewer than 10 valid RR intervals | Insufficient data | Skip with warning in manifest. |
| Non-CSV or missing required columns | Unrecognisable | Skip with warning. |
| A folder | Folder contents | Scan for `.csv` files, classify each, ignore everything else. |
| A participant ID already loaded | Duplicate | Ask: "Replace, or keep both?" |

---

## Output shape — one rule

**One row per participant. One column per measure per phase.**

```
ParticipantID, PairID, IsDuoPaired, [demographics], 
Phase1_RMSSD, Phase1_SDNN, Phase1_MeanHR, Phase1_pNN50,
Phase1_LF, Phase1_HF, Phase1_LFHF, Phase1_SD1, Phase1_SD2,
Phase1_Duration, Phase1_Beats,
Phase2_RMSSD, ...
```

This loads into SPSS or JASP with no reformatting.

For Duo sessions, `PairID = P001` links `P001.1` and `P001.2`. The researcher uses this column in SPSS for any paired or multilevel analysis.

If the researcher ticks **"Combine Duo pairs into single rows"** in Processing Options, the layout switches: one row per Duo pair, with `P1` and `P2` prefixed columns, plus `PhaseN_Synchrony_r`. Solo participants still get their own row with empty `P2` columns. This is the only output-shape choice the researcher makes.

---

## Tasks

There are 16 tasks across 3 groups. Do the bug fixes first. Tasks 2.1–2.5 must be done in order because each depends on the last.

### File touch map

| File | Tasks |
|------|-------|
| `config.js` | 1.6, 2.5, 4.1 |
| `HRVMaths.js` | 1.6, 3.3, 4.2, 6.2 |
| `fileParser.js` | 1.3, 1.4, 1.6, 2.1, 2.2, 3.1 |
| `chart.js` | 1.1, 1.5, 1.6, 3.1, 3.2, 3.3, 3.4 |
| `ui.js` | 1.3, 1.4, 1.6, 2.3, 2.4, 2.6, 3.1, 3.2, 4.3 |
| `export.js` | 1.7, 2.6, 3.5, 6.1, 6.2 |
| `index.js` | 1.2, 1.6, 2.1, 2.3, 2.4, 2.5, 4.2 |
| `NewIndex.html` → `index.html` | 2.1, 2.3, 2.6, 3.1, 4.1, 4.3 |
| `NewIndex.css` → `index.css` | 2.1, 4.1, 4.3 |
| new `LICENSE` | 4.2 |

---

## Group 1 — Fix existing bugs

Do these first. They are small and unblock everything else.

### Task 1.1 — Double-click to reset zoom

**Files:** `chart.js`

The text under each chart says "Double-click to reset" but nothing listens for it. After each `new Chart(...)` call in `renderCharts()` and `renderPoincare()`, add:

```js
document.getElementById('rrChart').addEventListener('dblclick', () => rrChartInst.resetZoom());
document.getElementById('hrChart').addEventListener('dblclick', () => hrChartInst.resetZoom());
document.getElementById('poincareChart').addEventListener('dblclick', () => poincareChartInst.resetZoom());
```

The current code attaches `el.ondblclick = resetFn` inside `addDoubleClickReset()` but the helper is only wired up for `rrChart`, `hrChart`, and `poincareChart` after their second creation in `renderCharts()` — the path is brittle. Use `addEventListener` and keep the touch fallback already in `addDoubleClickReset`.

---

### Task 1.2 — Settings change loses filename

**Files:** `index.js`

In `onSettingsChange()`, the last line replaces `summaryData` wholesale, overwriting `fileName`, `allRows`, `allValid`, and `phasesRaw` with `undefined`. After this, any download is named `walter_summary.csv` regardless of participant.

Replace the last line with:

```js
appState.summaryData = {
  ...appState.summaryData,    // keeps fileName, allRows, allValid, phasesRaw
  session: sessionMetrics,
  phases:  phaseMetrics,
  method,
  threshold
};
```

---

### Task 1.3 — Filename parser is wrong

**Files:** `fileParser.js`, `ui.js`

`parseFilenameMeta()` reads `parts[1]` as `sessionType`. In the current format `parts[1]` is the H10 MAC address. Walter shows "Session: D3-03-9A-46-91-9A" on screen.

Replace the function with:

```js
export function parseFilenameMeta(filename) {
  const baseName  = filename.replace(/\.csv$/i, '');
  const parts     = baseName.split('_');
  const rawID     = parts[0] || 'unknown';

  // Detect Harvey Duo files (ID ends in .1 or .2)
  const duoMatch  = rawID.match(/^(P\d+)\.([12])$/);
  const isDuo     = !!duoMatch;
  const baseID    = isDuo ? duoMatch[1] : rawID;    // e.g. P001
  const duoSuffix = isDuo ? duoMatch[2] : null;     // '1' or '2', or null

  // parts[1] is the MAC address, dashes instead of colons
  const macRaw    = parts[1] || 'unknown';
  const macClean  = macRaw.replace(/-/g, ':');

  return {
    filename,
    participantID: rawID,    // full ID, e.g. P001 or P001.1
    baseID,                  // base ID without suffix
    isDuo,
    duoSuffix,               // '1', '2', or null
    h10Mac: macClean,
    date:   parts[2] || 'unknown',
    time:   (parts[3] || 'unknown').replace(/-/g, ':'),
  };
}
```

In `renderSessionMeta()` in `ui.js`: remove the "Session:" line; add "H10 sensor:" showing `meta.h10Mac`; if `meta.isDuo`, add a "Harvey Duo" badge next to the participant ID.

---

### Task 1.4 — Phase label renaming does not work

**Files:** `fileParser.js`, `ui.js`

In `renderLegend()`, the input calls `updatePhaseLabel(${p.phaseNumber}, ...)`. But `buildPhases()` returns the phase number under the key `CurrentphaseNumbers`. The names do not match, so renaming fails silently.

In `buildPhases()`, rename the key to `phaseNumber` and check every place the phase object is read.

---

### Task 1.5 — Typo in Poincaré zoom limits

**Files:** `chart.js`

`'orrginal'` should be `'original'`. Find it in the Poincaré chart options and fix it.

(Note: the current code may not have a y-axis zoom limit on the Poincaré plot at all — if so, add one when adding identity line and ellipse in Task 3.3.)

---

### Task 1.6 — Rename the state object

**Files:** all `.js` files

The state object is currently called `theseVaribales` (misspelled, and the name doesn't describe what it holds). Find and replace `theseVaribales` with `appState` across every file: `config.js`, `index.js`, `ui.js`, `chart.js`, `export.js`, `fileParser.js`, `HRVMaths.js`.

Do this early — before anyone else writes new code using the old name.

---

### Task 1.7 — Data quality table has no download button

**Files:** `NewIndex.html`, `export.js`

Researchers need to report data quality in their methods section. Add a Download button to the data quality card. In `export.js`, write `downloadQualityCSV()` exporting phase name, beats recorded, beats retained, beats handled, percentage retained, rating. One row per phase. (Group 3 Task 3.5 extends this to multi-participant batches.)

---

## Group 2 — One pipeline for all files

This is the architectural core. Do these tasks in order: each one builds on the last.

### Task 2.1 — One drop zone replaces the three tabs

**Files:** `NewIndex.html`, `NewIndex.css`, `index.js`, `fileParser.js`

Remove the three tab buttons and three separate panels. Replace with a single drop zone:

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│   Drop Harvey CSV files here — or click to select   │
│                                                      │
│   Single files, multiple files, or whole folders.   │
│   Walter will figure out the rest.                  │
│                                                      │
│         [Choose files]      [Choose folder]          │
└──────────────────────────────────────────────────────┘
```

The "Choose folder" button uses `webkitdirectory` on the file input:

```html
<input type="file" id="folderInput" webkitdirectory multiple style="display:none;">
```

When a folder is dropped, recursively walk it and collect every `.csv`. Everything else is ignored.

Delete the existing batch-tab code. The single-file path is replaced by the unified pipeline below.

---

### Task 2.2 — Automatic file classification

**Files:** `fileParser.js`

The classifier is the brain of the new import. It is the only place where Walter decides what kind of session each file represents. Everything downstream treats every session the same way.

Add this to `fileParser.js`. It is intentionally written so students can copy and adapt:

```js
// Reads file headers to determine the file type without parsing the whole file.
// Resolves to one of: 'harvey', 'demographics', 'unknown'.
function detectFileKind(file) {
  return new Promise(resolve => {
    Papa.parse(file, {
      header: true,
      preview: 1,                  // read only the first data row
      skipEmptyLines: true,
      complete: res => {
        const cols = res.meta.fields || [];
        const hasRR    = cols.includes('rr_ms');
        const hasTime  = cols.includes('timestamp_ms');
        const hasPID   = cols.includes('ParticipantID');

        if (hasRR && hasTime)    return resolve('harvey');
        if (hasPID && !hasRR)    return resolve('demographics');
        resolve('unknown');
      },
      error: () => resolve('unknown')
    });
  });
}

// Main classifier. Pass an array of File objects. Returns a manifest object
// describing every session Walter intends to process, plus warnings.
export async function classifyFiles(fileList) {
  const sessions      = [];       // each: { kind, ... } described below
  const warnings      = [];       // strings shown in the manifest
  const demographics  = [];       // raw demographics file objects, parsed later
  const harveyFiles   = [];

  // ----- Pass 1: detect file kind -----
  for (const file of fileList) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      warnings.push(`${file.name} — not a CSV. Skipped.`);
      continue;
    }
    const kind = await detectFileKind(file);
    if (kind === 'harvey')         harveyFiles.push(file);
    else if (kind === 'demographics') demographics.push(file);
    else warnings.push(`${file.name} — not a recognised Harvey or demographics file. Skipped.`);
  }

  // ----- Pass 2: parse Harvey filenames and group Duo pairs by baseID + date -----
  const parsed = harveyFiles.map(f => ({ file: f, meta: parseFilenameMeta(f.name) }));
  const duoCandidates = parsed.filter(p => p.meta.isDuo);
  const soloFiles     = parsed.filter(p => !p.meta.isDuo);

  // Group Duo files by baseID + date so P001.1 and P001.2 from the same day pair up
  const duoGroups = new Map();
  for (const p of duoCandidates) {
    const key = `${p.meta.baseID}__${p.meta.date}`;
    if (!duoGroups.has(key)) duoGroups.set(key, []);
    duoGroups.get(key).push(p);
  }

  // ----- Pass 3: emit one session per pair or per unmatched Duo file -----
  for (const [key, group] of duoGroups) {
    const has1 = group.find(p => p.meta.duoSuffix === '1');
    const has2 = group.find(p => p.meta.duoSuffix === '2');

    if (has1 && has2) {
      sessions.push({
        kind:    'duo-pair',
        baseID:  has1.meta.baseID,
        date:    has1.meta.date,
        file1:   has1.file,
        file2:   has2.file,
        meta1:   has1.meta,
        meta2:   has2.meta,
      });
    } else {
      // Unmatched Duo file — treat as solo, warn the user
      const orphan  = has1 || has2;
      const missing = has1 ? `.2` : `.1`;
      sessions.push({
        kind:        'duo-unmatched',
        baseID:      orphan.meta.baseID,
        date:        orphan.meta.date,
        file:        orphan.file,
        meta:        orphan.meta,
        missingPair: missing,
      });
      warnings.push(
        `${orphan.file.name} — Duo file with no ${missing} partner. ` +
        `Will be processed as solo unless 'Exclude unmatched Duo files' is ticked.`
      );
    }
  }

  // ----- Pass 4: solo sessions -----
  for (const p of soloFiles) {
    sessions.push({
      kind: 'solo',
      baseID: p.meta.baseID,
      date:   p.meta.date,
      file:   p.file,
      meta:   p.meta,
    });
  }

  // ----- Pass 5: detect duplicate participant IDs across the dropped files -----
  // (Duplicates against already-loaded sessions are handled later by the file tray.)
  const seen = new Set();
  for (const s of sessions) {
    const id = s.kind === 'duo-pair' ? `${s.baseID} (pair)` : s.baseID;
    if (seen.has(id)) {
      warnings.push(`${id} appears more than once in this drop. Check before processing.`);
    }
    seen.add(id);
  }

  return { sessions, warnings, demographics };
}
```

The session objects this returns are the *only* thing the rest of the pipeline cares about. The output table never asks "was this file a solo or a Duo?" — it asks the session object what kind it is and acts accordingly.

---

### Task 2.3 — Manifest screen

**Files:** `ui.js`, `index.js`, `NewIndex.html`

After classification, show a preview before processing runs. Students drop the wrong folder, mix old files with new, forget one device — the manifest lets them catch this before wasting time on a full processing run.

```
Walter found 7 items. Please check before continuing.

  ✓  P001.1 + P001.2    Harvey Duo pair         2026-05-12   [Remove]
  ✓  P002.1 + P002.2    Harvey Duo pair         2026-05-12   [Remove]
  ✓  P003               Solo session            2026-05-12   [Remove]
  ✓  P004, P005         Solo sessions (2)       2026-05-12   [Remove]
  ✓  demographics.csv   Demographics — 8 rows   matched      [Remove]
  ⚠  P006.1             Duo file — P006.2 missing            [Remove]

  ☐ Exclude unmatched Duo files from output

                              [+ Add more files]   [Process files]
```

Each row has [Remove]. "[+ Add more files]" opens the file picker without clearing the list — the new files are run through `classifyFiles()` and merged.

Warnings to display:

- Duo file missing partner: see Task 2.2.
- Too few beats: "P007 — only 6 valid RR intervals (minimum is 10). Will be skipped."
- Duplicate participant ID: "P001 is already in the list. Replace it or keep both?"

The checkbox **"Exclude unmatched Duo files from output"** is the only choice that affects classifier behaviour. Unticked (default): unmatched Duo files are processed as solo. Ticked: they are skipped entirely.

---

### Task 2.4 — File tray (persistent during processing)

**Files:** `ui.js`, `index.js`, `NewIndex.html`, `NewIndex.css`

After processing starts, the manifest disappears but a smaller persistent panel — the file tray — stays visible while the user looks at results. Without this, the only way to add a missing Duo partner or remove a wrong file is to start over.

```
SESSION TRAY
────────────────────────────────────────────
P001  ●  P001.1 + P001.2   Duo pair   [✕]
P002  ●  P002.1 + P002.2   Duo pair   [✕]
P003  ●  solo                          [✕]
P006  ⚠  P006.1 — [+ Add P006.2]      [✕]
────────────────────────────────────────────
[+ Add files]
```

Rules:

- Only show the tray when 2+ sessions are loaded (clutter for a single file).
- Clicking a row navigates to that session's results. Current session is highlighted.
- [✕] removes the session and updates the output table.
- [+ Add files] opens the file picker — new files go through the manifest and merge.
- If a `.1` file sits alone, show "[+ Add P006.2]" as an invitation.
- If a dropped file matches an ID already loaded: "P001.1 is already loaded. Replace it?"

---

### Task 2.5 — Incremental processing

**Files:** `config.js`, `index.js`

Currently uploading a new file re-processes all files. A student with 20 participants should not wait for 20 re-processes because they added one.

Refactor `appState` to hold a session registry — a `Map` that you add to rather than replace:

```js
export const appState = {
  sessions: new Map(),
  // key:   string  e.g. 'P001' (solo) or 'P001-pair' (Duo pair)
  // value: {
  //   kind:          'solo' | 'duo-pair' | 'duo-unmatched',
  //   participants:  [{ id, meta, allRows, allValid, phases, metrics, quality, freq }],
  //   demographics:  { Age: 22, Gender: 'F', ... } | null,
  //   pairID:        'P001' | null,
  //   synchrony:     [{ phase, r, warning }] | null,
  // }
  demographics:  new Map(),    // participantID → row object
  phaseLabels:   {},
  options: {
    excludeUnmatchedDuo:  false,
    combinePairedRows:    false,    // Task 4.2 — checkbox in Processing Options
    artefactMethod:       'interpolate',
    threshold:            20,
    enabledCharts: {
      tachogram:     true,
      hr:            false,
      rmssd:         false,
      poincare:      false,
      histogram:     false,
      accelerometer: false,
    },
  }
};
```

Adding a file adds an entry. Removing a file deletes it. The output table and group summary are *always* rebuilt from whatever is currently in the Map. There is no second source of truth.

---

### Task 2.6 — Single unified output table

**Files:** `ui.js`, `export.js`, `NewIndex.html`

This task replaces both the current single-file summary table and the batch summary table with one unified table. The same code runs whether the registry holds 1 session or 50.

Layout: one row per participant. Columns:

```
ParticipantID, PairID, IsDuoPaired, [demographics columns...],
Phase1_RMSSD, Phase1_SDNN, Phase1_MeanHR, Phase1_pNN50,
Phase1_LF, Phase1_HF, Phase1_LFHF, Phase1_SD1, Phase1_SD2,
Phase1_Duration, Phase1_Beats,
Phase2_RMSSD, ...
```

For a Duo pair, emit *two rows* by default — one for `P001.1`, one for `P001.2`, both sharing `PairID = P001`. Solo rows have empty `PairID`. Use `sanitiseColName()` already in `fileParser.js` for SPSS-safe headers.

When **"Combine Duo pairs into single rows"** is ticked (Task 4.2's checkbox), the row builder emits one row per pair instead, with `P1_` and `P2_` column prefixes plus `PhaseN_Synchrony_r`. Solo participants still get their own row, with empty `P2_` and synchrony columns.

`downloadCSV()` exports exactly what is on screen. No comment lines (SPSS dislikes them).

Below the main table, render the group summary (mean ± SD per column) using the existing `renderGroupSummaryTable()` — no changes needed there.

---

## Group 3 — Duo, charts, and demographics

### Task 3.1 — Demographics: file upload and manual entry

**Files:** `fileParser.js`, `ui.js`, `index.js`, `NewIndex.html`

Demographics let researchers run group comparisons without copy-pasting in Excel afterwards. Walter supports two paths to the same end state:

**Path A — demographics file.** A CSV with a `ParticipantID` column but no `rr_ms`/`timestamp_ms` is classified as demographics in `detectFileKind()`. Parse with Papa Parse. Match each row to a loaded session by `ParticipantID`. Accept whatever columns are in the file — no restriction.

Matching rules:

- `P001` in the demographics file matches session `P001`.
- For Duo, `P001` matches both `P001.1` and `P001.2` unless separate rows for `.1` and `.2` exist.

Example:

```
ParticipantID, Age, Gender, Condition, AnxietyScore
P001, 22, Female, Control, 14
P002, 24, Male, Stress, 21
```

**Path B — manual entry.** In the manifest and file tray, each session can be expanded to reveal a small form. Default fields: Age (number) and Gender (open text). An "[+ Add field]" button asks for a column name (e.g. "Condition") and adds that field to every session in the tray at once.

```
▼  P001 — solo
   Age: [22]   Gender: [_______]   Condition: [Control]   [+ Add field]
```

Demographics from either path go into `appState.demographics` and are treated identically by every export.

**Privacy notice:** whenever demographics are present anywhere in the app, show this on the page:

> ℹ All data, including demographics, is processed entirely in your browser. Nothing is sent to any server.

Place this on the page itself, not just an About modal. Students need it for ethics submissions.

---

### Task 3.2 — Optional charts

**Files:** `chart.js`, `ui.js`, `NewIndex.html`

Add a "Charts" section to the Processing Options panel:

```
CHARTS
☑ Tachogram (RR intervals over time)        — on by default
☐ Heart rate over time                      — off by default
☐ RMSSD over time                           — off by default  ← new
☐ Poincaré plot                             — off by default
☐ RR interval histogram                    — off by default  ← new
☐ Accelerometer data                        — off by default  ← new
```

When unchecked, the chart card is hidden and `renderChart()` is not called. When checked, the card appears and the chart renders immediately. The underlying data is processed regardless — turning a chart off saves render time, not processing time.

State lives in `appState.options.enabledCharts` (see Task 2.5).

Each chart card has its own [Download PNG] button (already partly there) and a [Copy] button (Task 3.4).

**Chart options inside each card** — a small collapsible panel. Options apply to that chart only. Each option updates immediately via `chart.update()` — no recalculation:

| Option | Control | Default | Notes |
|---|---|---|---|
| Show data points | Checkbox | Off | `pointRadius` 0 or 3. Red artefact dots always visible — they are diagnostic. |
| Show phase shading | Checkbox | On | Toggles coloured backgrounds. Boundary lines stay. |
| Show artefact markers | Checkbox | On | Toggles red dots for interpolated beats. |
| White background | Checkbox | Off | Useful for report exports. |
| Smoothing | Radio: Raw / Smooth | Raw | Line tension 0 or 0.4. Display only. |
| Lock Y axis | Min / Max inputs | Auto | For comparing sessions. |
| Grid lines | Checkbox | On | |

For the Poincaré plot the relevant options are: identity line (on), SD1/SD2 ellipse (on), white background (off).

---

### Task 3.3 — Poincaré identity line and SD1/SD2

**Files:** `chart.js`, `HRVMaths.js`, `ui.js`

Two things every published Poincaré plot has, both currently missing from Walter.

**Identity line.** A 45° dashed diagonal. Add as a Chart.js annotation:

```js
annotations['identityLine'] = {
  type: 'line',
  xMin: minRR, xMax: maxRR,
  yMin: minRR, yMax: maxRR,
  borderColor: '#BBBBBB',
  borderWidth: 1,
  borderDash:  [4, 4],
};
```

**SD1 and SD2.** Short and long axes of the point cloud.

```
SD1 = √( ½ × RMSSD² )
SD2 = √( 2 × SDNN² − ½ × RMSSD² )
```

Add `calcSD1SD2(rrArray)` to `HRVMaths.js`. Draw the ellipse with a custom Chart.js plugin in the `afterDraw` hook — centred on mean RR, rotated 45°, radii SD1 and SD2. No extra library needed.

Display the values in the Poincaré card header:

```
SD1: 32 ms    SD2: 58 ms    [Reset zoom]    [Download PNG]
```

Add SD1 and SD2 columns to the main output table and to the CSV export.

---

### Task 3.4 — Chart download, copy, and APA7 preset

**Files:** `chart.js`, `export.js`, `ui.js`

Three small things grouped together.

**Filename for PNG downloads.** Already partly there in `export.js`. Confirm the format:

```
{participantID}_{chartName}_{visiblePhases}_{date}.png
e.g. P001_tachogram_Phase1-Phase2_2026-05-12.png
```

If the chart is zoomed to show a subset of phases, the filename reflects what is visible — students reported this is the easiest way to keep multiple downloads identifiable.

**Title strip on downloaded images.** When downloading, create a canvas 40px taller, draw a white strip at the top with the title text, then the chart below. Export the combined canvas. The title makes a folder of downloaded charts navigable.

**Copy button** next to each Download PNG button:

```js
canvas.toBlob(blob =>
  navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
);
```

Change button text to "Copied!" for 1.5s.

**APA7 style preset.** A button in each chart card. Clicking it applies: transparent background, no gridlines, no top/right axis borders, all text 10pt, all lines 1px, black + dark grey colours (prints clearly in greyscale), no phase background shading (boundary lines remain). A "Reset style" button restores defaults. Both use `chart.update()`.

---

### Task 3.5 — Data quality CSV across all participants

**Files:** `export.js`

Task 1.7 added a per-session quality download. Extend it so that with multiple sessions loaded, the download contains one block per participant:

```
ParticipantID, Phase, BeatsRecorded, BeatsRetained, BeatsHandled, PercentRetained, Rating
P001, Phase 1, 412, 398, 14, 96.6%, Good
P001, Phase 2, 408, 401,  7, 98.3%, Good
P002, Phase 1, ...
```

One CSV, readable by a human, importable to SPSS. Include the artefact handling methods statement as a `# methods` comment line at the top — researchers paste this into their write-up.

---

## Group 4 — Duo processing, output options, housekeeping

### Task 4.1 — Duo pair processing

**Files:** `index.js`, `fileParser.js`, `HRVMaths.js`, `config.js`

Apart from clock alignment, Duo files go through exactly the same pipeline as solo files.

Write `processDuoPair(session)` where `session` is the `{ kind: 'duo-pair', file1, file2, meta1, meta2 }` object from the classifier. Three steps:

**1 — Clock alignment.** Find `SESSION_START` in each file. Calculate:

```
clockOffset = SESSION_START in file2 - SESSION_START in file1
```

Subtract `clockOffset` from every timestamp in file2. Both files now share file1's time axis. This is the only clock correction needed.

**2 — Phase structure.** Read phase boundaries from file1 only. Apply them to the time-corrected file2. Do not read phases from file2 independently — Harvey 1 is the source of truth for timing. If file2's phase count differs (should not happen in normal use), show a warning and use the lower count.

**3 — Per-participant metrics.** For each phase, call the existing `calcMetrics()` once per participant. Then call `calcSynchrony()`:

```js
// in HRVMaths.js
export function calcSynchrony(rows1, rows2) {
  // 1. Extract rmssd_ms from each (Harvey writes a rolling RMSSD per row).
  // 2. Resample both onto a 1-second grid via linear interpolation.
  // 3. Pearson r between the two series.
  // 4. Round to 2 d.p.
  // If either set contains a SYNC_LOST event, return { r: null, warning: true }.
}
```

One synchrony value per phase. The researcher decides what to do with it.

**SYNC_LOST handling:** if either file has a `SYNC_LOST` event during a phase, synchrony for that phase is `null` and `syncWarning = true`. This becomes a column in the CSV so the researcher can decide whether to exclude.

Store the result on the session object:

```js
session.participants = [
  { id: 'P001.1', meta, allRows, allValid, phases, metrics, quality, freq },
  { id: 'P001.2', meta, allRows, allValid, phases, metrics, quality, freq },
];
session.synchrony = [
  { phase: 'Phase 1', r: 0.73, warning: false },
  { phase: 'Phase 2', r: 0.81, warning: false },
];
session.pairID = 'P001';
```

---

### Task 4.2 — Output layout toggle

**Files:** `ui.js`, `export.js`, `NewIndex.html`

In the Processing Options panel, add:

```
OUTPUT LAYOUT
☐ Combine Duo pairs into single rows (P1/P2 side-by-side)
```

Off by default. When off, the output is the standard long format (Task 2.6). When on, the row builder emits one row per Duo pair with `P1_` and `P2_` prefixes plus `PhaseN_Synchrony_r`. Solo participants still get their own row with empty `P2_` columns — students should be able to mix solo and Duo participants in one dataset either way.

The toggle is the *only* output-shape decision the researcher makes. Everything else — Duo detection, clock alignment, synchrony, demographics matching — happens automatically.

When the toggle changes, rebuild the table from `appState.sessions` in place. Do not reprocess any files.

---

### Task 4.3 — CSV filename, Cohen's d, About + footer + licence

**Files:** `export.js`, `HRVMaths.js`, `ui.js`, `NewIndex.html`, `NewIndex.css`, new `LICENSE`, rename `NewIndex.{html,css}` → `index.{html,css}`

A bundle of small polish items.

**Per-participant CSV filename.** Currently every export saves as `walter_summary.csv` and overwrites the last. Change to:

```js
link.download = `${participantID}_${date}_walter_summary.csv`;
// e.g. P001_2026-05-12_walter_summary.csv
```

For the combined output (multiple participants), keep a sensible default like `walter_batch_{date}.csv`.

**Cohen's d** in the summary table. Standard effect size; psychology students are often required to report it. Shown only when exactly 2 phases are present, alongside "Change (abs)" and "Change (%)".

```js
export function cohensD(mean1, sdnn1, n1, mean2, sdnn2, n2) {
  const pooledSD = Math.sqrt(
    ((n1 - 1) * sdnn1 ** 2 + (n2 - 1) * sdnn2 ** 2) / (n1 + n2 - 2)
  );
  return pooledSD > 0 ? ((mean2 - mean1) / pooledSD).toFixed(3) : '—';
}
```

Label: "Cohen's d (approx)". Footnote: "SDNN used as the standard deviation estimate."

**About page and footer.** A persistent footer on every page. "About Walter" opens a modal with: a short paragraph explaining what Walter is, developer names + contacts or GitHub links, link to the repo, version number, suggested APA citation, MIT licence statement. Add `export const VERSION = '1.1.0'` to `config.js`.

**MIT licence.** Create a `LICENSE` file in the repo root with the standard MIT text. Fill in the current year and your names. Add the licence badge to the README:

```md
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
```

Your names stay in the GitHub history as the original authors — even after the repo is transferred or forked.

**Rename index files.** GitHub Pages serves `index.html` by default. Walter currently lives at `NewIndex.html`, so the root URL serves the old original file. Rename `NewIndex.html` → `index.html` and `NewIndex.css` → `index.css`. Update the `<link>` inside the HTML. Delete the old files.

**Update the README** with: the new features, the Harvey Duo section, the updated file structure, and a "Citing Walter" section.

---

## Suggested order of work

Roughly two to three weeks.

1. **Bug fixes first** (Group 1). Everything else gets harder if you build on top of the bugs.
2. **The new pipeline second** (Group 2, in order). Tasks 2.1 → 2.6. This is the single biggest piece of work in the sprint and unblocks everything in Groups 3 and 4.
3. **Duo + demographics + charts in parallel** (Groups 3 and 4). Once the pipeline is in, these can be split between people. The file touch map at the top tells you who can work on what without colliding.
4. **Housekeeping last** (Task 4.3). The licence, About page, and rename are small. Do them at the end so you don't trip over `index.html` vs `NewIndex.html` while everything else is in flux.

Always do Task 1.6 (rename `theseVaribales` → `appState`) early — before two people are writing new code with the old name.

---

## What we are not building this round

To keep the scope manageable, the following are deferred:

- **Autonomic balance summary card** — colour-coded labels for RMSSD/HR/LF-HF. Useful, but not core to producing SPSS-ready data.
- **Interpretation guide** — collapsible explainer of what each metric means. Belongs on a future "Help" page.
- **Full HTML report download** — bundling everything into one printable file. The CSV exports and individual PNG downloads cover the workflow students actually need.

These are all good ideas. They will return in a later iteration once the core pipeline is solid.
