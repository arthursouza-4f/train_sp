// Estações favoritas, salvas só no próprio aparelho (localStorage). Sem login.

const KEY = 'trainview-sp:favoritas';

export function createFavorites() {
  let ids = [];
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(v)) ids = v.filter((x) => typeof x === 'string');
  } catch {
    // modo privado ou armazenamento bloqueado: favoritos valem só nesta visita
  }
  const listeners = new Set();
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(ids));
    } catch {
      // idem
    }
    for (const f of listeners) f(ids);
  };
  return {
    has: (id) => ids.includes(id),
    list: () => ids.slice(),
    /** Liga/desliga; retorna se ficou favorita. */
    toggle(id) {
      const on = !ids.includes(id);
      ids = on ? [...ids, id] : ids.filter((x) => x !== id);
      save();
      return on;
    },
    onChange: (f) => listeners.add(f),
  };
}
