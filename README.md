# WALTER — HRV Analyser

A browser-based Heart Rate Variability analysis tool for undergraduate psychology students.

**Live app:** https://kyooblume.github.io/walter/NewIndex.html

---

## What is WALTER?

WALTER accepts CSV files produced by HARVEY and calculates time-domain and frequency-domain HRV metrics. All analysis runs entirely in the browser — no data is sent to any server.

---

## File Structure

```
walter/
├── NewIndex.html     — HTML structure and CDN imports
├── NewIndex.css      — Styles and dark mode
├── index.js          — Main entry point and app logic
├── config.js         — Shared variables and phase colours
├── HRVMaths.js       — HRV calculations and artefact handling
├── fileParser.js     — CSV parsing and phase construction
├── chart.js          — Chart rendering
├── ui.js             — UI rendering
├── export.js         — CSV and PNG export
└── docs/
    └── dev-guide.md  — Developer guide and design decisions
```

---

## Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| Chart.js | 4.4.0 | Charts |
| chartjs-plugin-annotation | 3.0.1 | Phase boundary lines |
| chartjs-plugin-zoom | 2.0.1 | Zoom and pan |
| hammerjs | 2.0.8 | Touch support |
| mathjs | 12.4.0 | FFT for frequency domain |
| Papa Parse | 5.4.1 | CSV parsing |
