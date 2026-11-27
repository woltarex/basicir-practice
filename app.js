import { mulberry32, makeScenario, buildQuestion, emphasisParts } from './generator.js';
import { renderInstrument, overlay } from './instruments/index.js';
import { load, save, record } from './store.js';

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
}

const data = load();
let session = null; // { rng, review, queue, i, n, log: [], q, startedAt, deadline, answered }

// ---------- setup ----------

function fillSetup() {
  const s = data.settings;
  form.querySelectorAll('[name=types]').forEach((el) => (el.checked = s.types.includes(el.value)));
  form.querySelectorAll('[name=instruments]').forEach((el) => (el.checked = s.instruments.includes(el.value)));
  form.querySelectorAll('[name=display]').forEach((el) => (el.checked = el.value === s.display));
  form.querySelectorAll('[name=length]').forEach((el) => (el.checked = Number(el.value) === s.length));
  form.querySelectorAll('[name=timerPreset]').forEach((el) => (el.checked = Number(el.value) === s.timer));
  form.querySelector('[name=timer]').value = s.timer;
  $('review').textContent = `Review mistakes (${data.mistakes.length})`;
  $('review').disabled = data.mistakes.length === 0;
  form.querySelector('[name=theme]').value = s.theme;
  applyTheme();
  syncSetup();
}

function readSetup() {
  const checked = (name) => [...form.querySelectorAll(`[name=${name}]:checked`)].map((el) => el.value);
  const timer = Math.max(0, Math.min(600, Number(form.querySelector('[name=timer]').value) || 0));
  data.settings = {
    ...data.settings,
    types: checked('types'),
    instruments: checked('instruments'),
    display: checked('display')[0] ?? 'numbers',
    length: Number(checked('length')[0] ?? 20),
    timer,
    theme: form.querySelector('[name=theme]').value,
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

function setupError() {
  const s = data.settings;
  if (s.types.length === 0) return 'Pick at least one exercise.';
  if (s.display !== 'numbers' && s.instruments.length === 0) return 'Pick at least one instrument, or switch to Numbers.';
  return '';
}

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
  const err = review ? '' : setupError();
  $('setupError').hidden = !err;
  $('setupError').textContent = err;
  if (err) return;
  const seed = Date.now() >>> 0;
  const queue = review ? [...data.mistakes] : null;
  session = { seed, rng: mulberry32(seed), review, queue, i: 0, n: review ? queue.length : data.settings.length, log: [], view: { overlay: true, northUp: false } };
  show('quiz');
  nextQuestion();
}

function nextQuestion() {
  if (session.n && session.i >= session.n) return endSession();
  const s = session.review
    ? session.queue[session.i]
    : makeScenario(session.rng, data.settings, `${session.seed}-${session.i}`);
  const q = buildQuestion(s, session.rng);
  session.q = q;
  session.answered = false;
  session.i++;

  $('progress').textContent = session.n ? `${session.i} / ${session.n}` : `#${session.i}`;
  $('prompt').textContent = q.prompt;
  $('instrument').innerHTML = renderInstrument(s);
  layout();
  $('feedback').hidden = true;
  $('options').replaceChildren(...q.options.map(optionButton));
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

function drawSolution() {
  const q = session.q, v = session.view;
  const numbers = q.scenario.display === 'numbers'; // the rose is the only drawing there: overlay/frame choices do not apply
  $('instrument').innerHTML = renderInstrument(q.scenario, v.overlay || numbers ? q.result : null, { northUp: v.northUp });
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

function answer(idx) {
  if (session.answered || session.paused) return;
  session.answered = true;
  $('pause').disabled = true;
  const q = session.q;
  const ms = Math.round(performance.now() - session.startedAt);
  const correct = idx === q.correctIndex;
  record(data, { statKey: q.statKey, correct, ms, scenario: q.scenario });
  save(data);
  session.log.push({ statKey: q.statKey, correct, ms, mistake: idx === null ? 'ran out of time' : q.options[idx].mistake });

  [...$('options').children].forEach((b, i) => {
    b.disabled = true;
    if (i === q.correctIndex) b.classList.add('correct');
    if (i === idx && !correct) b.classList.add('wrong');
  });
  const v = $('verdict');
  v.className = `verdict ${correct ? 'ok' : 'bad'}`;
  v.textContent = correct
    ? `✓ Correct (${(ms / 1000).toFixed(1)} s)`
    : idx === null
      ? '✗ Time is up'
      : `✗ ${q.options[idx].mistake} (${(ms / 1000).toFixed(1)} s)`;
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

function endSession() {
  const log = session.log;
  session = null;
  const right = log.filter((l) => l.correct).length;
  const avg = log.length ? log.reduce((a, l) => a + l.ms, 0) / log.length / 1000 : 0;
  $('score').textContent = `Score ${right} / ${log.length} · average ${avg.toFixed(1)} s`;

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

  fillTable($('alltime'), Object.entries(data.stats)
    .filter(([, v]) => v && Number(v.total) > 0)
    .map(([k, v]) => [LABEL[k] ?? k, `${Math.round((100 * v.correct) / v.total)}% of ${v.total} · ${(v.ms / v.total / 1000).toFixed(1)} s`]));
  show('end');
}

// ---------- wiring ----------

$('start').addEventListener('click', () => start(false));
$('review').addEventListener('click', () => start(true));
$('next').addEventListener('click', nextQuestion);
const disarmEnd = twoClick($('finish'), 'Confirm end?',
  () => (session.log.length ? endSession() : (session = null, fillSetup(), show('setup'))),
  () => session.log.length > 0);
$('pause').addEventListener('click', () => setPaused(!session.paused));
$('resume').addEventListener('click', () => setPaused(false));
$('again').addEventListener('click', () => { fillSetup(); show('setup'); });

document.addEventListener('keydown', (e) => {
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
  if (!session.answered && /^[1-5]$/.test(e.key)) {
    const idx = Number(e.key) - 1;
    if (idx < session.q.options.length) answer(idx);
  } else if (session.answered && (e.key === 'Enter' || e.key === ' ') && !e.target.closest('button, summary')) {
    e.preventDefault();
    nextQuestion();
  }
});

fillSetup();
