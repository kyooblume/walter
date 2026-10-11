# WALTER — HRV Analyser

[English](#english) | [日本語](#日本語)

**Live app:** https://kyooblume.github.io/walter/NewIndex.html

| | |
|---|---|
| **Try it** | [Live app](https://kyooblume.github.io/walter/NewIndex.html) — runs in the browser, no install, no data upload |
| **Read the code** | This repository — vanilla JS modules (see *File Structure* below) |
| **Sample data** | CSV files recorded with HARVEY (RR intervals in ms) |

## English

WALTER is a browser-based Heart Rate Variability (HRV) analysis tool built for undergraduate psychology students.
It reads RR-interval CSV files recorded with **HARVEY** and calculates time-domain and frequency-domain HRV metrics.
All processing runs locally in the browser — no data is uploaded to any server.

**Key features**
- Artefact detection and correction (interpolate / delete / none, default 20% threshold, as in Kubios HRV)
- Time-domain (e.g. RMSSD, SDNN) and frequency-domain (FFT-based) metrics per experimental phase
- Interactive charts: tachogram, heart rate, Poincaré plot (zoom / pan)
- Batch processing of multiple participants, including HARVEY Duo pairs
- CSV / PNG export ready for SPSS


**Tech:** Vanilla JavaScript (ES modules), Chart.js, math.js, Papa Parse, GitHub Pages

## My contribution

WALTER is part of **CCTK (Caspar's Cool Toolkit)** by Prof. Caspar Addyman. During my 2026 placement at Leeds Trinity University I extended it together with fellow student Euan, working from a task list agreed with Caspar. The whole project — task specs, daily communication, commits and reviews — was carried out in English with a UK-based team.

**What I built / extended**
- **One pipeline for all files** — automatic file classification and a manifest screen that shows what was dropped (solo / Duo pair / demographics / missing partner) before processing; a persistent file tray during processing
- **HARVEY Duo support** — pairing `P001.1` / `P001.2` files from two devices and processing them together
- **Analysis features** — Poincaré plot identity line with **SD1 / SD2**, optional charts, data-quality CSV download
- **Fixes & publishing** — zoom reset, file-input and import bugs, **APA 7** chart preset

**Euan** built incremental processing, the unified output table, demographics input, chart export and output-layout options.

**Outcome** — The tool was demonstrated by Prof. Addyman at a staff training session, and the features I added to the HARVEY logger (BLE device scanning and extended CSV output) were adopted on both HARVEY devices.

## 日本語

WALTER は、心理学部の学生向けの、ブラウザで動く心拍変動（HRV）解析ツールです。
HARVEY で記録したRR間隔のCSVを読み込み、時間領域・周波数領域のHRV指標を計算します。
処理はすべてブラウザ内で完結し、データはサーバーに送信されません。

**主な機能**
- アーチファクトの検出と補正（補間・削除・なし。既定の閾値は20%）
- 実験フェーズごとの時間領域・周波数領域の指標
- タコグラム、心拍数、ポアンカレプロットのインタラクティブ表示
- 複数参加者の一括処理（HARVEY Duo のペアにも対応）
- SPSS で使える CSV / PNG 出力

**背景:** Caspar Addyman 教授の研究ツール群 CCTK の一部。2026年、Leeds Trinity Universityでのプレースメント中に、Euan さんと開発・機能拡張に参加しました。

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
