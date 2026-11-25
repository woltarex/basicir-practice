// localStorage persistence. Every access is guarded: the app must work without storage.
const KEY = 'basicir.v1';

export const defaults = () => ({
  version: 1,
  settings: { types: ['intercept', 'hold'], display: 'numbers', instruments: ['rmi'], timer: 45, length: 20 },
  stats: {}, // statKey → { correct, total, ms }
  mistakes: [], // scenarios
});

const storageOr = (storage) => storage ?? globalThis.localStorage;

// Any field that fails validation falls back to its default.
function validSettings(s, def) {
  const known = (v, ok, d) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? v.filter((x) => ok.includes(x)) : d);
  return {
    types: known(s.types, ['intercept', 'hold'], def.types),
    instruments: known(s.instruments, ['rmi', 'hsi', 'dicdi'], def.instruments),
    display: ['numbers', 'instruments', 'mixed'].includes(s.display) ? s.display : def.display,
    timer: Number.isFinite(s.timer) && s.timer >= 0 && s.timer <= 600 ? s.timer : def.timer,
    length: [0, 10, 20].includes(s.length) ? s.length : def.length,
  };
}

export function load(storage) {
  try {
    const d = JSON.parse(storageOr(storage).getItem(KEY));
    if (d && d.version === 1) {
      const def = defaults();
      return {
        ...def, ...d,
        settings: validSettings({ ...def.settings, ...d.settings }, def.settings),
        stats: d.stats && typeof d.stats === 'object' && !Array.isArray(d.stats) ? d.stats : def.stats,
        mistakes: Array.isArray(d.mistakes)
          ? d.mistakes.filter((m) => m && typeof m === 'object' && (m.kind === 'intercept' || m.kind === 'hold') && typeof m.id === 'string')
          : def.mistakes,
      };
    }
  } catch { /* blocked or corrupt → defaults */ }
  return defaults();
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
