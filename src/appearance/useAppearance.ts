// One shared appearance store for the window: components read it with
// useAppearance() and change it with setAppearance(); every change is saved and
// applied to <html> at once. Another window of the app (the minimap) picks the
// change up through the storage event.
import { useSyncExternalStore } from 'react';
import {
  APPEARANCE_KEY,
  applyAppearance,
  loadAppearance,
  normalizeAppearance,
  saveAppearance,
  type Appearance,
} from './appearance';

let current: Appearance = loadAppearance();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getAppearance(): Appearance {
  return current;
}

export function setAppearance(patch: Partial<Appearance> | ((a: Appearance) => Partial<Appearance>)): void {
  const p = typeof patch === 'function' ? patch(current) : patch;
  current = normalizeAppearance({ ...current, ...p, glass: { ...current.glass, ...(p.glass ?? {}) } });
  saveAppearance(current);
  applyAppearance(current);
  emit();
}

/** Apply the saved look before the first paint and follow other windows' changes. */
export function initAppearance(): void {
  applyAppearance(current);
  window.addEventListener('storage', (e) => {
    if (e.key !== APPEARANCE_KEY) return;
    current = loadAppearance();
    applyAppearance(current);
    emit();
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, getAppearance, getAppearance);
}
