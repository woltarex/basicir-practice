# IR Drill v2 — Feature & Interface Upgrade Spec

Date: 2026-11-27
Status: Draft — ready for review / phased implementation
Base spec: [2026-11-25-ir-drill-design.md](2026-11-25-ir-drill-design.md)

## Overview & Principles

This spec defines five independent, shippable upgrade phases for **IR Drill** covering UI/UX polish, instrument overlay improvements, granular & adaptive training, realistic instrument/free-input modes, and offline PWA support.

Constraints preserved from v1:
- **Zero dependencies, no build step:** plain ES2022 modules, inline SVG, static hosting (GitHub Pages).
- **Pure core + thin DOM layer:** all rules, grading, weighting, CDI deflection math, and SVG rendering remain pure functions tested with `node --test`.
- **Backward-compatible storage:** existing `basicir.v1` `localStorage` data (stats and mistakes) migrates cleanly without data loss.
- **Independent phases:** each phase leaves the app fully working and all tests green.

---

## Storage Migration (`store.js`)

Move to `version: 2` under key `basicir.v2` while reading `basicir.v1` as a one-time fallback migration if `basicir.v2` is absent.

```js
export const defaults = () => ({
  version: 2,
  settings: {
    types: ['intercept', 'hold'],
    display: 'numbers',              // 'numbers' | 'instruments' | 'mixed'
    instruments: ['rmi'],            // subset of ['rmi', 'hsi', 'dicdi']
    timer: 45,                       // 0..600
    length: 20,                      // 0 | 10 | 20
    theme: 'system',                 // 'system' | 'light' | 'dark'
    answerMode: 'mc',                // 'mc' | 'input'
    cdiMode: 'centered',             // 'centered' | 'deflected' | 'interactive'
    adaptive: false,                 // weight scenarios toward weak stats
    filters: {
      bands: ['correction', '45', '90/45', 'overstation'],
      dirs: ['inbound', 'outbound'],
      phrasings: ['radial', 'q'],
      turns: ['std', 'nonstd'],
      navs: ['VOR', 'NDB'],
      boundaryFocus: false,          // true → 80% ±5° boundary holds
    },
  },
  stats: {},                         // statKey → { correct, total, ms }
  mistakes: [],                      // scenario[]
  history: [],                       // last 30 sessions: { at, right, total, avgMs, review }
});
```

Rules:
- `load(storage)` checks `basicir.v2`, falls back to `basicir.v1` (preserving `settings`, `stats`, `mistakes` and merging new default fields), and otherwise returns `defaults()`.
- Every field is validated individually; malformed values fall back to their default without wiping valid stats/mistakes.
- Add pure helpers: `recordSession(data, entry)` (appends to `history`, caps at 30), `clearMistakes(data)`, and `resetStats(data)` (clears `stats` and `history`, keeps `settings`).

---

## Phase 1 — UI/UX & Theme Polish

**Files:** `index.html`, `app.js`, `store.js`

### 1.1 Theme & Native Form Controls
- Add `color-scheme: light dark;` on `:root` and support explicit `[data-theme="light"]` / `[data-theme="dark"]` overrides on `<html>`.
- Add a compact theme selector (`System` / `Light` / `Dark`) in the Setup header, persisted in `settings.theme`.
- Style `input[type=number]`, `select`, and `details` explicitly using `--card`, `--fg`, and `--line` so dark mode has no unstyled white inputs.
- Add `:hover` and `:focus-visible` outlines (`2px solid var(--accent)`) on `.opt`, primary/secondary buttons, and interactive controls.

### 1.2 Setup Screen Ergonomics
- When `display === 'numbers'`, set `disabled` (and `.muted`/reduced opacity) on the **Instruments** fieldset (and CDI mode selector once Phase 4 lands) so users immediately see it is inactive.
- Pressing `Enter` on the Setup screen (when focus is not inside a button or `<details>` summary) starts the session.

