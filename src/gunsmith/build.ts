// A weapon build: which part sits in which slot, like the in-game modding
// screen. Slots are addressed by their path from the gun ("mod_handguard" →
// "mod_handguard/mod_mount_000"), which stays stable across data refreshes.
import type { RawSlot, WeaponData } from './data';

export interface Build {
  weaponId: string;
  /** slot path → item id */
  parts: Record<string, string>;
}

export interface SlotRow {
  path: string;
  slot: string;
  depth: number;
  required: boolean;
  allowed: string[];
  itemId: string | null;
}

function slotsOf(data: WeaponData, itemId: string): RawSlot[] {
  return data.weapons[itemId]?.s ?? data.mods[itemId]?.s ?? [];
}

const childPath = (parent: string, slot: string) => (parent ? `${parent}/${slot}` : slot);

/** Every slot of the build, depth-first in game order; empty slots included. */
export function slotTree(data: WeaponData, build: Build): SlotRow[] {
  const rows: SlotRow[] = [];
  const walk = (itemId: string, parent: string, depth: number) => {
    for (const s of slotsOf(data, itemId)) {
      const path = childPath(parent, s.n);
      const equipped = build.parts[path] ?? null;
      rows.push({ path, slot: s.n, depth, required: !!s.q, allowed: s.i, itemId: equipped });
      if (equipped) walk(equipped, path, depth + 1);
    }
  };
  walk(build.weaponId, '', 0);
  return rows;
}

/** Item ids on the gun, the gun excluded. */
export function equippedIds(build: Build): string[] {
  return Object.values(build.parts);
}

/** Drop parts whose parent slot no longer holds what they hang on. */
export function prune(data: WeaponData, build: Build): Build {
  const keep: Record<string, string> = {};
  for (const row of slotTree(data, build)) if (row.itemId && row.allowed.includes(row.itemId)) keep[row.path] = row.itemId;
  return { ...build, parts: keep };
}

/** Equipped parts that cannot coexist with `itemId` (either side may declare it). */
export function conflictsWith(data: WeaponData, build: Build, itemId: string, ignorePath?: string): string[] {
  const mine = new Set(data.mods[itemId]?.c ?? []);
  const out: string[] = [];
  for (const [path, id] of Object.entries(build.parts)) {
    if (path === ignorePath || (ignorePath && path.startsWith(`${ignorePath}/`))) continue;
    if (mine.has(id) || (data.mods[id]?.c ?? []).includes(itemId)) out.push(id);
  }
  return out;
}

/** Put `itemId` in `path` (null empties it); everything hanging below is removed, and so is whatever conflicts. */
export function equip(data: WeaponData, build: Build, path: string, itemId: string | null): Build {
  const parts: Record<string, string> = {};
  for (const [p, id] of Object.entries(build.parts)) {
    if (p === path || p.startsWith(`${path}/`)) continue;
    parts[p] = id;
  }
  if (itemId) {
    const clash = new Set(conflictsWith(data, { ...build, parts }, itemId));
    for (const [p, id] of Object.entries(parts)) if (clash.has(id)) delete parts[p];
    parts[path] = itemId;
  }
  return prune(data, { ...build, parts });
}

/** The gun as it ships (its default preset), its parts slotted greedily into the tree. */
export function factoryBuild(data: WeaponData, weaponId: string): Build {
  let build: Build = { weaponId, parts: {} };
  const pending = [...(data.weapons[weaponId]?.d ?? [])];
  let placed = true;
  while (pending.length && placed) {
    placed = false;
    for (const row of slotTree(data, build)) {
      if (row.itemId) continue;
      const i = pending.findIndex((id) => row.allowed.includes(id));
      if (i < 0) continue;
      build = { ...build, parts: { ...build.parts, [row.path]: pending[i] } };
      pending.splice(i, 1);
      placed = true;
    }
  }
  return build;
}

export interface BuildStats {
  ergonomics: number;
  recoilVertical: number;
  recoilHorizontal: number;
  weight: number;
  /** Sum of the parts' recoil modifiers (−0.12 = −12 %). */
  recoilModifier: number;
}

/**
 * Stats the way the modding screen sums them: ergonomics add up, recoil is the
 * gun's base times (1 + Σ part modifiers). An estimate — the game also applies
 * skills, durability and ammo.
 */
export function buildStats(data: WeaponData, build: Build): BuildStats {
  const gun = data.weapons[build.weaponId] ?? {};
  let ergo = gun.e ?? 0;
  let rec = 0;
  let weight = gun.w ?? 0;
  for (const id of equippedIds(build)) {
    const m = data.mods[id];
    if (!m) continue;
    ergo += m.e ?? 0;
    rec += m.r ?? 0;
    weight += m.w ?? 0;
  }
  return {
    ergonomics: Math.round(ergo * 10) / 10,
    recoilVertical: Math.round((gun.rv ?? 0) * (1 + rec)),
    recoilHorizontal: Math.round((gun.rh ?? 0) * (1 + rec)),
    weight: Math.round(weight * 1000) / 1000,
    recoilModifier: rec,
  };
}

/** Required slots still empty (the gun would not fire). */
export function missingRequired(data: WeaponData, build: Build): SlotRow[] {
  return slotTree(data, build).filter((r) => r.required && !r.itemId);
}
