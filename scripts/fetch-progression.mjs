// Fetches the progression + economy datasets from tarkov.dev and writes them to
// data/snapshot next to the quest snapshot:
//
//   progression.json          language-independent: quest prerequisites, level
//                             and faction gates, the items/keys each objective
//                             needs, hideout station levels and crafts
//   progression-<lang>.json   item / quest-item / station / trader names
//   prices.json               flea and trader prices for every item — an
//                             ESTIMATE frozen at generatedAt, never live
//
// Why a separate script from fetch-snapshot.mjs: the quest snapshot is the one
// file the app cannot start without, and this one is a nice-to-have. A failure
// here must never put that file at risk, so it runs on its own and keeps the
// committed copy of anything it could not refresh.
//
// Same outage-vs-defect contract as fetch-snapshot.mjs: an unreachable upstream
// exits 0 and leaves the committed files untouched; a malformed payload exits 1.

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

function expectObject(node, path, what) {
  let cur = node;
  for (const key of path) {
    if (typeof cur !== 'object' || cur === null) throw new Error(`unexpected shape for ${what}`);
    cur = cur[key];
  }
  if (typeof cur !== 'object' || cur === null) throw new Error(`unexpected shape for ${what}`);
  return cur;
}

const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

// Drop undefined / empty values so the committed file stays small and diffs
// stay readable.
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out;
}

// ---- tasks -----------------------------------------------------------------
// Only what progression needs; names and positions already live in base.json.
function pruneObjective(o) {
  const items = [...new Set([...arr(o.items), ...arr(o.useAny), ...(o.item ? [o.item] : [])])];
  return compact({
    type: o.type,
    count: num(o.count),
    items,
    fir: o.foundInRaid === true ? true : undefined,
    keys: arr(o.requiredKeys).map((group) => arr(group)).filter((g) => g.length > 0),
    questItem: typeof o.questItem === 'string' ? o.questItem : undefined,
    marker: typeof o.markerItem === 'string' ? o.markerItem : undefined,
    optional: o.optional === true ? true : undefined,
    // taskStatus / traderLevel objectives point at other entities.
    task: typeof o.task === 'string' ? o.task : undefined,
    trader: typeof o.trader === 'string' ? o.trader : undefined,
    level: num(o.level),
  });
}

function pruneTask(t) {
  const objectives = {};
  for (const o of arr(t.objectives)) {
    if (o?.id) objectives[o.id] = pruneObjective(o);
  }
  const faction = t.factionName === 'USEC' || t.factionName === 'BEAR' ? t.factionName : undefined;
  return compact({
    lvl: num(t.minPlayerLevel) || undefined,
    req: arr(t.taskRequirements)
      .filter((r) => typeof r?.task === 'string')
      .map((r) => [r.task, arr(r.status)]),
    trReq: arr(t.traderRequirements)
      .filter((r) => typeof r?.trader === 'string')
      .map((r) => [r.trader, r.requirementType ?? 'level', num(r.value) ?? 0]),
    fac: faction,
    kappa: t.kappaRequired === true,
    lk: t.lightkeeperRequired === true,
    keys: arr(t.neededKeys)
      .map((k) => [typeof k?.map === 'string' ? k.map : null, arr(k?.keys)])
      .filter(([, keys]) => keys.length > 0),
    xp: num(t.experience),
    restartable: t.restartable === true,
    obj: objectives,
  });
}

// ---- hideout -----------------------------------------------------------------
function pruneStation(s) {
  return compact({
    id: s.id,
    name: s.name,
    levels: arr(s.levels)
      .map((l) =>
        compact({
          // Level id: TarkovTracker reports built hideout levels by it.
          id: typeof l.id === 'string' ? l.id : undefined,
          level: num(l.level) ?? 0,
          time: num(l.constructionTime),
          items: arr(l.itemRequirements)
            .filter((r) => typeof r?.item === 'string')
            .map((r) => [r.item, num(r.count) ?? 1, r.attributes?.foundInRaid === true ? 1 : 0]),
          stations: arr(l.stationLevelRequirements)
            .filter((r) => typeof r?.station === 'string')
            .map((r) => [r.station, num(r.level) ?? 1]),
          traders: arr(l.traderRequirements)
            .filter((r) => typeof r?.trader === 'string')
            .map((r) => [r.trader, num(r.value ?? r.level) ?? 1]),
          skills: arr(l.skillRequirements)
            .filter((r) => typeof r?.skill === 'string')
            .map((r) => [r.skill, num(r.level) ?? 1]),
        }),
      )
      .sort((a, b) => a.level - b.level),
  });
}

function pruneCraft(c) {
  if (!c?.productItem?.item || typeof c.station !== 'string') return null;
  return compact({
    id: c.id,
    station: c.station,
    level: num(c.level) ?? 1,
    duration: num(c.duration) ?? 0,
    in: arr(c.requiredItems)
      .filter((r) => typeof r?.item === 'string')
      .map((r) => [r.item, num(r.count) ?? 1, r.attributes?.tool === true ? 1 : 0]),
    out: [c.productItem.item, num(c.productItem.count) ?? 1],
  });
}

