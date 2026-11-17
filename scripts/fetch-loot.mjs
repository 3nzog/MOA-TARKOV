// Fetches where the loot is on every map from tarkov.dev's JSON dumps and
// writes it to data/snapshot/loot.json, for the raid route's loot goals
// (money, hideout items, weapons):
//
//   loose spots   a position and the items that CAN spawn there (the game
//                 picks one or none; the chance of each is not published)
//   containers    a position and the container's kind (safe, pc-block,
//                 toolbox, weapon-box, …)
//   kinds         per item: gun, weapon part, ammo or other (the weapons goal)
//
// Language-independent and compact: item ids and container kinds are stored
// once in index tables, positions rounded to 10 cm. The app loads the file
// lazily, only when a loot route is asked for.
//
// Same outage-vs-defect contract as fetch-progression.mjs: an unreachable
// upstream exits 0 and keeps the committed file; a malformed payload exits 1.
//
//   node scripts/fetch-loot.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.SNAPSHOT_BASE_URL ?? 'https://json.tarkov.dev';
const GAME_MODE = 'regular';
const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'snapshot');

class UpstreamOutage extends Error {}
const OUTAGE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const OUTAGE_TEXT = /unavailable|try again later|timeout|timed out|bad gateway|overloaded/i;

async function fetchJson(path) {
  let res;
  try {
    res = await fetch(`${BASE_URL}/${path}`);
  } catch (err) {
    throw new UpstreamOutage(err.message);
  }
  const raw = await res.text();
  if (!res.ok) {
    const outage = OUTAGE_STATUS.has(res.status) || OUTAGE_TEXT.test(raw);
    const detail = `HTTP ${res.status} — ${raw.slice(0, 200)}`;
    throw outage ? new UpstreamOutage(detail) : new Error(detail);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new UpstreamOutage(`non-JSON body — ${raw.slice(0, 200)}`);
  }
}

const arr = (v) => (Array.isArray(v) ? v : []);
const list = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const dm = (v) => Math.round(v * 10) / 10;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

/**
 * What an item is, for the "weapons" goal: g = gun, m = weapon part (sights,
 * scopes, mounts, handguards, magazines, …), a = ammo, o = anything else.
 */
function kindOf(item) {
  const t = arr(item?.types);
  if (t.includes('gun') || t.includes('preset')) return 'g';
  if (t.includes('ammo') || t.includes('ammoBox')) return 'a';
  if (t.includes('mods') || t.includes('suppressor') || t.includes('pistolGrip')) return 'm';
  return 'o';
}

async function main() {
  const [json, itemsJson] = await Promise.all([fetchJson(`${GAME_MODE}/maps`), fetchJson(`${GAME_MODE}/items`)]);
  const data = json?.data;
  if (typeof data !== 'object' || data === null) throw new Error('unexpected shape for maps');
  const allItems = itemsJson?.data?.items;
  if (typeof allItems !== 'object' || allItems === null) throw new Error('unexpected shape for items');
  const containerKinds = data.lootContainers ?? {};

  const items = [];
  const itemIndex = new Map();
  const itemAt = (id) => {
    let i = itemIndex.get(id);
    if (i === undefined) {
      i = items.length;
      items.push(id);
      itemIndex.set(id, i);
    }
    return i;
  };
  const types = [];
  const typeIndex = new Map();
  const typeAt = (kind) => {
    let i = typeIndex.get(kind);
    if (i === undefined) {
      i = types.length;
      types.push(kind);
      typeIndex.set(kind, i);
    }
    return i;
  };

  const maps = {};
  let loose = 0;
  let containers = 0;
  for (const m of list(data.maps)) {
    if (typeof m?.id !== 'string') continue;
    const l = [];
    for (const s of arr(m.lootLoose)) {
      const p = s?.position;
      if (!p || !finite(p.x) || !finite(p.z)) continue;
      const ids = arr(s.items).filter((id) => typeof id === 'string');
      if (ids.length === 0) continue;
      l.push([dm(p.x), dm(p.z), dm(finite(p.y) ? p.y : 0), ids.map(itemAt)]);
    }
    const c = [];
    for (const lc of arr(m.lootContainers)) {
      const p = lc?.position;
      if (!p || !finite(p.x) || !finite(p.z)) continue;
      const kind = containerKinds[lc.lootContainer]?.normalizedName;
      if (typeof kind !== 'string' || !kind) continue;
      c.push([dm(p.x), dm(p.z), dm(finite(p.y) ? p.y : 0), typeAt(kind)]);
    }
    if (l.length === 0 && c.length === 0) continue;
    maps[m.id] = { n: m.normalizedName, l, c };
    loose += l.length;
    containers += c.length;
  }

  if (Object.keys(maps).length < 8 || loose < 1000 || containers < 1000) {
    throw new Error(`suspiciously small payload: ${Object.keys(maps).length} maps, ${loose} loose spots, ${containers} containers`);
  }

  // One letter per item, parallel to `items` (see kindOf).
  const kinds = items.map((id) => kindOf(allItems[id])).join('');
  const out = { generatedAt: new Date().toISOString(), gameMode: GAME_MODE, types, items, kinds, maps };
  await mkdir(OUT_DIR, { recursive: true });
  const body = JSON.stringify(out);
  await writeFile(resolve(OUT_DIR, 'loot.json'), body);
  console.log(`loot.json: ${Object.keys(maps).length} maps, ${loose} loose spots, ${containers} containers, ${items.length} items, ${kb(body.length)}`);
}

main().catch((err) => {
  if (err instanceof UpstreamOutage) {
    console.warn(`tarkov.dev unreachable, keeping the committed loot data: ${err.message}`);
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});
