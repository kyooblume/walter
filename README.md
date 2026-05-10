# walter
Leeds Placement product

By clicking this, can connect to walter
https://kyooblume.github.io/walter/NewIndex.html

---

## Developer Guide

### Frequency Domain Analysis — Design Decisions

#### Overview
Frequency domain metrics (LF power, HF power, LF/HF ratio) are calculated using the Fast Fourier Transform (FFT). This section documents the methods chosen and the rationale behind each decision.

---

#### Why FFT?
The supervisor specified FFT as the required method for frequency domain analysis. FFT (Fast Fourier Transform) decomposes the RR interval series into its constituent frequency components — identifying how much of the signal's variation occurs at each frequency. It is mathematically equivalent to the Discrete Fourier Transform (DFT) but runs approximately 100x faster by exploiting symmetry in the calculation.

---

#### Step 1 — Resampling at 4 Hz (linear interpolation)

**Why resampling is necessary**

FFT requires evenly spaced data points. RR intervals are recorded at irregular timestamps (one per heartbeat), so they must be resampled onto a regular time grid before FFT can be applied.

**Why 4 Hz**

The Nyquist theorem states that the sampling rate must be at least twice the highest frequency of interest. The highest frequency we analyse is HF at 0.40 Hz:

```
0.40 Hz × 2 = 0.80 Hz minimum sampling rate
```

4 Hz is the conventional standard in HRV research (Task Force, 1996) — it provides sufficient headroom above the Nyquist limit and is used by Kubios HRV and other reference implementations.

**Why linear interpolation**

Linear interpolation was chosen over cubic spline or other methods because:
- It is simple to implement and understand, appropriate for a student-facing tool
- It is widely used in published HRV research
- It introduces minimal distortion for typical HRV data
- Kubios HRV uses the same approach

---

#### Step 2 — FFT using mathjs

**What FFT returns**

For each frequency bin, FFT returns a complex number with a real part and an imaginary part:

```
Complex number: a + bi
  Real part (a) → strength in the cosine direction
  Imaginary part (b) → strength in the sine direction
```

These two components exist because waves have phase (timing offset). A wave starting at its peak looks different mathematically from the same wave starting at zero — the real and imaginary parts capture this. However, for LF/HF calculation we only care about the strength of each frequency component, not its phase.

**Why power = real² + imaginary²**

Power is calculated as the sum of squares of the real and imaginary parts:

```
Power = a² + b²
```

This gives the same result regardless of phase, so a 0.1 Hz component is correctly identified as strong whether it starts at its peak, its trough, or anywhere in between. Using only the real part would give misleading results depending on the phase of the signal.

**Why mathjs**

mathjs was selected because:
- It provides a well-documented FFT implementation for JavaScript
- It is already available as a CDN import in the existing WALTER stack
- No additional installation or build step is required
- It is actively maintained

---

#### Step 3 — LF and HF frequency bands

**Band definitions**

```
LF (Low Frequency):  0.04 – 0.15 Hz
HF (High Frequency): 0.15 – 0.40 Hz
```

These ranges are defined by the international standard:

> Task Force of the European Society of Cardiology and the North American Society of Pacing and Electrophysiology. "Heart rate variability: standards of measurement, physiological interpretation and clinical use." *Circulation*, 93(5), 1043–1065. (1996)

This paper established the LF and HF band definitions that are used universally in HRV research, including by Kubios HRV.

**Physiological meaning of the bands**

```
HF (0.15 – 0.40 Hz)
  Corresponds to respiratory frequency in humans
  (9–24 breaths/min = 0.15–0.40 Hz)
  Reflects parasympathetic (vagal) activity
  Primarily influenced by breathing

LF (0.04 – 0.15 Hz)
  Corresponds to blood pressure regulation rhythms
  Influenced by both sympathetic and parasympathetic activity
  Often used as a marker of sympathetic modulation
  (though this interpretation is debated in the literature)

LF/HF ratio
  Proposed as an index of sympathovagal balance
  Higher ratio → relatively more sympathetic activity (stress)
  Lower ratio → relatively more parasympathetic activity (relaxation)
  Note: the LF/HF ratio is contested in recent literature;
  RMSSD remains the most robust time-domain HRV index
```

**VLF (Very Low Frequency: 0.003 – 0.04 Hz) — not implemented**

VLF requires very long recordings (typically 5+ minutes of stable data per phase) to estimate reliably. Given that Harvey sessions may not always meet this requirement, VLF was excluded from v1 to avoid reporting unreliable values.

---

#### Minimum data length requirement

Reliable frequency domain analysis requires a minimum recording length. The lower bound of the LF band is 0.04 Hz, which corresponds to a period of 25 seconds. At least 2 full cycles are needed for a reliable estimate, so a minimum of approximately 60 seconds of data per phase is recommended. WALTER displays a warning if a phase is too short for reliable frequency domain analysis.

---

#### Output metrics

```
LF power  — total power in the LF band (ms²)
HF power  — total power in the HF band (ms²)
LF/HF     — ratio of LF to HF power (unitless)
```

These are displayed in the summary table alongside the existing time-domain metrics, per phase and for the full session.

