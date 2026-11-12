// Place names for the maps ("Big Red", "Dorms", "Scav Town"…) from tarkov.dev's
// map data (the-hideout/tarkov-dev, MIT), written to data/snapshot/map-labels.json
// keyed by the app's map id. Shown on the main map only.
//
// Same contract as the other snapshot scripts: unreachable upstream → exit 0
// and keep the committed file; malformed payload → exit 1.
//
//   node scripts/fetch-map-labels.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_ = 'https://raw.githubusercontent.com/the-hideout/tarkov-dev/master/src/data/maps.json';
const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'snapshot');

async function main() {
  let res;
  try {
    res = await fetch(URL_);
  } catch (err) {
    console.warn(`tarkov-dev map data unreachable, keeping the committed labels: ${err.message}`);
    return;
  }
  if (!res.ok) {
    console.warn(`tarkov-dev map data HTTP ${res.status}, keeping the committed labels`);
    return;
  }
  const groups = await res.json();
  if (!Array.isArray(groups)) throw new Error('unexpected shape for maps.json');

  // normalizedName → map id, from the quest snapshot the app already ships.
  const base = JSON.parse(await readFile(resolve(OUT_DIR, 'base.json'), 'utf8'));
  const ids = {};
  for (const m of Object.values(base.maps ?? {})) if (m?.normalizedName && m?.id) ids[m.normalizedName] = m.id;

  const out = {};
  let total = 0;
  for (const g of groups) {
    const id = ids[g.normalizedName];
    const map = (g.maps ?? []).find((m) => m.projection === 'interactive');
    if (!id || !map || !Array.isArray(map.labels) || map.labels.length === 0) continue;
    out[id] = map.labels
      .filter((l) => typeof l.text === 'string' && Array.isArray(l.position) && l.position.length >= 2)
      .map((l) => {
        const o = { t: l.text, x: l.position[0], z: l.position[1] };
        if (typeof l.rotation === 'number' && l.rotation) o.r = l.rotation;
        if (typeof l.size === 'number') o.s = l.size;
        if (typeof l.top === 'number') o.top = l.top;
        if (typeof l.bottom === 'number') o.bottom = l.bottom;
        return o;
      });
    total += out[id].length;
  }
  if (total < 50) throw new Error(`suspiciously few labels: ${total}`);
  await writeFile(resolve(OUT_DIR, 'map-labels.json'), JSON.stringify(out));
  console.log(`map-labels.json: ${total} labels on ${Object.keys(out).length} maps`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
