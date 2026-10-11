# WALTER — HRV Analyser

A browser-based Heart Rate Variability (HRV) analysis tool for undergraduate psychology students.

| | |
|---|---|
| **Try it** | [Live app](https://kyooblume.github.io/walter/NewIndex.html) — runs in the browser, no install, no data upload |
| **Read the code** | This repository — vanilla JavaScript ES modules (see *File structure*) |
| **Input data** | CSV files of RR intervals recorded with HARVEY |

[English](#english) | [日本語](#日本語)

## English

### Why
Psychology students record heart activity in lab classes but need a simple, transparent way to turn raw RR intervals into HRV metrics and figures for their reports — without installing software or uploading participant data.

### What it does
1. **Reads HARVEY CSV files** (RR intervals, phases) — single files, batches of participants, HARVEY Duo pairs (`P001.1` / `P001.2`) and an optional demographics file.
2. **Cleans the data** — physiological range filter (300–2000 ms) and artefact detection (beat-to-beat change above a threshold, default 20%), with three correction methods: interpolate (default), delete, or none.
3. **Calculates HRV metrics per phase**
   - Time domain: mean HR, RMSSD, SDNN, pNN50
   - Frequency domain (FFT): LF, HF, LF/HF (requires ≥ 60 s of data)
   - Poincaré: SD1, SD2, SD1/SD2
4. **Visualises** — tachogram, heart rate, Poincaré plot with identity line, histogram, RMSSD over time, accelerometer and trajectory charts (zoom / pan).
5. **Exports** — SPSS-ready CSV (one row per participant), data-quality CSV, and PNG charts named `{participant}_{chart}_{phases}_{date}.png`.

**Privacy by design:** all processing happens in the browser. No data is sent to a server.

### Context
WALTER is part of **CCTK (Caspar's Cool Toolkit)** by Prof. Caspar Addyman. I worked on it as a Junior Developer during my placement at Leeds Trinity University (Apr–May 2026) together with fellow student Euan, from a task list agreed with Caspar. Communication, task specs, commits and reviews were in English.

### My contribution
Based on the commit history of this repository:
- **File pipeline** — automatic file classification, a manifest screen showing what was loaded before processing, and a persistent file tray
- **HARVEY Duo support** — pairing files from two devices and processing them together
- **Analysis & charts** — Poincaré identity line with SD1 / SD2, optional charts, data-quality CSV download
- **Fixes** — zoom reset, file-input and import bugs; APA 7 chart preset (with Euan)

**Euan** built incremental processing, the unified output table, demographics input, chart download/copy and output-layout options.

**Outcome** — WALTER was demonstrated by Prof. Addyman at a staff training session, and the features I added to the HARVEY logger (BLE device scanning and extended CSV output) were adopted on both HARVEY devices.

**Tech:** JavaScript (ES modules), Chart.js (+ annotation / zoom plugins), math.js (FFT), Papa Parse, GitHub Pages

## 日本語

心理学部の学生向けの、ブラウザで動く心拍変動（HRV）解析ツールです。HARVEY で記録したRR間隔のCSVを読み込みます。

- **データ処理**：生理的範囲フィルタ（300–2000 ms）。前拍との差が閾値（既定20%）を超える拍をアーチファクトとして検出し、補間・削除・処理なしから選択できます。
- **指標**：平均心拍数、RMSSD、SDNN、pNN50、LF・HF・LF/HF（FFT、60秒以上）、SD1・SD2
- **可視化**：タコグラム、心拍数、ポアンカレプロット、ヒストグラム、RMSSDの推移など
- **出力**：SPSS向けCSV、データ品質CSV、PNG
- **プライバシー**：処理はすべてブラウザ内で行い、データは送信しません。

**担当**：2026年4〜5月、Leeds Trinity University でのプレースメント（Junior Developer）で、Caspar Addyman 教授の CCTK の一部として、Euan さんと開発に参加しました。私は主に、ファイルの自動分類と確認画面、HARVEY Duo 対応、SD1/SD2 と任意グラフ、データ品質CSV、各種バグ修正を担当しました。WALTER は教授によりスタッフ研修でデモされ、私が HARVEY に追加した機能（BLE デバイス検索、CSV 出力の拡張）は HARVEY 2台に採用されました。

---

## File structure

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

## Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| Chart.js | 4.4.0 | Charts |
| chartjs-plugin-annotation | 3.0.1 | Phase boundary lines |
| chartjs-plugin-zoom | 2.0.1 | Zoom and pan |
| hammerjs | 2.0.8 | Touch support |
| mathjs | 12.4.0 | FFT for frequency domain |
| Papa Parse | 5.4.1 | CSV parsing |

## Limitations
- Designed for HARVEY's CSV format; other devices' exports are not supported.
- Frequency-domain metrics need at least 60 seconds of clean data per phase.
- No participant data is included in this repository.
