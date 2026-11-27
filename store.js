// localStorage persistence. Every access is guarded: the app must work without storage.
const KEY = 'basicir.v2';
const V1_KEY = 'basicir.v1';
const HISTORY_MAX = 30;

// Allowed values per filter, in the order the generator draws from them (keeps v1 seeds stable).
export const FILTER_VALUES = {
  bands: ['correction', '45', '90/45', 'overstation'],
  dirs: ['inbound', 'outbound'],
  phrasings: ['radial', 'q'],
  turns: ['std', 'nonstd'],
  navs: ['NDB', 'VOR'],
};

export const defaults = () => ({
  version: 2,
  settings: {
    types: ['intercept', 'hold'],
    display: 'numbers', // 'numbers' | 'instruments' | 'mixed'
    instruments: ['rmi'], // subset of ['rmi', 'hsi', 'dicdi']
    timer: 45, // 0..600
    length: 20, // 0 | 10 | 20
    theme: 'system', // 'system' | 'light' | 'dark'
    answerMode: 'mc', // 'mc' | 'input'
    cdiMode: 'centered', // 'centered' | 'deflected' | 'interactive'
    adaptive: false,
    filters: {
      ...Object.fromEntries(Object.entries(FILTER_VALUES).map(([k, v]) => [k, [...v]])),
      boundaryFocus: false,
    },
  },
  stats: {}, // statKey → { correct, total, ms }
  mistakes: [], // scenarios
  history: [], // last 30 sessions: { at, right, total, avgMs, review }
});

const storageOr = (storage) => storage ?? globalThis.localStorage;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const oneOf = (v, ok, d) => (ok.includes(v) ? v : d);
const known = (v, ok, d) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? v.filter((x) => ok.includes(x)) : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);

// Any field that fails validation falls back to its default.
function validSettings(s, def) {
  const f = isObj(s.filters) ? s.filters : {};
  const filters = { boundaryFocus: bool(f.boundaryFocus, def.filters.boundaryFocus) };
  for (const [k, ok] of Object.entries(FILTER_VALUES)) filters[k] = known(f[k], ok, def.filters[k]);
  return {
    types: known(s.types, ['intercept', 'hold'], def.types),
    instruments: known(s.instruments, ['rmi', 'hsi', 'dicdi'], def.instruments),
    display: oneOf(s.display, ['numbers', 'instruments', 'mixed'], def.display),
    timer: Number.isFinite(s.timer) && s.timer >= 0 && s.timer <= 600 ? s.timer : def.timer,
    length: oneOf(s.length, [0, 10, 20], def.length),
    theme: oneOf(s.theme, ['system', 'light', 'dark'], def.theme),
    answerMode: oneOf(s.answerMode, ['mc', 'input'], def.answerMode),
    cdiMode: oneOf(s.cdiMode, ['centered', 'deflected', 'interactive'], def.cdiMode),
    adaptive: bool(s.adaptive, def.adaptive),
    filters,
  };
}

const validMistake = (m) => isObj(m) && (m.kind === 'intercept' || m.kind === 'hold') && typeof m.id === 'string';
const validEntry = (h) => isObj(h) && ['at', 'right', 'total', 'avgMs'].every((k) => Number.isFinite(h[k]));

// Guarded end to end: even touching globalThis.localStorage can throw when storage is blocked.
function read(storage, key) {
  try { return JSON.parse(storageOr(storage).getItem(key)); } catch { return null; }
}

// basicir.v2 first; if missing or unusable, migrate basicir.v1; otherwise defaults.
export function load(storage) {
  let d = read(storage, KEY);
  if (!(isObj(d) && d.version === 2)) {
    const old = read(storage, V1_KEY);
    d = isObj(old) && old.version === 1 ? old : null;
  }
  const def = defaults();
  if (!d) return def;
  return {
    version: 2,
    settings: validSettings(isObj(d.settings) ? d.settings : {}, def.settings),
    stats: isObj(d.stats) ? Object.fromEntries(Object.entries(d.stats).filter(([, v]) => isObj(v) && ['correct', 'total', 'ms'].every((k) => Number.isFinite(v[k])))) : def.stats,
    mistakes: Array.isArray(d.mistakes) ? d.mistakes.filter(validMistake) : def.mistakes,
    history: Array.isArray(d.history) ? d.history.filter(validEntry).slice(-HISTORY_MAX) : def.history,
  };
}

export function save(data, storage) {
  try { storageOr(storage).setItem(KEY, JSON.stringify(data)); } catch { /* not persisted */ }
}

// Record one answered question. Returns the updated data (mutates in place).
export function record(data, { statKey, correct, ms, scenario }) {
  const st = (data.stats[statKey] ??= { correct: 0, total: 0, ms: 0 });
  st.total++;
  st.ms += ms;
  if (correct) st.correct++;
  const i = data.mistakes.findIndex((m) => m.id === scenario.id);
  if (!correct && i === -1) data.mistakes.push(scenario);
  if (correct && i !== -1) data.mistakes.splice(i, 1);
  return data;
}

export function recordSession(data, entry) {
  data.history.push(entry);
  if (data.history.length > HISTORY_MAX) data.history.splice(0, data.history.length - HISTORY_MAX);
  return data;
}

export function clearMistakes(data) {
  data.mistakes = [];
  return data;
}

// Clears stats and history; settings and mistakes stay.
export function resetStats(data) {
  data.stats = {};
  data.history = [];
  return data;
}

// Mean accuracy (0..1) and answer time over past sessions, weighted by questions; null if none.
export function historyAverage(history) {
  const total = history.reduce((a, h) => a + h.total, 0);
  if (!total) return null;
  return {
    acc: history.reduce((a, h) => a + h.right, 0) / total,
    avgMs: history.reduce((a, h) => a + h.avgMs * h.total, 0) / total,
  };
}
