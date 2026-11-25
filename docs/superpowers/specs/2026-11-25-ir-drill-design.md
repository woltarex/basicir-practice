# IR Drill — Interception & Holding Practice Web App

Date: 2026-11-25
Status: Design approved, pending spec review

## Purpose

Practice the Basic IR ground school question types on interception and holding entry, quickly and under time pressure. The questions follow the format of the KantiSoft-style questions in `ref/`. The rules come from the course slides (see Rules) and the app must match them exactly. A wrong rule would drill wrong answers.

## Scope

In v1:
- Interception of radials/QDM/QDR, inbound and outbound: correction, 45°, 90°/45°, and tracking + over-station (QDR/outbound only).
- Holding entry for STD and Non-STD holds over an NDB or VOR: direct, special direct (case 2), teardrop, parallel, and "Either X or Y" in the ±5° boundary zones.
- Two display modes: numbers (text only) and instruments (RMI, HSI, DI+CDI). There is also a mixed mode.
- Multiple choice, with distractors built from typical mistakes, and a worked solution after each question.
- A countdown per question that the user can configure.
- Per-type stats and a review-mistakes mode.
- Works on phone and laptop (responsive).

Out of v1, because the course material for them isn't available:
- Special direct case 1, and the "direct with opposite turn" answer.
- "Not possible to join" and "reversal procedure first".
- Inbound interception with Δ > 70°.
- Offline/installable PWA (no service worker).

## Rules (`rules.js`)

All angles are integers in degrees, normalized to [0, 360). `norm(x)` = `((x % 360) + 360) % 360`.

### Interception

Inputs:
- the required radial `R` (always expressed as a radial FROM the station; a QDM is converted to a radial with QDM + 180)
- the direction (`inbound` | `outbound`)
- the actual position radial `P`

Steps:
- Required track: `T = norm(R + 180)` for inbound, `T = R` for outbound.
- `Δ` = the signed smallest difference from `R` to `P`, in (−180, 180]. The sign gives the side of the radial the aircraft is on. Each turn is made toward the required radial.

| `|Δ|` | Type | Initial track | Interception track |
|---|---|---|---|
| < 15 | Correction | = interception track | `T ± min(2|Δ|, 30)` toward the radial |
| 15–30 | 45° | = interception track | `T ± 45` toward the radial |
| > 30–70 | 90°/45° | `T ± 90` toward the radial | `T ± 45` toward the radial |
| > 70 (outbound/QDR only) | Tracking + over station | track to station (QDM = `norm(P + 180)`) | after passing: angle = `min(round(|TRK diff| / 3), 30)`, interception track = `R ∓ angle` (beyond R, on the far side) |

Over-station details: tracking track `K = norm(P + 180)` and `s` = the signed smallest difference from `R` to `K`. Then angle = `min(round(|s| / 3), 30)` and interception track = `norm(R − sign(s) · angle)`. Reference example from the slides: K = 270, R = 195 → s = +75 → angle 25 → interception track 170.

Threshold edges: the generator never produces `|Δ|` within 2° of 15, 30 or 70, so no question depends on which side an exact boundary falls.

HDG, distance and GS can appear in the question text. They are distractors and never affect the answer.

### Holding entry

Inputs:
- the inbound track `I`
- `std` (right turns) | `nonstd` (left turns)
- the aircraft heading `H` toward the fix

Calculation:
- `d = norm(H − I)` for STD, `d = norm(I − H)` for Non-STD.
- Outbound track: `O = norm(I + 180)`.

| `d` range | Entry | Initial track |
|---|---|---|
| [0, 70) ∪ (290, 360) | Direct | turn in the holding direction to `O` |
| [70, 110) | Special direct | hold `H` for 15 s, then turn in the holding direction to `O`; outbound 45 s |
| [110, 180) | Teardrop | `O − 30` (STD) / `O + 30` (Non-STD) |
| [180, 290] | Parallel | `O` |

Boundary zones: if `d` is within ±5° of 110, 180 or 290, the correct answer is "Either A or B", naming the two neighbouring entries. The boundaries at 70, which separates direct from special direct, are company-procedure internal and have no ±5° zone.

Checked against the slides: inbound 270 STD with heading 360 gives d = 90, which is special direct ✓. The sector arcs match the 110° parallel sector and the 70° teardrop sector on the slide.

### Worked steps

Every rule result returns `{answer, steps: string[]}`. The feedback screen shows these steps, so the explanation and the answer always come from the same computation.

## Generator (`generator.js`)

