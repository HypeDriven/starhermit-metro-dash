// Seeded deterministic random streams. Rules, decoration, and audiovisual
// variants each use their own stream so cosmetic randomness never affects play.

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }
  next() {
    // mulberry32
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min, max) {
    // inclusive both ends
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p) {
    return this.next() < p;
  }
  fork(label) {
    return new Rng(fnv1a(`${this.state}:${label}`));
  }
  clone() {
    const r = new Rng(1);
    r.state = this.state;
    return r;
  }
}
