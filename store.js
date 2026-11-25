// localStorage persistence. Every access is guarded: the app must work without storage.
const KEY = 'basicir.v1';

export const defaults = () => ({
  version: 1,
  settings: { types: ['intercept', 'hold'], display: 'numbers', instruments: ['rmi'], timer: 45, length: 20 },
  stats: {}, // statKey → { correct, total, ms }
  mistakes: [], // scenarios
});

const storageOr = (storage) => storage ?? globalThis.localStorage;

export function load(storage) {
  try {
    const d = JSON.parse(storageOr(storage).getItem(KEY));
    if (d && d.version === 1) {
      const def = defaults();
      return { ...def, ...d, settings: { ...def.settings, ...d.settings } };
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