- Seeded PRNG (mulberry32), so any question can be reproduced from `(seed, index)`.
- Interception: `R` is uniform. The direction is inbound or outbound, phrased at random as "radial X inbound/outbound" or "QDM/QDR X". `|Δ|` is drawn evenly across the four bands; the over-station band is only drawn when the direction is outbound. Distance is 3–12 NM, plus HDG/GS distractors.
- Holding: `I` is uniform; STD/Non-STD and NDB/VOR are 50/50. `H` is drawn so that about 20% of questions fall in a ±5° boundary zone.
- Instrument modes: a `display` field (`numbers` | `rmi` | `hsi` | `dicdi`). For HSI and CDI the OBS is set so the needle is centred: OBS = `P` with the FROM flag, or `norm(P + 180)` with the TO flag, chosen 50/50.
- Distractors: 3–4 per question, each tagged with a mistake label:
  - reciprocal (radial ↔ QDM)
  - wrong side of the radial
  - wrong type, same side
  - correction not doubled / not capped at 30°
  - neighbouring holding sector
  - STD/Non-STD mirrored
  - teardrop on the wrong side
  - TO/FROM flag read backwards (instrument modes)
- Options are de-duplicated, the correct answer appears exactly once, and the order is shuffled.

## Instruments (`instruments/`)

Each renderer is a pure function: scenario → SVG string. The styling is functional and visually close to the exam instruments, but it does not copy the KantiSoft artwork.

- **RMI:** the card is rotated so `H` is at the top. The needle head points to the QDM and the tail to the QDR. The needle is labelled ADF for NDB questions, VOR otherwise.
- **HSI:** the card is rotated to `H`. It shows the course pointer at the OBS, the deviation bar (±10° full scale, 5 dots), the TO/FROM triangle and the aircraft symbol.
- **DI+CDI:** a separate heading indicator, and a VOR with an OBS card, needle and TO/FR flag.

In instrument modes, the first worked step is the reading itself, for example "RMI tail reads 035 → you are on R-035".

Build order: RMI, then HSI, then DI+CDI. Each one can be selected in Setup once it is done.

## Screens (`index.html`, `app.js`)

1. **Setup**
   - Exercise types: interception and/or holding.
   - Display: numbers, instruments or mixed, plus which instruments to use.
   - Countdown: off, 20, 45 or 90 s, or a custom value.
   - Session length: 10, 20 or endless.
   - Start button, plus a "Review mistakes (N)" button that is disabled when N = 0.
2. **Question**
   - Progress and countdown bar, question text, instrument (or a "you are on R-xxx" line in numbers mode), and 4–5 options.
   - Keys 1–5 pick an option and Enter goes to the next question.
3. **Feedback** (same screen)
   - Shows the picked option with its mistake label, the correct option, the worked steps and the time taken, then Next.
4. **Session end**
   - Score, average time, accuracy per type and the most common mistake.

Countdown: the deadline is a timestamp checked on every animation frame. When it expires, the question locks, is recorded as a timeout (wrong), and the feedback is shown.

Review mistakes: wrong and timed-out answers store their scenario. Review mode replays the stored scenarios with reshuffled options. A correct answer removes the scenario from the list.

Layout: one responsive column, with the instrument scaled to the viewport width. On a laptop the column is centred with a larger instrument.

## Storage (`store.js`)

- One localStorage key, `basicir.v1` = `{version: 1, settings, stats, mistakes}`.
- `stats` is all-time, recording correct, total and time for each question type.
- Every read and write is wrapped in try/catch. If storage is unavailable, the app runs without remembering anything. If the stored data is corrupt or has an unknown version, it resets to the defaults.

## Files

```
index.html
app.js
rules.js
generator.js
store.js
instruments/rmi.js
instruments/hsi.js
instruments/dicdi.js
test/rules.test.js
test/generator.test.js
test/instruments.test.js
```

Plain ES modules, with no build step and no dependencies. The app is served by any static server (ES modules don't load over `file://`). GitHub Pages is used for phone access.

## Testing (`node --test`)

- **rules:**
  - the slide examples: over-station 270 → 195 gives 170, and special direct at d = 90
  - every sector and band boundary
  - the ±5° "either" zones
  - STD/Non-STD mirroring
  - the screenshot questions in `ref/` whose numbers can be decoded
- **generator:** over 10,000 seeded scenarios, the correct answer appears exactly once, there are no duplicate options, no distractor equals the answer, and `|Δ|` is never within 2° of a threshold.
- **instruments:** parse the rotations out of the rendered SVG and check that the heading, QDM/QDR, OBS and flag match the scenario.
