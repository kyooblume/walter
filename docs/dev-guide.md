# WALTER — Developer Guide

## Architecture

WALTER is a static single-page app hosted on GitHub Pages. All processing runs in the browser — no server, no database, no login required.

### Module structure

| File | Responsibility |
|------|---------------|
| `index.js` | Main entry point — file upload, app flow, settings changes |
| `config.js` | Shared constants — phase colours, global state |
| `HRVMaths.js` | All HRV calculations — artefact handling, metrics, frequency domain |
| `fileParser.js` | CSV parsing, phase construction, batch file processing |
| `chart.js` | Chart rendering — tachogram, HR, Poincaré, trajectory |
| `ui.js` | UI rendering — tables, panels, legend, artefact settings |
| `export.js` | CSV and PNG export |

---

## Artefact Handling

### What is an artefact?

An artefact is an RR interval that does not represent a true heartbeat — caused by movement, electrode displacement, or electrical interference. A single artefact can inflate RMSSD significantly, so handling must be applied before any metric is calculated.

### Detection

An RR interval is flagged if it deviates from the preceding interval by more than the threshold:

```
diff = |RR[i] - RR[i-1]| / RR[i-1]
if diff > threshold → artefact
```

### Three methods

**Interpolate (default)**
Replaces the artefact with the average of surrounding beats. Keeps the series continuous, avoids the deletion boundary problem, and matches the approach used by Kubios HRV. Default threshold is 20% — the standard value in HRV research.

**Delete**
Removes the beat entirely. Creates a gap — the beats either side were not truly consecutive, so their difference is excluded from RMSSD calculation (`deletedIndices` Set tracks these gaps).

**None**
No Stage 2 filtering. Only the physiological range filter (300–2000ms) is applied.

### Why parsed data is stored globally

`parsedAllValid` and `parsedPhases` store uploaded data in memory so settings changes recalculate instantly without re-uploading.

### Methods statement

`generateMethodsStatement()` produces a sentence the student can copy into their report. The same text is written as a comment line in the exported CSV.

---

## Frequency Domain Analysis

### Why FFT?

The supervisor specified FFT. FFT (Fast Fourier Transform) decomposes the RR interval series into frequency components — identifying how much variation occurs at each frequency. It is ~100x faster than the equivalent DFT.

### Step 1 — Resampling at 4 Hz

FFT requires evenly spaced data. RR intervals are recorded at irregular timestamps so they are resampled onto a 4Hz grid using linear interpolation.

**Why 4 Hz:** The Nyquist theorem requires sampling at least twice the highest frequency of interest (HF max = 0.40 Hz → minimum 0.80 Hz). 4 Hz is the conventional standard (Task Force, 1996) used by Kubios HRV.

**Why linear interpolation:** Simple, widely used in HRV research, same as Kubios.

### Step 2 — FFT via mathjs

mathjs returns a complex number for each frequency bin:

```
Complex number: a + bi
  Real part (a)      → strength in the cosine direction
  Imaginary part (b) → strength in the sine direction
  Power = a² + b²    → total strength regardless of phase
```

Power is used (not just the real part) because a wave starting at its peak and the same wave starting at zero have the same strength but different real parts. Power gives the correct result regardless of phase.

**Why mathjs:** well-documented, available via CDN, no build step required.

### Step 3 — LF and HF bands

```
LF: 0.04 – 0.15 Hz  (blood pressure rhythms, sympathetic + parasympathetic)
HF: 0.15 – 0.40 Hz  (respiratory frequency, parasympathetic / vagal)
LF/HF ratio          (sympathovagal balance — higher = more stress)
```

Band definitions from: Task Force of the European Society of Cardiology (1996). *Heart rate variability: standards of measurement, physiological interpretation and clinical use.* Circulation, 93(5), 1043–1065.

VLF (0.003–0.04 Hz) is not implemented — it requires 5+ minutes of stable data and short Harvey sessions may not meet this requirement.

### Minimum data length

LF lower bound is 0.04 Hz (25 second period). At least 2 full cycles needed → minimum ~60s per phase. WALTER shows a warning in the summary table if a phase is too short.

---

## Other Design Decisions

**Why browser-only:** Participant heart rate data never leaves the device — important for university research ethics approval.

**Why Chart.register() is needed:** Chart.js v4 requires plugins to be explicitly registered — loading the script tag alone is not sufficient.

**Phase grouping:** Phases are grouped by the `phase` column value, not timestamp boundaries. Matches the Harvey CSV format.

**SESSION_START anchor:** Elapsed time is calculated from the `SESSION_START` event row to correctly handle the H10 clock offset.

---

## Known Limitations (v1)

- Frequency domain requires ~60s per phase for reliable LF estimation
- VLF not implemented
- Batch upload uses default artefact settings if the single-file panel is not visible
