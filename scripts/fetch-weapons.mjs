// Fetches what the weapon bench needs from tarkov.dev's JSON dumps and writes
// it to data/snapshot:
//
//   weapons.json          language-independent: every gun, its slot tree, every
//                         mod reachable from it (stats, slots, conflicts) and
//                         where each part comes from (trader + loyalty level,
//                         barters, hideout crafts, flea) — prices are an
//                         ESTIMATE frozen at generatedAt
//   weapons-<lang>.json   item, slot, category, trader and station names
//
// The bench loads these lazily, so they never slow down the map.
//
// Same outage-vs-defect contract as fetch-progression.mjs: an unreachable
// upstream exits 0 and keeps the committed files; a malformed payload exits 1.
//
//   node scripts/fetch-weapons.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.SNAPSHOT_BASE_URL ?? 'https://json.tarkov.dev';
const GAME_MODE = 'regular';
const LANGS = ['en', 'pt', 'ru', 'ja', 'zh', 'es'];
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
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const round = (v, d = 4) => (v === undefined ? undefined : Math.round(v * 10 ** d) / 10 ** d);
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === false || v === 0) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

function dataOf(json, what) {
  const d = json?.data;
  if (typeof d !== 'object' || d === null) throw new Error(`unexpected shape for ${what}`);
  return d;
}