### 1.3 Quiz Layout & Controls
- **Two-column desktop layout** (`@media (min-width: 900px)`):
  - Expand `main` to `max-width: 980px` while `#quiz` is visible.
  - Use CSS Grid (`grid-template-columns: minmax(320px, 420px) 1fr; gap: 24px;`) when an instrument or solution diagram is displayed:
    - Left column: `#instrument`, post-answer overlay toggles, and `#legend`.
    - Right column: `#prompt`, `#options` (or free-input form), `#verdict`, `#steps`, and `#next`.
  - Keep the top progress/timer bar full-width across both columns.
  - Fall back to the existing single-column `640px` layout on narrow screens and in unanswered Numbers mode.
- **Timer bar & Pause:**
  - Hide `.bar` (`hidden = true`) whenever `data.settings.timer === 0`.
  - Color thresholds on `#timebar`: default `--accent`; `<= 25%` remaining → `--warn` (`#d97706`); `<= 5000 ms` remaining → `--bad`.
  - Add a **Pause** button (`P` key) in the top bar (only active when unanswered and timer > 0).
  - Pausing stores `remainingMs`, stops `requestAnimationFrame`, and masks `#instrument`, `#prompt`, and `#options` with a "Paused — Resume (`P`)" overlay so pausing cannot be used to read the question off-clock. Resuming sets `deadline = performance.now() + remainingMs` and adjusts `startedAt` so recorded answer time excludes paused duration.
- **Scannable Options & Keyboard:**
  - Render each option button with a `<kbd>` badge (`1`–`5`) and `font-variant-numeric: tabular-nums`.
  - Bold the leading type/entry phrase and 3-digit track values (`\b\d{3}°`) inside option labels (rendered safely via DOM nodes, never raw unsanitized HTML).
  - Allow both `Enter` and `Space` to trigger **Next** after answering (unless focus is on a button that handles its own click).
- **Safe Finish Button:**
  - Move **Finish session** into the top bar as a compact secondary button (`End`).
  - If `session.log.length > 0` and not yet confirmed, first click changes label to `Confirm end?` for 3 seconds; second click ends the session. (If `0` questions answered, returns to Setup immediately.)

---

## Phase 2 — Instrument Overlay Polish & Quick Reference

**Files:** `instruments/overlay.js`, `instruments/index.js`, `index.html`, `app.js`, `test/overlay.test.js`

### 2.1 Post-Answer View Controls
After answering, show two compact toggle pills under the instrument:
1. **Overlay: On / Off** — re-renders `renderInstrument(s, showOverlay ? result : null)` so the user can inspect the unobstructed instrument needles.
2. **Frame: Instrument / North-up** (only when `s.display !== 'numbers'`) — switches between drawing the overlay on the question's rotated instrument card and drawing a clean North-up `SOLUTION` compass rose (`card('card', 0) + overlay(s, result, 0).svg`).

Extend `renderInstrument(s, result = null, opts = {})` with `{ northUp = false }` so this stays pure and testable.

### 2.2 Holding Overlay Sector Labels & Shading
In `instruments/overlay.js` (`holdParts`):
- Draw 4 subtle semi-transparent sector wedges (`fill-opacity="0.08"`) between the `70°`, `110°`, `180°`, and `290°` boundaries (distinguishing Direct, Special, Teardrop, Parallel).
- Place short upright labels (`DIR`, `SPEC`, `TD`, `PAR`) at the angular midpoint of each sector at radius `66`, counter-rotated by `norm(up)` so text is always upright regardless of card rotation.
- Pass `up` into `holdParts(s, r, up)` so counter-rotation is exact.

