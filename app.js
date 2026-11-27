import { mulberry32, makeScenario, buildQuestion, emphasisParts, setupError, summarize, instrumentState } from './generator.js';
import { renderInstrument, overlay } from './instruments/index.js';
import { sectorDiagram } from './instruments/overlay.js';
import { norm, fmt, gradeFreeInput, EITHER_PAIRS } from './rules.js';
import { load, save, record, recordSession, clearMistakes, resetStats, historyAverage } from './store.js';

const $ = (id) => document.getElementById(id);
const form = $('setup');
const LABEL = { correction: 'Correction', '45': '45° intercept', '90/45': '90°/45° intercept', overstation: 'Over station', holding: 'Holding' };

function applyTheme() {
  const t = data.settings.theme;
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

// Grey out controls that do nothing for the current choice.
function syncSetup() {
  $('instrumentsSet').disabled = data.settings.display === 'numbers';
  $('cdiSet').disabled = data.settings.display === 'numbers';
}

const data = load();
let session = null; // { rng, review, queue, i, n, log: [], q, startedAt, deadline, answered }

// ---------- setup ----------

function fillSetup() {
  const s = data.settings;
  form.querySelectorAll('[name=types]').forEach((el) => (el.checked = s.types.includes(el.value)));
  form.querySelectorAll('[name=instruments]').forEach((el) => (el.checked = s.instruments.includes(el.value)));
  form.querySelectorAll('[name=display]').forEach((el) => (el.checked = el.value === s.display));
  form.querySelectorAll('[name=cdiMode]').forEach((el) => (el.checked = el.value === s.cdiMode));
  form.querySelectorAll('[name=answerMode]').forEach((el) => (el.checked = el.value === s.answerMode));
  form.querySelectorAll('[name=length]').forEach((el) => (el.checked = Number(el.value) === s.length));
  form.querySelectorAll('[name=timerPreset]').forEach((el) => (el.checked = Number(el.value) === s.timer));
  form.querySelector('[name=timer]').value = s.timer;
  $('review').textContent = `Review mistakes (${data.mistakes.length})`;
  $('review').disabled = data.mistakes.length === 0;
  for (const k of ['bands', 'dirs', 'phrasings', 'turns', 'navs']) {
    form.querySelectorAll(`[name=${k}]`).forEach((el) => (el.checked = s.filters[k].includes(el.value)));
  }
  form.querySelector('[name=boundaryFocus]').checked = s.filters.boundaryFocus;
  form.querySelector('[name=adaptive]').checked = s.adaptive;
  form.querySelector('[name=theme]').value = s.theme;
  applyTheme();
  syncSetup();
  renderSummary();
}

function readSetup() {
  const checked = (name) => [...form.querySelectorAll(`[name=${name}]:checked`)].map((el) => el.value);
  const timer = Math.max(0, Math.min(600, Number(form.querySelector('[name=timer]').value) || 0));
  data.settings = {
    ...data.settings,
    types: checked('types'),
    instruments: checked('instruments'),
    display: checked('display')[0] ?? 'numbers',
    cdiMode: checked('cdiMode')[0] ?? 'centered',
    answerMode: checked('answerMode')[0] ?? 'mc',
    length: Number(checked('length')[0] ?? 20),
    timer,
    theme: form.querySelector('[name=theme]').value,
    adaptive: form.querySelector('[name=adaptive]').checked,
    filters: {
      bands: checked('bands'),
      dirs: checked('dirs'),
      phrasings: checked('phrasings'),
      turns: checked('turns'),
      navs: checked('navs'),
      boundaryFocus: form.querySelector('[name=boundaryFocus]').checked,
    },
  };
  save(data);
  applyTheme();
  syncSetup();
}

form.addEventListener('change', (e) => {
  if (e.target.name === 'timerPreset') form.querySelector('[name=timer]').value = e.target.value;
  if (e.target.name === 'timer') form.querySelectorAll('[name=timerPreset]').forEach((el) => (el.checked = el.value === e.target.value));
  readSetup();
});

function show(id) {
  for (const sec of ['setup', 'quiz', 'end']) $(sec).hidden = sec !== id;
  if (id !== 'quiz') document.querySelector('main').classList.remove('wide');
}

// Two columns on wide screens whenever there is a drawing to show.
function layout() {
  const hasDrawing = $('instrument').innerHTML !== '';
  $('qgrid').classList.toggle('two', hasDrawing);
  document.querySelector('main').classList.toggle('wide', hasDrawing);
}

// Two-click guard: the first click arms `btn` for 3 s, the second runs `action`.
// `needsConfirm()` returning false runs `action` on the first click.
function twoClick(btn, confirmText, action, needsConfirm = () => true) {
  const label = btn.textContent;
  let timer = null;
  const disarm = () => { clearTimeout(timer); timer = null; btn.textContent = label; };
  btn.addEventListener('click', (e) => {
    if (timer !== null && e.detail > 1) return; // a fast double-click must not arm and confirm in one gesture
    if (timer === null && needsConfirm()) {
      btn.textContent = confirmText;
      timer = setTimeout(disarm, 3000);
      return;
    }
    disarm();
    action();
  });
  return disarm;
}

function optionButton(o, idx) {
  const b = document.createElement('button');
  b.className = 'opt';
  const key = document.createElement('kbd');
  key.textContent = String(idx + 1);
  const label = document.createElement('span');
  for (const p of emphasisParts(o.text)) {
    if (!p.bold) { label.append(p.text); continue; }
    const strong = document.createElement('strong');
    strong.textContent = p.text;
    label.append(strong);
  }
  b.append(key, label);
  b.addEventListener('click', () => answer(idx));
  return b;
}

// ---------- session ----------

function start(review) {
  disarmEnd();
  readSetup();
  const err = review ? '' : setupError(data.settings);
  $('setupError').hidden = !err;
  $('setupError').textContent = err;
  if (err) return;
  const seed = Date.now() >>> 0;
  const queue = review ? [...data.mistakes] : null;
  session = { seed, mode: data.settings.answerMode, rng: mulberry32(seed), review, queue, i: 0, n: review ? queue.length : data.settings.length, log: [], view: { overlay: true, northUp: false } };
  show('quiz');
  nextQuestion();
}

function nextQuestion() {
  if (session.n && session.i >= session.n) return endSession();
  const s = session.review
    ? session.queue[session.i]
    : makeScenario(session.rng, data.settings, `${session.seed}-${session.i}`, data.stats);
  const q = buildQuestion(s, session.rng);
  session.q = q;
  // Reviewed interactive scenarios keep their stored OBS: give the control back if it is unreadable as stored.
  const st = s.obs != null ? instrumentState(s) : null;
  const interactive = st != null && (data.settings.cdiMode === 'interactive' || st.flag === 'OFF' || Math.abs(st.deflection) > 10);
  session.liveObs = interactive ? s.obs : null;
  $('obsBar').hidden = !interactive;
  if (interactive) $('obsValue').textContent = `OBS ${fmt(s.obs)}°`;
  session.answered = false;
  session.i++;

  $('progress').textContent = session.n ? `${session.i} / ${session.n}` : `#${session.i}`;
  $('prompt').textContent = q.prompt;
  $('instrument').innerHTML = renderInstrument(liveScenario());
  layout();
  $('feedback').hidden = true;
  $('options').replaceChildren(...q.options.map(optionButton));
  const typed = session.mode === 'input';
  $('options').hidden = typed;
  $('freeInput').hidden = !typed;
  if (typed) setupFree();
  $('legend').replaceChildren();
  $('viewToggles').replaceChildren();

  session.paused = false;
  $('qgrid').classList.remove('paused');
  $('resume').hidden = true;
  $('pause').textContent = 'Pause';
  session.startedAt = performance.now();
  session.deadline = data.settings.timer ? session.startedAt + data.settings.timer * 1000 : null;
  $('bar').hidden = session.deadline === null;
  $('clock').textContent = '';
  $('pause').disabled = session.deadline === null;
  $('timebar').style.background = '';
  tick();
}

// The scenario as currently shown: in interactive mode the user's OBS replaces the generated one.
function liveScenario() {
  const s = session.q.scenario;
  return session.liveObs == null ? s : { ...s, obs: session.liveObs };
}

// Re-renders only the instrument; the timer keeps running.
function turnObs(delta) {
  if (session?.liveObs == null || session.paused) return;
  session.liveObs = norm(session.liveObs + delta);
  $('obsValue').textContent = `OBS ${fmt(session.liveObs)}°`;
  if (session.answered) drawSolution();
  else { $('instrument').innerHTML = renderInstrument(liveScenario()); layout(); }
}

function drawSolution() {
  const q = session.q, v = session.view;
  const numbers = q.scenario.display === 'numbers'; // the rose is the only drawing there: overlay/frame choices do not apply
  $('instrument').innerHTML = renderInstrument(liveScenario(), v.overlay || numbers ? q.result : null, { northUp: v.northUp });
  $('legend').hidden = !v.overlay && !numbers;
  layout();
}

// Overlay On/Off and Instrument/North-up pills under the instrument (instrument questions only).
function renderToggles(focusIndex = -1) {
  const box = $('viewToggles');
  const v = session.view;
  if (session.q.scenario.display === 'numbers') return box.replaceChildren();
  const pill = (text, pressed, disabled, onClick) => {
    const b = document.createElement('button');
    b.className = 'mini secondary pill';
    b.textContent = text;
    b.disabled = disabled;
    b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', onClick);
    return b;
  };
  box.replaceChildren(
    pill(`Overlay: ${v.overlay ? 'On' : 'Off'}`, v.overlay, false, () => { v.overlay = !v.overlay; drawSolution(); renderToggles(0); }),
    pill(`Frame: ${v.northUp ? 'North-up' : 'Instrument'}`, v.northUp, !v.overlay, () => { v.northUp = !v.northUp; drawSolution(); renderToggles(1); }),
  );
  box.children[focusIndex]?.focus();
}

function tick() {
  if (!session || session.answered || session.paused || session.deadline === null) return;
  const left = session.deadline - performance.now();
  if (left <= 0) return answer(null);
  const total = data.settings.timer * 1000;
  $('clock').textContent = `⏱ ${Math.ceil(left / 1000)} s`;
  const bar = $('timebar');
  bar.style.width = `${(left / total) * 100}%`;
  bar.style.background = left <= 5000 ? 'var(--bad)' : left <= total / 4 ? 'var(--warn)' : '';
  cancelAnimationFrame(session.raf);
  session.raf = requestAnimationFrame(tick);
}

// Pausing hides the question so the clock cannot be dodged; answer time excludes the pause.
function setPaused(on) {
  if (!session || session.answered || session.deadline === null || session.paused === on) return;
  cancelAnimationFrame(session.raf);
  const now = performance.now();
  if (on) {
    session.remainingMs = session.deadline - now;
    session.pausedAt = now;
  } else {
    session.deadline = now + session.remainingMs;
    session.startedAt += now - session.pausedAt;
  }
  session.paused = on;
  $('qgrid').classList.toggle('paused', on);
  $('resume').hidden = !on;
  $('pause').textContent = on ? 'Resume' : 'Pause';
  if (!on) tick();
}

const CHOICES = {
  intercept: [['correction', 'Correction'], ['45', '45°'], ['90/45', '90°/45°'], ['overstation', 'Over-station']],
  hold: [['direct', 'Direct'], ['special', 'Special direct'], ['teardrop', 'Teardrop'], ['parallel', 'Parallel'], ['either', 'Either …']],
};
const PAIR_NAME = { direct: 'Direct', special: 'Special direct', teardrop: 'Teardrop', parallel: 'Parallel' };

function segButtons(box, items, selected, onPick, keyed) {
  box.replaceChildren(...items.map(([value, text], i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mini secondary';
    b.setAttribute('aria-pressed', String(value === selected));
    if (keyed) { const k = document.createElement('kbd'); k.textContent = String(i + 1); b.append(k, ' '); }
    b.append(text);
    b.addEventListener('click', () => onPick(value));
    return b;
  }));
}

// Show only the fields the chosen answer type needs, with the right labels.
function syncFree() {
  const { choice, pair } = session.free;
  const kind = session.q.result.kind;
  const intercept = kind === 'intercept';
  const two = choice === '90/45' || choice === 'overstation';
  segButtons($('fiChoices'), CHOICES[kind], choice, pickChoice, true);
  $('fiPair').hidden = choice !== 'either';
  if (choice === 'either') {
    segButtons($('fiPair'), EITHER_PAIRS.map((p) => [p.join('|'), p.map((e) => PAIR_NAME[e]).join(' / ')]), pair?.join('|'),
      (v) => { session.free.pair = v.split('|'); syncFree(); $('fiSubmit').focus(); }, false);
  }
  $('fiInitialRow').hidden = intercept ? !two : choice === null || choice === 'either';
  $('fiInterceptRow').hidden = !intercept || choice === null;
  $('fiInitialLabel').textContent = intercept
    ? (choice === 'overstation' ? 'Track to station' : 'Initial track')
    : (choice === 'special' ? 'Outbound track after 15 s' : 'Initial track');
  $('fiInterceptLabel').textContent = two ? 'Interception track' : 'Track (initial = interception)';
}

function pickChoice(value) {
  if (session.answered || session.paused) return;
  session.free.choice = value;
  if (value !== 'either') session.free.pair = null;
  $('fiHint').hidden = true;
  syncFree();
  const field = [$('fiInitial'), $('fiIntercept')].find((el) => !el.closest('label').hidden);
  (field ?? $('fiPair').querySelector('button'))?.focus();
}

function setupFree() {
  session.free = { choice: null, pair: null };
  $('fiInitial').value = '';
  $('fiIntercept').value = '';
  $('fiHint').hidden = true;
  for (const el of $('freeInput').elements) el.disabled = false;
  syncFree();
  $('fiChoices').querySelector('button').focus();
}

function submitFree() {
  if (session.answered || session.paused) return;
  const { choice, pair } = session.free;
  if (!choice) { $('fiHint').hidden = false; return; }
  const num = (id) => ($(id).value.trim() === '' ? NaN : Number($(id).value));
  const q = session.q;
  const input = q.result.kind === 'intercept'
    ? { type: choice, initial: num('fiInitial'), intercept: num('fiIntercept') }
    : { entry: choice, eitherPair: pair, initial: num('fiInitial') };
  const { correct, mistake } = gradeFreeInput(q.result, input);
  resolve(correct, mistake, null);
}

function answer(idx) {
  const q = session.q;
  resolve(idx === q.correctIndex, idx === null ? 'ran out of time' : q.options[idx].mistake, idx);
}

// Shared by multiple choice (idx = option, or null on timeout) and typed answers (idx = null).
function resolve(correct, mistake, idx) {
  if (session.answered || session.paused) return;
  session.answered = true;
  $('pause').disabled = true;
  const q = session.q;
  const ms = Math.round(performance.now() - session.startedAt);
  record(data, { statKey: q.statKey, correct, ms, scenario: q.scenario });
  save(data);
  session.log.push({ statKey: q.statKey, correct, ms, mistake });

  [...$('options').children].forEach((b, i) => {
    b.disabled = true;
    if (i === q.correctIndex) b.classList.add('correct');
    if (i === idx && !correct) b.classList.add('wrong');
  });
  for (const el of $('freeInput').elements) el.disabled = true;
  const v = $('verdict');
  v.className = `verdict ${correct ? 'ok' : 'bad'}`;
  const answerText = session.mode === 'input' && !correct ? ` — answer: ${q.options[q.correctIndex].text}` : '';
  v.textContent = correct
    ? `✓ Correct (${(ms / 1000).toFixed(1)} s)`
    : mistake === 'ran out of time'
      ? `✗ Time is up${answerText}`
      : `✗ ${mistake} (${(ms / 1000).toFixed(1)} s)${answerText}`;
  // Redraw the instrument (or a compass rose in numbers mode) with the solution on it.
  drawSolution();
  renderToggles();
  $('legend').replaceChildren(...overlay(q.scenario, q.result, 0).legend.map(({ color, text }) => {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = color;
    li.append(sw, text);
    return li;
  }));
  $('steps').innerHTML = '';
  for (const step of q.steps) {
    const li = document.createElement('li');
    li.textContent = step;
    $('steps').append(li);
  }
  $('feedback').hidden = false;
  $('next').focus();
}

function fillTable(table, rows) {
  table.replaceChildren(...rows.map((cells) => {
    const tr = document.createElement('tr');
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.append(td);
    }
    return tr;
  }));
}

