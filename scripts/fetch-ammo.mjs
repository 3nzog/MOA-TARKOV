// Fetches what the ballistics tab needs from tarkov.dev's JSON dump and writes
// it to data/snapshot/ammo.json:
//
//   ammo     every cartridge: caliber, damage, penetration, armor damage,
//            fragmentation, speed, tracer, pellets, bleed, accuracy and recoil
//   weapons  every gun's caliber and the cartridges it accepts
//
// Names come from data/snapshot/progression-<lang>.json (already bundled);
// prices from prices.json. Same outage-vs-defect contract as the other
// fetchers: an unreachable upstream exits 0 and keeps the committed file; a
// malformed payload exits 1.
//
//   node scripts/fetch-ammo.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.SNAPSHOT_BASE_URL ?? 'https://json.tarkov.dev';
const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'snapshot');

class UpstreamOutage extends Error {}

async function fetchJson(path) {
  let res;
  try {
    res = await fetch(`${BASE_URL}/${path}`);
  } catch (err) {
    throw new UpstreamOutage(err.message);
  }
  const raw = await res.text();
  if (!res.ok) {
    const detail = `HTTP ${res.status} — ${raw.slice(0, 200)}`;
    throw [408, 429, 500, 502, 503, 504].includes(res.status) ? new UpstreamOutage(detail) : new Error(detail);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new UpstreamOutage(`non-JSON body — ${raw.slice(0, 200)}`);
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const r = (v, d = 3) => (v === undefined ? undefined : Math.round(v * 10 ** d) / 10 ** d);

function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== false && v !== 0) out[k] = v;
  return out;
}

async function main() {
  const json = await fetchJson('regular/items');
  const items = json?.data?.items;
  if (!items || typeof items !== 'object') throw new Error('unexpected shape for items');
  const list = Array.isArray(items) ? items : Object.values(items);

  const ammo = {};
  const weapons = {};
  for (const it of list) {
    const p = it?.properties;
    if (!p || typeof it.id !== 'string') continue;
    if (p.propertiesType === 'ItemPropertiesAmmo' && typeof p.caliber === 'string') {
      ammo[it.id] = compact({
        c: p.caliber,
        d: num(p.damage),
        p: num(p.penetrationPower),
        a: num(p.armorDamage),
        f: r(num(p.fragmentationChance)),
        v: num(p.initialSpeed),
        n: num(p.projectileCount) !== 1 ? num(p.projectileCount) : undefined,
        t: p.tracer === true,
        lb: r(num(p.lightBleedModifier)),
        hb: r(num(p.heavyBleedModifier)),
        acc: r(num(p.accuracyModifier)),
        rec: r(num(p.recoilModifier)),
        g: (it.types ?? []).includes('grenade') || p.ammoType === 'grenade' ? true : undefined,
      });
    } else if (p.propertiesType === 'ItemPropertiesWeapon' && Array.isArray(p.allowedAmmo) && p.allowedAmmo.length) {
      weapons[it.id] = { c: typeof p.caliber === 'string' ? p.caliber : '', ammo: p.allowedAmmo.filter((a) => typeof a === 'string') };
    }
  }
  const nAmmo = Object.keys(ammo).length;
  const nWeapons = Object.keys(weapons).length;
  if (nAmmo < 50 || nWeapons < 50) throw new Error(`too few: ${nAmmo} ammo, ${nWeapons} weapons`);
  // Weapons keep only cartridges we have stats for.
  for (const w of Object.values(weapons)) w.ammo = w.ammo.filter((a) => ammo[a]);

  await mkdir(OUT_DIR, { recursive: true });
  const out = JSON.stringify({ generatedAt: new Date().toISOString(), ammo, weapons });
  await writeFile(resolve(OUT_DIR, 'ammo.json'), out + '\n', 'utf8');
  console.log(`ammo.json: ${nAmmo} cartridges, ${nWeapons} weapons (${(Buffer.byteLength(out) / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  if (err instanceof UpstreamOutage) {
    console.log(`::warning::tarkov.dev unreachable (${err.message}) — keeping the committed ammo.json`);
    process.exit(0);
  }
  console.error(`::error::${err.stack ?? err.message}`);
  process.exit(1);
});