### 2.3 Quick-Reference Cheat Sheet (`<dialog>`)
- Add a native `<dialog id="refDialog">` accessible via a `? Rules` button in the Setup header and in the Quiz top bar (disabled while a timed question is unanswered to prevent mid-timer lookup, or auto-pauses if clicked).
- Contents (static HTML + inline SVG):
  1. **Interception table:** `|Δ| < 15°` Correction (`min(2|Δ|, 30)`), `15°–30°` 45°, `30°–70°` 90°/45°, `> 70°` (outbound) Over-station (`min(round(|s|/3), 30)`).
  2. **Holding entry diagram:** compact STD (right) and Non-STD (left) sector circles showing `0–70` Direct, `70–110` Special Direct (`15 s` + `45 s`), `110–180` Teardrop (`O ∓ 30°`), `180–290` Parallel (`O`), and the `±5°` "Either" rule at `110° / 180° / 290°`.
- Closes on `Esc`, backdrop click, or Close button.

---

## Phase 3 — Granular Filters, Adaptive Weak-Spot Drill & Stats Dashboard

**Files:** `generator.js`, `store.js`, `index.html`, `app.js`, `test/generator.test.js`, `test/store.test.js`

### 3.1 Granular Filters
In `index.html`, add a collapsible `<details id="advancedFilters">` inside Setup containing:
- **Interception filters:**
  - Bands: `Correction`, `45°`, `90°/45°`, `Over-station`
  - Direction: `Inbound`, `Outbound`
  - Phrasing: `Radial`, `QDM / QDR`
- **Holding filters:**
  - Turns: `STD (right)`, `Non-STD (left)`
  - Navaid: `VOR`, `NDB`
  - Checkbox: `Focus on ±5° boundary zones (80%)`

In `generator.js`:
- `makeScenario(rng, settings, id)` respects `settings.filters` (with safe fallback to full defaults if `filters` is omitted).
- Validation in `setupError()`:
  - If `intercept` is selected: require ≥ 1 band, ≥ 1 dir, ≥ 1 phrasing; also reject the impossible combination `dirs: ['inbound']` + `bands: ['overstation']` with a clear message (`Inbound interception has no over-station band.`).
  - If `hold` is selected: require ≥ 1 turn and ≥ 1 nav; if `display === 'instruments'` and only `hsi`/`dicdi` are selected and `navs: ['NDB']`, show an error (`NDB holdings require RMI or Numbers display.`).

### 3.2 Adaptive / Weak-Spot Mode
Add a pure helper in `generator.js`:

```js
export function statWeight(st) {
  if (!st || st.total === 0) return 3; // prioritize unseen types
  const acc = st.correct / st.total;   // 0..1
  const avgSec = st.ms / st.total / 1000;
  const errorTerm = (1 - acc) * 4;     // 0..4
  const speedTerm = Math.min(avgSec / 30, 1.5); // 0..1.5
  return 0.5 + errorTerm + speedTerm;  // floor 0.5 so mastered types still appear
}

export function pickWeighted(rng, keys, stats) { ... }
```

- When `settings.adaptive` is `true`, `makeScenario(rng, settings, id, stats)` uses `pickWeighted` across all eligible `statKey`s (`correction`, `45`, `90/45`, `overstation`, `holding`) allowed by the active types & filters, then generates a scenario matching the chosen `statKey`.
- Setup checkbox: `Prioritize weak spots (uses your stats)`.

### 3.3 Stats Dashboard, Session History & Reset Controls
- **Setup summary card** (shown when total answered > 0):
  - Displays overall accuracy (`correct / total`, `%`), average response time, weakest category (`LABEL[key]`), and a `<details>` ("Stats & history") containing:
    - All-time per-type table (same columns as Session End).
    - Recent sessions list (last 10 from `data.history`: date, score, avg time).
    - Two guarded reset buttons (`Clear mistakes`, `Reset stats & history`) using two-click confirmation (`Click again to confirm`).
- **Session End screen:**
  - Calls `recordSession(data, { at: Date.now(), right, total: log.length, avgMs, review })` before saving.
  - Shows a delta vs. all-time average time/accuracy when prior history exists.

---

## Phase 4 — Deflected CDI / Interactive OBS & Free-Input Mode

**Files:** `rules.js`, `generator.js`, `instruments/hsi.js`, `instruments/dicdi.js`, `instruments/index.js`, `index.html`, `app.js`, `test/instruments.test.js`, `test/rules.test.js`