// Stored stats limited to keys we know, so a tampered key like "constructor" never renders.
const knownStats = () => Object.fromEntries(Object.entries(data.stats).filter(([k]) => Object.hasOwn(LABEL, k)));

function alltimeRows() {
  return Object.entries(knownStats())
    .filter(([, v]) => v && Number(v.total) > 0)
    .map(([k, v]) => [LABEL[k] ?? k, `${Math.round((100 * v.correct) / v.total)}% of ${v.total} · ${(v.ms / v.total / 1000).toFixed(1)} s`]);
}

function renderSummary() {
  const sum = summarize(knownStats());
  $('summary').hidden = sum.total === 0;
  if (!sum.total) return;
  $('summaryLine').textContent = `Overall ${Math.round((100 * sum.correct) / sum.total)}% (${sum.correct} / ${sum.total}) · ` +
    `average ${(sum.ms / sum.total / 1000).toFixed(1)} s · weakest: ${LABEL[sum.weakest] ?? sum.weakest}`;
  fillTable($('setupAlltime'), alltimeRows());
  fillTable($('historyTable'), data.history.slice(-10).reverse().map((h) => [
    new Date(h.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) + (h.review ? ' (review)' : ''),
    `${h.right} / ${h.total}`,
    `${(h.avgMs / 1000).toFixed(1)} s`,
  ]));
}

