// js/storage.js keeps the interrupted-run snapshots in localStorage (session.js
// saveSnapshot on pause, offered back as "Welcome back" at the next start): the
// engine's, the game's device storage under the same "metro-dash:" keys. It must
// be in place before js/storage.js runs, so this is main.ts's first import. The
// progress itself is the engine save (native/platform.ts).
import { installLocalStorage } from "starhermit:storage";

installLocalStorage();