### 4.1 Deflected CDI & Interactive OBS
Add pure CDI math in `rules.js`:

```js
// Given selected OBS and aircraft radial P, returns { flag: 'TO'|'FROM', deflection: number }
// deflection is signed degrees off course: positive = needle right (fly right), negative = needle left.
// Full scale is ±10° (5 dots × 2°/dot).
export function cdiReading(obs, P) {
  const fromDiff = sdiff(obs, P);          // in (-180, 180]
  if (Math.abs(fromDiff) <= 90) {
    return { flag: 'FROM', deflection: -fromDiff }; // P clockwise of OBS → radial is right → fly left (-fromDiff)
  }
  const toDiff = sdiff(obs, norm(P + 180)); // QDM vs OBS
  return { flag: 'TO', deflection: toDiff };        // QDM clockwise of OBS → station is right → fly right (+toDiff)
}
```
*(Note: verify sign convention carefully against real VOR/HSI behavior in unit tests: e.g., on R-095 with OBS 090 FROM → you are 5° right/south of R-090, so to get back to R-090 outbound you fly left → needle deflects left (`-5°`). On R-095 with OBS 270 TO → QDM is 275, station is 5° right of 270 → needle deflects right (`+5°`).)*

- **Scenario generation (`generator.js`):**
  - `settings.cdiMode`:
    - `'centered'`: existing v1 behavior (`deflection = 0`).
    - `'deflected'`: for `hsi` and `dicdi`, choose `obs` offset from `P` (FROM) or `QDM` (TO) by `±[2, 4, 6, 8]` degrees (whole dots, 1–4 dots, never pegged off-scale so `P` is uniquely readable). Store `s.obs` on the scenario.
    - `'interactive'`: choose a random initial `s.obs` (`int(rng, 0, 359)`). The user rotates OBS in the UI to center the needle.
- **Instrument rendering (`hsi.js`, `dicdi.js`):**
  - Accept `deflection = 0` in `st`.
  - Compute `dx = Math.max(-10, Math.min(10, deflection)) * 4` (since 5 dots span `±40` SVG units, 1 dot = `2°` = `8` SVG units → `4` units/degree).
  - Translate `#cdi` by `dx` along the course-perpendicular axis (inside the rotated `#course` group on HSI, horizontally on DI+CDI).
  - When `Math.abs(fromDiff) === 90` (within ±1° of abeam), show a `OFF` / red-striped flag state (relevant for interactive OBS rotation).
- **Interactive OBS controls (`app.js`):**
  - When `cdiMode === 'interactive'` and `display` is `hsi` or `dicdi`, render an OBS control bar directly under the instrument: `−10°`, `−1°`, `OBS 045°`, `+1°`, `+10°`, plus keyboard `[` / `]` (`Shift` for 10°).
  - Updating `liveObs` re-renders only the instrument SVG using `cdiReading(liveObs, P)` without resetting the timer.
- **Worked steps (`readingSteps` in `generator.js`):**
  - When `deflection !== 0`, explain the dot math explicitly, e.g.:
    `HSI: OBS 090° with FROM flag, needle 2.5 dots left (−5°) → you are on R-095, heading 140°`.

### 4.2 Free-Input Answer Mode
Add `settings.answerMode: 'mc' | 'input'` (Setup radio: `Multiple choice` / `Type answer`).

- **Pure grader in `rules.js`:**
  - `gradeFreeInput(result, input)`:
    - For **interception**, `input = { type, initial, intercept }`:
      - `type` ∈ `['correction', '45', '90/45', 'overstation']`.
      - For `correction` and `45`, `initial` is ignored/equal to `intercept`.
      - Exact integer match on `norm(val)` against `result.initial` and `result.intercept`.
      - Returns `{ correct, mistake }` where `mistake` diagnoses the primary error (`wrong interception type`, `reciprocal (radial ↔ QDM mix-up)`, `wrong side of the radial`, `track off by N°`).
    - For **holding**, `input = { entry, eitherPair, initial }`:
      - `entry` ∈ `['direct', 'special', 'teardrop', 'parallel', 'either']`.
      - If `result.either`: requires `entry === 'either'` and matching unordered `eitherPair`; if user picked one of the two valid single entries, label mistake `'inside ±5° of a sector boundary the answer is "Either …" — not a single entry'`.
      - Otherwise requires matching `entry` and `norm(input.initial) === result.initial` (for `special`, checks `outbound` or `trk` clearly labelled in the form).
