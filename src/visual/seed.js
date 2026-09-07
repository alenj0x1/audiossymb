// Utilidades de aleatoriedad determinista: la misma canción produce la misma "vibra"
// (salvo que el usuario pida una nueva), pero cada canción distinta es un mundo distinto.

export function hashString(str, seed = 0) {
  // cyrb53
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const r = mulberry32(typeof seed === 'string' ? hashString(seed) : seed >>> 0);
  const rng = {
    next: r,
    range: (a, b) => a + (b - a) * r(),
    int: (a, b) => a + Math.floor(r() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    chance: (p) => r() < p,
    sign: () => (r() < 0.5 ? -1 : 1),
    // valor con sesgo hacia los extremos (bias<1) o hacia el centro (bias>1)
    curve: (a, b, bias = 1) => a + (b - a) * Math.pow(r(), bias),
    // aproximación gaussiana (suma de tres uniformes): valores "naturales"
    gauss: (mean = 0, dev = 1) => mean + ((r() + r() + r()) / 1.5 - 1) * dev,
    shuffle: (arr) => { const c = arr.slice(); for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c; },
    // elige entre pares [valor, peso]
    weighted: (pairs) => {
      const total = pairs.reduce((s, p) => s + p[1], 0);
      let x = r() * total;
      for (const [v, w] of pairs) { x -= w; if (x <= 0) return v; }
      return pairs[pairs.length - 1][0];
    },
  };
  rng.subset = (arr, n) => rng.shuffle(arr).slice(0, n);
  return rng;
}
