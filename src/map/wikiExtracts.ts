// Screenshots of each extraction, from the map's page on the Escape from
// Tarkov Wiki (Fandom): the "Extractions" table has one row per exit with its
// picture(s). Fetched at runtime (nothing bundled), credited and linked in the
// UI (CC BY-SA), cached a few days like the quest guides.
import { appFetch } from '../api/http';
import { resizeWikiImage, type GuideImage } from '../quests/wikiGuide';
import { SUPPORTED_MAP_NAMES } from './mapDefs';
import { canonicalMapId } from './canonicalMap';

const API = 'https://escapefromtarkov.fandom.com/api.php';
const WIKI = 'https://escapefromtarkov.fandom.com/wiki/';
const CACHE_KEY = 'tc_wiki_extracts_v3';
const CACHE_MS = 3 * 24 * 60 * 60 * 1000;

export interface WikiExtract {
  name: string;
  images: GuideImage[];
  /** The "Requirements" column ("-" or empty: none). */
  requirements?: string;
  /** "Always available": false when it opens only some raids. */
  always?: boolean;
  /** "Single-Use". */
  singleUse?: boolean;
}

/** A cell's text with its line breaks and list items kept apart. */
function cellText(el: Element): string {
  const c = el.cloneNode(true) as Element;
  for (const br of Array.from(c.querySelectorAll('br, li'))) br.before('\n');
  return (c.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}
const yesNo = (s: string): boolean | undefined => (/✔|^yes$/i.test(s) ? true : /✘|^no$/i.test(s) ? false : undefined);

/** The map's wiki page ("Streets_of_Tarkov"), or null for a map without one. */
export function wikiMapPage(mapId: string): string | null {
  const name = SUPPORTED_MAP_NAMES[canonicalMapId(mapId)];
  return name ? name.replace(/ /g, '_') : null;
}

export function wikiMapUrl(mapId: string, section = 'Extractions'): string | null {
  const page = wikiMapPage(mapId);
  return page ? `${WIKI}${page}#${section}` : null;
}

/** The rows of the "Extractions" table (name + pictures) from a parsed map page. Pure, for tests. */
export function extractsFromHtml(html: string): WikiExtract[] {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.getElementById('root');
  if (!root) return [];
  // The first table after the "Extractions" heading.
  let table: Element | null = null;
  let inSection = false;
  for (const el of Array.from(root.querySelectorAll('h2, table'))) {
    if (el.tagName === 'H2') {
      const id = el.querySelector('.mw-headline')?.id ?? el.id ?? '';
      inSection = /^extractions?$/i.test(id) || /^extractions?$/i.test((el.textContent ?? '').trim());
      continue;
    }
    if (inSection) {
      table = el;
      break;
    }
  }
  if (!table) return [];
  const out: WikiExtract[] = [];
  // Which column is which, from the header row (the wiki may reorder them).
  const head = Array.from(table.querySelectorAll('tr')).find((tr) => tr.querySelector('th'));
  const cols = head ? Array.from(head.children).map((c) => (c.textContent ?? '').trim().toLowerCase()) : [];
  const col = (re: RegExp) => cols.findIndex((c) => re.test(c));
  const reqCol = col(/^requirement/);
  const alwaysCol = col(/^always/);
  const singleCol = col(/^single/);
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    const cells = Array.from(tr.children);
    if (cells.length < 2) continue;
    // First line only: some names carry a note below ("Note: this extraction does not work").
    const name = (cells[1].textContent ?? '').trim().split(/\r?\n/)[0].trim();
    if (!name || /^name$/i.test(name)) continue;
    const images: GuideImage[] = [];
    for (const img of Array.from(tr.querySelectorAll('img'))) {
      const src = img.getAttribute('data-src') || img.getAttribute('src') || '';
      if (!/^https:\/\/static\.wikia\.nocookie\.net\//.test(src)) continue;
      const width = Number(img.getAttribute('width') || '0');
      if (width > 0 && width < 100) continue; // icons
      const full = resizeWikiImage(src, 0);
      if (images.some((i) => i.full === full)) continue;
      images.push({ full, thumb: resizeWikiImage(src, 480), caption: name });
    }
    const at = (i: number) => (i >= 0 && cells[i] ? cellText(cells[i]) : '');
    out.push({
      name,
      images,
      ...(reqCol >= 0 ? { requirements: at(reqCol) } : {}),
      ...(alwaysCol >= 0 && yesNo(at(alwaysCol)) !== undefined ? { always: yesNo(at(alwaysCol)) } : {}),
      ...(singleCol >= 0 && yesNo(at(singleCol)) !== undefined ? { singleUse: yesNo(at(singleCol)) } : {}),
    });
  }
  return out;
}

/** "Smugglers' Boat (Co-op)" → "smugglers boat". */
export function extractKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The wiki row for an exit, by any of its names (English first): exact, then contained, then most words in common. */
export function findWikiExtract(rows: WikiExtract[], names: string[]): WikiExtract | null {
  const keys = names.map(extractKey).filter(Boolean);
  if (keys.length === 0) return null;
  const rowKeys = rows.map((r) => ({ r, k: extractKey(r.name) }));
  for (const k of keys) {
    const hit = rowKeys.find((x) => x.k === k);
    if (hit) return hit.r;
  }
  for (const k of keys) {
    const hit = rowKeys.find((x) => x.k.length >= 4 && k.length >= 4 && (x.k.includes(k) || k.includes(x.k)));
    if (hit) return hit.r;
  }
  let best: { r: WikiExtract; score: number } | null = null;
  for (const k of keys) {
    const a = new Set(k.split(' '));
    for (const x of rowKeys) {
      const b = new Set(x.k.split(' '));
      const common = [...a].filter((w) => b.has(w)).length;
      const score = common / Math.max(a.size, b.size);
      if (score >= 0.6 && (!best || score > best.score)) best = { r: x.r, score };
    }
  }
  return best?.r ?? null;
}

type Cache = Record<string, { at: number; rows: WikiExtract[] }>;
function readCache(): Cache {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Cache;
  } catch {
    return {};
  }
}
function writeCache(c: Cache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* storage full or unavailable */
  }
}

const inflight = new Map<string, Promise<WikiExtract[]>>();

/** The map's extraction table from the wiki (cached a few days). */
export function fetchWikiExtracts(mapId: string): Promise<WikiExtract[]> {
  const page = wikiMapPage(mapId);
  if (!page) return Promise.resolve([]);
  const cached = readCache()[page];
  if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.rows);
  const running = inflight.get(page);
  if (running) return running;
  const url = `${API}?action=parse&page=${encodeURIComponent(page)}&prop=text&format=json&formatversion=2&redirects=1&origin=*`;
  const p = (async () => {
    const res = await appFetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`wiki HTTP ${res.status}`);
    const body = (await res.json()) as { parse?: { text?: string } };
    const rows = extractsFromHtml(body.parse?.text ?? '');
    const c = readCache();
    c[page] = { at: Date.now(), rows };
    writeCache(c);
    return rows;
  })().finally(() => inflight.delete(page));
  inflight.set(page, p);
  return p;
}