// ---- prices --------------------------------------------------------------------
function prunePrice(item) {
  const sells = arr(item.sellToTrader).filter((s) => typeof s?.trader === 'string' && num(s.priceRUB));
  const bestSell = sells.reduce((best, s) => (!best || s.priceRUB > best.priceRUB ? s : best), null);
  const buys = arr(item.buyFromTrader).filter((s) => typeof s?.trader === 'string' && num(s.priceRUB));
  const cheapestBuy = buys.reduce((best, s) => (!best || s.priceRUB < best.priceRUB ? s : best), null);
  return compact({
    b: num(item.basePrice),
    a: num(item.avg24hPrice) || undefined,
    l: num(item.lastLowPrice) || undefined,
    st: bestSell?.trader,
    sp: bestSell ? Math.round(bestSell.priceRUB) : undefined,
    bt: cheapestBuy?.trader,
    bp: cheapestBuy ? Math.round(cheapestBuy.priceRUB) : undefined,
    bl: num(cheapestBuy?.minTraderLevel),
    w: num(item.width),
    h: num(item.height),
    fl: num(item.minLevelForFlea),
    nf: arr(item.types).includes('noFlea') ? true : undefined,
  });
}

// ---- run ---------------------------------------------------------------------
const generatedAt = new Date().toISOString();
await mkdir(OUT_DIR, { recursive: true });
let outages = 0;
let defects = 0;

function classify(what, err) {
  if (err instanceof UpstreamOutage) {
    outages += 1;
    console.log(`::warning::${what}: tarkov.dev unreachable — ${err.message}`);
  } else {
    defects += 1;
    console.error(`::error::${what}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function writeJson(name, data) {
  const json = JSON.stringify(data);
  await writeFile(resolve(OUT_DIR, name), json + '\n', 'utf8');
  console.log(`${name}: ${kb(Buffer.byteLength(json))}`);
}

const baseJobs = ['tasks', 'hideout', 'crafts', 'items', 'traders'];
const baseResults = await Promise.allSettled(baseJobs.map((d) => fetchJson(`${GAME_MODE}/${d}`)));
const docs = {};
baseResults.forEach((r, i) => {
  if (r.status === 'fulfilled') docs[baseJobs[i]] = r.value;
  else classify(baseJobs[i], r.reason);
});

let itemsData = null;
let questItemsData = {};

if (docs.tasks && docs.hideout && docs.crafts && docs.items) {
  try {
    const tasks = expectObject(docs.tasks, ['data', 'tasks'], 'tasks');
    questItemsData = docs.tasks?.data?.questItems ?? {};
    // hideout and crafts sit directly under `data`, keyed by id / index.
    const hideout = expectObject(docs.hideout, ['data'], 'hideout');
    const crafts = expectObject(docs.crafts, ['data'], 'crafts');
    itemsData = expectObject(docs.items, ['data', 'items'], 'items');
    if (Object.keys(tasks).length === 0) throw new Error('refusing to write an empty task list');

    const progression = {
      generatedAt,
      gameMode: GAME_MODE,
      tasks: Object.fromEntries(Object.entries(tasks).map(([id, t]) => [id, pruneTask(t)])),
      hideout: Object.values(hideout).filter((s) => s?.id).map(pruneStation),
      crafts: Object.values(crafts).map(pruneCraft).filter(Boolean),
    };
    await writeJson('progression.json', progression);

    const prices = { generatedAt, gameMode: GAME_MODE, items: {} };
    for (const [id, item] of Object.entries(itemsData)) prices.items[id] = prunePrice(item);
    await writeJson('prices.json', prices);
  } catch (err) {
    classify('progression', err);
    itemsData = null;
  }
}

// ---- names per language ------------------------------------------------------
if (itemsData && docs.hideout && docs.traders) {
  const traders = docs.traders.data ?? {};
  const stations = Object.values(docs.hideout.data ?? {});
  for (const lang of LANGS) {
    try {
      const [itemsLoc, tasksLoc, hideoutLoc, tradersLoc] = await Promise.all(
        ['items', 'tasks', 'hideout', 'traders'].map((d) => fetchJson(`${GAME_MODE}/${d}_${lang}`)),
      );
      const il = expectObject(itemsLoc, ['data'], `items_${lang}`);
      const tl = expectObject(tasksLoc, ['data'], `tasks_${lang}`);
      const hl = expectObject(hideoutLoc, ['data'], `hideout_${lang}`);
      const trl = expectObject(tradersLoc, ['data'], `traders_${lang}`);
      const locale = { items: {}, questItems: {}, stations: {}, traders: {} };
      for (const [id, item] of Object.entries(itemsData)) {
        const name = il[item.name];
        if (!name) continue;
        const short = il[item.shortName];
        locale.items[id] = short && short !== name ? [name, short] : [name];
      }
      for (const [id, qi] of Object.entries(questItemsData)) {
        const name = tl[qi?.name];
        if (name) locale.questItems[id] = name;
      }
      for (const s of stations) {
        const name = hl[s.name];
        if (name) locale.stations[s.id] = name;
      }
      for (const [id, t] of Object.entries(traders)) {
        const name = trl[t?.name];
        if (name) locale.traders[id] = name;
      }
      await writeJson(`progression-${lang}.json`, locale);
    } catch (err) {
      classify(`progression-${lang}`, err);
    }
  }
}

if (defects > 0) {
  console.error(`${defects} failure(s) for a reason that is not an upstream outage`);
  process.exitCode = 1;
} else if (outages > 0) {
  console.log('::warning::tarkov.dev partly unreachable — committed copies kept where not refreshed');
}
