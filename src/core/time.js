// Relógio da simulação no fuso de São Paulo.
// O relógio pode estar "ao vivo" (hora real) ou em modo simulação (outro horário e/ou acelerado).

const TZ = 'America/Sao_Paulo';
const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

let cache = { key: NaN, off: -3 * 3600e3 };

/** Diferença (ms) entre o relógio de parede em SP e o UTC no instante `ms`. */
function tzOffset(ms) {
  const key = Math.floor(ms / 3600e3);
  if (key === cache.key) return cache.off;
  try {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    cache = { key, off: wall - Math.floor(ms / 1000) * 1000 };
  } catch {
    cache = { key, off: -3 * 3600e3 };
  }
  return cache.off;
}

/** { day: nº do dia local, sec: segundos desde 00:00 local, dow: 0=domingo } */
export function spTime(ms) {
  const wall = ms + tzOffset(ms);
  const day = Math.floor(wall / 86400e3);
  const sec = (wall - day * 86400e3) / 1000;
  const dow = new Date(day * 86400e3).getUTCDay();
  return { day, sec, dow };
}

export function dayTypeOf(dow) {
  if (dow === 0) return 'sun';
  if (dow === 6) return 'sat';
  return 'wkd';
}

export class SimClock {
  constructor() {
    this.rate = 1;
    this.anchorReal = performance.now();
    this.anchorSim = Date.now();
    this.dayOverride = null; // 'wkd' | 'sat' | 'sun' | null
    this.listeners = new Set();
  }
  now() {
    return this.anchorSim + (performance.now() - this.anchorReal) * this.rate;
  }
  get isLive() {
    return this.rate === 1 && !this.dayOverride && Math.abs(this.now() - Date.now()) < 3000;
  }
  _emit() {
    for (const f of this.listeners) f(this);
  }
  set(ms) {
    this.anchorReal = performance.now();
    this.anchorSim = ms;
    this._emit();
  }
  setRate(r) {
    const n = this.now();
    this.anchorReal = performance.now();
    this.anchorSim = n;
    this.rate = r;
    this._emit();
  }
  /** Leva o relógio para o horário local `sec` (segundos desde 00:00) do dia simulado atual. */
  setTimeOfDay(sec) {
    const n = this.now();
    const t = spTime(n);
    this.set(n + (sec - t.sec) * 1000);
  }
  setDayOverride(type) {
    this.dayOverride = type;
    this._emit();
  }
  goLive() {
    this.rate = 1;
    this.dayOverride = null;
    this.set(Date.now());
  }
  /** Estado atual no fuso de SP, já com o tipo de dia (útil/sábado/domingo). */
  state() {
    const ms = this.now();
    const t = spTime(ms);
    return {
      ms,
      day: t.day,
      sec: t.sec,
      dow: t.dow,
      type: this.dayOverride ?? dayTypeOf(t.dow),
      prevType: this.dayOverride ?? dayTypeOf((t.dow + 6) % 7),
      nextType: this.dayOverride ?? dayTypeOf((t.dow + 1) % 7),
    };
  }
}
