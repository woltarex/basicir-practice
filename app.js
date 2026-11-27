import { mulberry32, makeScenario, buildQuestion } from './generator.js';
import { renderInstrument, overlay } from './instruments/index.js';
import { load, save, record } from './store.js';

const $ = (id) => document.getElementById(id);
const form = $('setup');
const LABEL = { correction: 'Correction', '45': '45° intercept', '90/45': '90°/45° intercept', overstation: 'Over station', holding: 'Holding' };

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
  };
  save(data);
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
}

// ---------- session ----------

function start(review) {
  readSetup();
  const err = review ? '' : setupError();
  $('setupError').hidden = !err;
  $('setupError').textContent = err;
  if (err) return;
  const seed = Date.now() >>> 0;
  const queue = review ? [...data.mistakes] : null;
  session = { seed, rng: mulberry32(seed), review, queue, i: 0, n: review ? queue.length : data.settings.length, log: [] };
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
  $('feedback').hidden = true;
  const opts = $('options');
  opts.innerHTML = '';
  q.options.forEach((o, idx) => {
    const b = document.createElement('button');
    b.className = 'opt';
    b.textContent = `${idx + 1} · ${o.text}`;
    b.addEventListener('click', () => answer(idx));
    opts.append(b);
  });

  session.startedAt = performance.now();
  session.deadline = data.settings.timer ? session.startedAt + data.settings.timer * 1000 : null;
  tick();
}

function tick() {
  if (!session || session.answered) return;
  if (session.deadline === null) {
    $('clock').textContent = '';
    $('timebar').style.width = '0%';
    return;
  }
  const left = session.deadline - performance.now();
  if (left <= 0) return answer(null);
  $('clock').textContent = `⏱ ${Math.ceil(left / 1000)} s`;
  $('timebar').style.width = `${(left / (data.settings.timer * 1000)) * 100}%`;
  requestAnimationFrame(tick);
}

function answer(idx) {
  if (session.answered) return;
  session.answered = true;
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
  $('instrument').innerHTML = renderInstrument(q.scenario, q.result);
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
$('finish').addEventListener('click', () => (session.log.length ? endSession() : (session = null, fillSetup(), show('setup'))));
$('again').addEventListener('click', () => { fillSetup(); show('setup'); });

document.addEventListener('keydown', (e) => {
  if (!session || $('quiz').hidden) return;
  if (!session.answered && /^[1-5]$/.test(e.key)) {
    const idx = Number(e.key) - 1;
    if (idx < session.q.options.length) answer(idx);
  } else if (session.answered && e.key === 'Enter' && e.target.id !== 'finish') {
    e.preventDefault();
    nextQuestion();
  }
});

fillSetup();
