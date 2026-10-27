// What the browser build's modules expect of a page, over the runtime: the
// first import of main.ts, so it is in place before js/storage.js runs.
// - localStorage: js/storage.js keeps the interrupted-run snapshots there
//   (session.js saveSnapshot on pause, offered back as "Welcome back" at the
//   next start); here they live in the game's device storage
//   (starhermit:storage `storage`, the same "metro-dash:" keys). Storage's
//   probe key stays in memory. The progress itself is not kept here: it is
//   the engine save (native/platform.ts).
import { storage } from "starhermit:storage";

const memory = new Map<string, string>();
const probe = (key: string): boolean => key.endsWith(":probe");
const local = {
  getItem(key: string): string | null {
    if (probe(key)) return memory.get(key) ?? null;
    try { return storage.getText(key); } catch { return null; }
  },
  setItem(key: string, value: string): void {
    if (probe(key)) { memory.set(key, String(value)); return; }
    try { storage.set(key, String(value)); } catch (e) { console.warn(`storage ${key}: ${String(e)}`); }
  },
  removeItem(key: string): void {
    if (probe(key)) { memory.delete(key); return; }
    try { storage.remove(key); } catch { /* gone */ }
  },
};
(globalThis as unknown as { localStorage?: typeof local }).localStorage = local;
