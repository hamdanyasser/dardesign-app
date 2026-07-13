// Day/Night mode resolution + DOM application (UNDERSTOOD_ROOM_THREEJS_SPEC.md §6).
// M1 resolves the mode once at init and builds the world in that palette; the
// animated 1.5s relight + the toggle pill land with M5.

import type { DDMode, Palette } from "./tokens";
import { PALETTES } from "./tokens";

const STORAGE_KEY = "dd-mode";

/**
 * Initial mode: ?mode= param → saved choice → night.
 * Night is the intended default aesthetic (acceptance checklist item 1), so we
 * deliberately do NOT consult prefers-color-scheme — a light OS theme must not
 * flip the film to parchment on load. An explicit ?mode=day or a saved choice
 * still wins.
 */
export function resolveInitialMode(search: string): DDMode {
  try {
    const m = new URLSearchParams(search).get("mode");
    if (m === "day" || m === "night") return m;
  } catch {
    /* malformed search string — fall through */
  }
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "day" || saved === "night") return saved;
  } catch {
    /* storage unavailable (private mode) — fall through */
  }
  return "night";
}

export function applyDomMode(mode: DDMode): void {
  document.documentElement.setAttribute("data-dd-mode", mode);
}

export function clearDomMode(): void {
  document.documentElement.removeAttribute("data-dd-mode");
}

export function saveMode(mode: DDMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage unavailable — the choice just won't persist */
  }
}

export function getPalette(mode: DDMode): Palette {
  return PALETTES[mode];
}