- **UI (`index.html`, `app.js`):**
  - Replace `#options` with `#freeInput` when `answerMode === 'input'`.
  - Clean segmented type buttons + numeric track input(s) (`inputmode="numeric"`, `pattern="[0-9]*"`, auto-focus on first field, `Enter` submits).
  - After submitting, displays the exact same `#verdict`, solution overlay, `#legend`, `#steps`, and records into `store.js` identically to multiple choice.

---

## Phase 5 — Offline PWA & Future Syllabus Extensions

**Files:** `manifest.json`, `sw.js`, `index.html`, `app.js`

### 5.1 Offline PWA
- Create `manifest.json` (`name: "IR Drill"`, `short_name: "IR Drill"`, `display: "standalone"`, `background_color: "#11151c"`, `theme_color: "#e8892b"`, inline/static SVG icon).
- Link `<link rel="manifest" href="manifest.json">` and `<meta name="theme-color" content="#11151c">` in `index.html`.
- Create `sw.js`:
  - Precaches all static app files (`./`, `index.html`, `app.js`, `rules.js`, `generator.js`, `store.js`, `instruments/*.js`, `manifest.json`) under `CACHE = 'basicir-v2-1'`.
  - Network-first for HTML/JS (so GitHub Pages updates appear immediately when online) with cache fallback when offline.
  - Cleans up old cache versions on `activate`.
- Register `navigator.serviceWorker.register('./sw.js')` inside `try/catch` in `app.js` (silently skipped if unsupported or served locally without SW).

### 5.2 Future Syllabus Extensions (Deferred Pending Course Material)
Keep these explicitly out of scope until verified against course slides, with clean hooks in `rules.js`:
- Inbound interception with `|Δ| > 70°`.
- Special direct case 1 and opposite-turn direct holding entries.
- Optional **With wind** toggle (`wind: { dir, spd }`) adding WCA (`sin(angle) × wind / TAS` or max-drift rule) and holding outbound leg timing (`60 s ± drift/headwind`).

---

## Verification & Testing Plan

Every phase adds focused `node --test` coverage before completion:

| Phase | New / Updated Tests |
|---|---|
| **Storage v2** | `test/store.test.js`: v1 → v2 migration preserves `stats` & `mistakes`; invalid v2 fields fall back cleanly; `recordSession` caps at 30; `clearMistakes` & `resetStats`. |
| **Phase 1** | Manual / browser check on mobile (`375px`) and desktop (`1280px`) viewports in both light and dark themes; timer pause/resume excludes paused time. |
| **Phase 2** | `test/overlay.test.js`: `northUp` option renders North-up rose even for instrument scenarios; holding overlay includes 4 sector labels counter-rotated by `up`. |
| **Phase 3** | `test/generator.test.js`: every filter combination produces only matching scenarios over 2,000 seeds; `boundaryFocus` yields ~80% either-zone holds; `pickWeighted` favors low-accuracy/unseen keys while keeping floor > 0. |
| **Phase 4** | `test/rules.test.js`: `cdiReading` sign & TO/FROM correctness across all 4 quadrants and abeam edge; `gradeFreeInput` exact matches and mistake diagnostics.<br>`test/instruments.test.js`: deflected HSI & DI+CDI translate `#cdi` accurately within `±40` units; `readingSteps` includes dot count when deflected. |
| **Phase 5** | Verify `manifest.json` parses, SW installs cleanly, and app loads offline in DevTools. |
