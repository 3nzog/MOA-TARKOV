// The player's weapon presets, kept by MoA on this PC. (The presets saved in
// the game live on Battlestate's servers; no passive source exposes them, so
// they are rebuilt here once.) A preset can be shared as a short text code.
import { useSyncExternalStore } from 'react';
import type { Build } from './build';

export interface WeaponPreset {
  id: string;
  name: string;
  weaponId: string;
  parts: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

const KEY = 'tc_weapon_presets_v1';
const ID_RE = /^[0-9a-f]{24}$/i;

function cleanParts(raw: unknown): Record<string, string> {
  const parts: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return parts;
  for (const [path, id] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id === 'string' && ID_RE.test(id) && /^[\w/]{1,300}$/.test(path)) parts[path] = id;
  }
  return parts;
}

function clean(raw: unknown): WeaponPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<WeaponPreset>;
  if (typeof p.weaponId !== 'string' || !ID_RE.test(p.weaponId)) return null;
  const now = Date.now();
  return {
    id: typeof p.id === 'string' && p.id ? p.id : newId(),
    name: (typeof p.name === 'string' ? p.name : '').trim().slice(0, 60) || 'Preset',
    weaponId: p.weaponId,
    parts: cleanParts(p.parts),
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : now,
    updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : now,
  };
}

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function load(): WeaponPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.map(clean).filter((p): p is WeaponPreset => p !== null) : [];
  } catch {
    return [];
  }
}

let current = load();
const listeners = new Set<() => void>();

function commit(next: WeaponPreset[]) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  for (const l of listeners) l();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    current = load();
    for (const l of listeners) l();
  });
}

export function usePresets(): WeaponPreset[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}

/** Save a build as a new preset; returns it. */
export function createPreset(name: string, build: Build): WeaponPreset {
  const now = Date.now();
  const p: WeaponPreset = {
    id: newId(),
    name: name.trim().slice(0, 60) || 'Preset',
    weaponId: build.weaponId,
    parts: { ...build.parts },
    createdAt: now,
    updatedAt: now,
  };
  commit([...current, p]);
  return p;
}

/** Overwrite a preset's parts (and optionally its name). */
export function updatePreset(id: string, build: Build, name?: string): void {
  commit(
    current.map((p) =>
      p.id === id
        ? { ...p, weaponId: build.weaponId, parts: { ...build.parts }, name: name?.trim().slice(0, 60) || p.name, updatedAt: Date.now() }
        : p,
    ),
  );
}

export function renamePreset(id: string, name: string): void {
  const n = name.trim().slice(0, 60);
  if (!n) return;
  commit(current.map((p) => (p.id === id ? { ...p, name: n, updatedAt: Date.now() } : p)));
}

export function duplicatePreset(id: string, copyName: (name: string) => string): WeaponPreset | null {
  const src = current.find((p) => p.id === id);
  if (!src) return null;
  return createPreset(copyName(src.name), { weaponId: src.weaponId, parts: src.parts });
}

export function deletePreset(id: string): void {
  commit(current.filter((p) => p.id !== id));
}

// ---- share codes -------------------------------------------------------------
const PREFIX = 'MOA1:';

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** A copy-paste code for a preset (name, gun and parts; nothing about the player). */
export function shareCode(name: string, build: Build): string {
  return PREFIX + toBase64Url(JSON.stringify({ n: name, w: build.weaponId, p: build.parts }));
}

/** Read a share code back; null when it is not one. */
export function readShareCode(code: string): { name: string; build: Build } | null {
  const t = code.trim();
  if (!t.startsWith(PREFIX)) return null;
  try {
    const o = JSON.parse(fromBase64Url(t.slice(PREFIX.length))) as { n?: unknown; w?: unknown; p?: unknown };
    if (typeof o.w !== 'string' || !ID_RE.test(o.w)) return null;
    const name = typeof o.n === 'string' ? o.n.trim().slice(0, 60) : '';
    return { name: name || 'Preset', build: { weaponId: o.w, parts: cleanParts(o.p) } };
  } catch {
    return null;
  }
}