async function main() {
  const [itemsJson, tradersJson, bartersJson, craftsJson, hideoutJson] = await Promise.all(
    ['items', 'traders', 'barters', 'crafts', 'hideout'].map((d) => fetchJson(`${GAME_MODE}/${d}`)),
  );
  const hideout = dataOf(hideoutJson, 'hideout');
  const itemsData = dataOf(itemsJson, 'items');
  const items = itemsData.items;
  if (typeof items !== 'object' || items === null) throw new Error('unexpected shape for items.items');
  const traders = dataOf(tradersJson, 'traders');
  const barters = arr(dataOf(bartersJson, 'barters'));
  const crafts = arr(dataOf(craftsJson, 'crafts'));

  const props = (it) => (it && typeof it.properties === 'object' && it.properties) || {};
  const slotsOf = (it) =>
    arr(props(it).slots).map((s) => ({
      n: String(s.nameId),
      q: s.required ? 1 : 0,
      i: arr(s.filters?.allowedItems).filter((id) => items[id]),
    }));

  // ---- guns and every mod reachable from them ------------------------------
  const guns = Object.values(items).filter((it) => arr(it.types).includes('gun') && props(it).propertiesType === 'ItemPropertiesWeapon');
  const reach = new Set();
  const queue = [];
  for (const g of guns) for (const s of slotsOf(g)) queue.push(...s.i);
  while (queue.length) {
    const id = queue.pop();
    if (reach.has(id)) continue;
    reach.add(id);
    for (const s of slotsOf(items[id])) queue.push(...s.i);
  }

  const weapons = {};
  for (const g of guns) {
    const p = props(g);
    const preset = p.defaultPreset ? items[p.defaultPreset] : null;
    weapons[g.id] = compact({
      e: num(p.ergonomics),
      rv: num(p.recoilVertical),
      rh: num(p.recoilHorizontal),
      w: round(num(g.weight), 3),
      cal: typeof p.caliber === 'string' ? p.caliber.replace(/^Caliber/, '') : undefined,
      fr: num(p.fireRate),
      cat: arr(g.categories)[0],
      s: slotsOf(g),
      // The factory build: its parts, slotted into the tree by the app.
      d: preset ? arr(preset.containsItems).map((c) => c.item).filter((id) => reach.has(id)) : undefined,
    });
  }

  const mods = {};
  for (const id of reach) {
    const it = items[id];
    const p = props(it);
    mods[id] = compact({
      e: num(p.ergonomics ?? it.ergonomicsModifier),
      r: round(num(p.recoilModifier)),
      a: round(num(p.accuracyModifier)),
      w: round(num(it.weight), 3),
      t: arr(it.types).find((x) => !['mods', 'wearable', 'noFlea'].includes(x)),
      cap: num(p.capacity),
      s: slotsOf(it),
      c: arr(it.conflictingItems).filter((x) => reach.has(x)),
    });
  }

  // ---- where each part / gun comes from ----------------------------------
  const wanted = new Set([...reach, ...guns.map((g) => g.id)]);
  const src = {};
  const at = (id) => (src[id] ??= {});
  for (const id of wanted) {
    const it = items[id];
    const offers = arr(it.buyFromTrader)
      .filter((o) => traders[o.trader])
      .map((o) => [o.trader, o.minTraderLevel ?? 1, o.priceRUB ?? o.price, o.taskUnlock ?? 0]);
    if (offers.length) at(id).o = offers;
    const flea = num(it.avg24hPrice) || num(it.lastLowPrice);
    if (flea && !arr(it.types).includes('noFlea')) at(id).f = flea;
  }
  const barterNeeds = new Set();
  for (const b of barters) {
    const id = b.offeredItem?.item;
    if (!wanted.has(id) || !traders[b.trader]) continue;
    const req = arr(b.requiredItems).map((r) => [r.item, r.count]);
    for (const [r] of req) barterNeeds.add(r);
    (at(id).b ??= []).push([b.trader, b.minTraderLevel ?? 1, req, b.taskUnlock ?? 0]);
  }
  const stations = new Set();
  for (const c of crafts) {
    const id = c.productItem?.item;
    if (!wanted.has(id)) continue;
    stations.add(c.station);
    (at(id).c ??= []).push([c.station, c.level ?? 1]);
  }

  const traderList = Object.values(traders).map((t) => ({
    id: t.id,
    key: t.normalizedName,
    levels: arr(t.levels).map((l) => [l.level, l.requiredPlayerLevel ?? 0]),
  }));

  const out = {
    generatedAt: new Date().toISOString(),
    fleaMinLevel: num(itemsData.fleaMarket?.minPlayerLevel) ?? 15,
    traders: traderList,
    weapons,
    mods,
    src,
  };
  if (Object.keys(weapons).length < 50 || Object.keys(mods).length < 500) {
    throw new Error(`suspiciously small payload: ${Object.keys(weapons).length} guns, ${Object.keys(mods).length} mods`);
  }

  // ---- names per language ------------------------------------------------
  const named = new Set([...wanted, ...barterNeeds]);
  const cats = new Set(guns.map((g) => arr(g.categories)[0]).filter(Boolean));
  const slotNames = new Set();
  for (const w of Object.values(weapons)) for (const s of w.s ?? []) slotNames.add(s.n);
  for (const m of Object.values(mods)) for (const s of m.s ?? []) slotNames.add(s.n);

  const locales = {};
  for (const lang of LANGS) {
    const [itemsL, tradersL, hideoutL] = await Promise.all(
      [`items_${lang}`, `traders_${lang}`, `hideout_${lang}`].map((d) => fetchJson(`${GAME_MODE}/${d}`)),
    );
    const tr = (json) => dataOf(json, 'translations');
    const ti = tr(itemsL);
    const tt = tr(tradersL);
    const th = tr(hideoutL);
    const loc = { items: {}, slots: {}, cats: {}, traders: {}, stations: {} };
    for (const id of named) {
      const name = ti[`${id} Name`];
      if (!name) continue;
      const short = ti[`${id} ShortName`];
      loc.items[id] = short && short !== name ? [name, short] : [name];
    }
    for (const n of slotNames) {
      // Numbered slots (mod_mount_001) share their base slot's label.
      const v = ti[n.toUpperCase()] ?? ti[n.replace(/_\d+$/, '').toUpperCase()];
      if (v) loc.slots[n] = v;
    }
    for (const c of cats) if (ti[`${c} Name`]) loc.cats[c] = ti[`${c} Name`];
    for (const t of traderList) loc.traders[t.id] = tt[`${t.id} Nickname`] ?? t.key;
    for (const s of stations) {
      const key = hideout[s]?.name;
      if (key && th[key]) loc.stations[s] = th[key];
    }
    locales[lang] = loc;
  }

  await mkdir(OUT_DIR, { recursive: true });
  const main = JSON.stringify(out);
  await writeFile(resolve(OUT_DIR, 'weapons.json'), main);
  console.log(`weapons.json: ${Object.keys(weapons).length} guns, ${Object.keys(mods).length} mods, ${kb(main.length)}`);
  for (const [lang, loc] of Object.entries(locales)) {
    const body = JSON.stringify(loc);
    await writeFile(resolve(OUT_DIR, `weapons-${lang}.json`), body);
    console.log(`weapons-${lang}.json: ${Object.keys(loc.items).length} names, ${kb(body.length)}`);
  }
}

main().catch((err) => {
  if (err instanceof UpstreamOutage) {
    console.warn(`tarkov.dev unreachable, keeping the committed weapon data: ${err.message}`);
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});