function endSession() {
  const { log, review } = session;
  session = null;
  const right = log.filter((l) => l.correct).length;
  const avgMs = log.length ? log.reduce((a, l) => a + l.ms, 0) / log.length : 0;
  const prev = historyAverage(data.history);
  recordSession(data, { at: Date.now(), right, total: log.length, avgMs: Math.round(avgMs), review });
  save(data);
  $('score').textContent = `Score ${right} / ${log.length} · average ${(avgMs / 1000).toFixed(1)} s`;
  $('delta').hidden = !prev;
  if (prev) {
    const dAcc = Math.round(100 * (right / log.length - prev.acc));
    const dSec = (avgMs - prev.avgMs) / 1000;
    const secText = Math.abs(dSec).toFixed(1);
    const sign = (zero, d) => (zero ? '±' : d >= 0 ? '+' : '−');
    $('delta').textContent = `vs your average: accuracy ${sign(dAcc === 0, dAcc)}${Math.abs(dAcc)} points · time ${sign(secText === '0.0', dSec)}${secText} s`;
  }

  const per = {};
  for (const l of log) {
    per[l.statKey] ??= { correct: 0, total: 0 };
    per[l.statKey].total++;
    if (l.correct) per[l.statKey].correct++;
  }
  fillTable($('breakdown'), Object.entries(per).map(([k, v]) => [LABEL[k] ?? k, `${v.correct} / ${v.total}`]));

  const counts = {};
  for (const l of log) if (!l.correct) counts[l.mistake] = (counts[l.mistake] ?? 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  $('topMistake').textContent = top ? `Most common mistake: ${top[0]} (×${top[1]})` : 'No mistakes 🎉';

  fillTable($('alltime'), alltimeRows());
  show('end');
}

// ---------- wiring ----------

$('start').addEventListener('click', () => start(false));
$('review').addEventListener('click', () => start(true));
$('next').addEventListener('click', nextQuestion);
const disarmEnd = twoClick($('finish'), 'Confirm end?',
  () => (session.log.length ? endSession() : (session = null, fillSetup(), show('setup'))),
  () => session.log.length > 0);
twoClick($('clearMistakes'), 'Click again to confirm', () => { clearMistakes(data); save(data); fillSetup(); });
twoClick($('resetStats'), 'Click again to confirm', () => { resetStats(data); save(data); fillSetup(); });
$('obsBar').addEventListener('click', (e) => {
  const d = e.target.closest('button')?.dataset.d;
  if (d) turnObs(Number(d));
});
$('freeInput').addEventListener('submit', (e) => { e.preventDefault(); submitFree(); });
$('pause').addEventListener('click', () => setPaused(!session.paused));
$('resume').addEventListener('click', () => setPaused(false));
$('again').addEventListener('click', () => { fillSetup(); show('setup'); });
$('refSectors').innerHTML = sectorDiagram('std') + sectorDiagram('nonstd'); // trusted SVG from our renderer
$('rulesSetup').addEventListener('click', () => $('refDialog').showModal());
// Opening the sheet mid-question pauses the timer (no-op when answered or untimed); resume with P.
$('rulesQuiz').addEventListener('click', () => { setPaused(true); $('refDialog').showModal(); });
let downOnBackdrop = false; // a drag that starts inside the sheet and ends on the backdrop must not close it
$('refDialog').addEventListener('mousedown', (e) => { downOnBackdrop = e.target === $('refDialog'); });
$('refDialog').addEventListener('click', (e) => { if (e.target === $('refDialog') && downOnBackdrop) $('refDialog').close(); });
// Focus returns to the Rules button on close; on an answered question hand it to Next so Enter advances.
$('refDialog').addEventListener('close', () => { if (session?.answered && !$('quiz').hidden) $('next').focus(); });

document.addEventListener('keydown', (e) => {
  if ($('refDialog').open) return;
  if (!$('setup').hidden) {
    if (e.key === 'Enter' && !e.target.closest('button, summary, select')) {
      e.preventDefault();
      start(false);
    }
    return;
  }
  if (!session || $('quiz').hidden) return;
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === ' ' && !e.target.closest('button, summary')) e.preventDefault(); // no page scroll
  if ((e.key === 'p' || e.key === 'P') && !(e.ctrlKey || e.metaKey || e.altKey)) { setPaused(!session.paused); return; }
  if (session.paused) return;
  if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
    e.preventDefault();
    turnObs((e.code === 'BracketRight' ? 1 : -1) * (e.shiftKey ? 10 : 1));
    return;
  }
  if (!session.answered && /^[1-5]$/.test(e.key)) {
    const idx = Number(e.key) - 1;
    if (session.mode === 'input') {
      const item = CHOICES[session.q.result.kind][idx];
      if (item) {
        e.preventDefault(); // the focus jump must not also type this digit into the field
        pickChoice(item[0]);
      }
    } else if (idx < session.q.options.length) answer(idx);
  } else if (session.answered && (e.key === 'Enter' || e.key === ' ') && !e.target.closest('button, summary')) {
    e.preventDefault();
    nextQuestion();
  }
});

fillSetup();
