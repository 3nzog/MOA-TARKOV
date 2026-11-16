// Screenshots of where a quest's objectives are, from the quest's page on the
// Escape from Tarkov Wiki (Fandom): the pictures in its "Guide" section, with
// the wiki's own captions. Fetched at runtime (nothing is bundled), credited
// and linked in the UI (CC BY-SA). Icons (keys, items) are left out.
import { appFetch } from '../api/http';

export interface GuideImage {
  /** Full-size picture. */
  full: string;
  /** Smaller copy for the strip. */
  thumb: string;
  caption: string;
}

const API = 'https://escapefromtarkov.fandom.com/api.php';
const CACHE_KEY = 'tc_wiki_guide_v1';
const CACHE_MS = 3 * 24 * 60 * 60 * 1000;

/** "https://escapefromtarkov.fandom.com/wiki/Saving_the_Mole" → "Saving_the_Mole". */
export function wikiPageOf(link: string | undefined | null): string | null {
  if (!link) return null;
  const m = /^https:\/\/escapefromtarkov\.fandom\.com\/wiki\/([^?#]+)$/.exec(link.trim());
  return m ? decodeURIComponent(m[1]) : null;
}

/** Fandom image URL at a given width (or full size with width 0). */
export function resizeWikiImage(url: string, width: number): string {
  const base = url.replace(/\/scale-to-width-down\/\d+/, '');
  if (!width) return base;
  return base.replace(/\/revision\/latest/, `/revision/latest/scale-to-width-down/${width}`);
}

/**
 * The Guide section's pictures from a parsed wiki page (HTML). Pure, for tests.
 * Icons (alt ending in "icon", or narrower than 120 px) are not locations.
 */
export function guideImagesFromHtml(html: string): GuideImage[] {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.getElementById('root');
  if (!root) return [];
  // Walk the page in order: start collecting at the "Guide" heading, stop at the next h2.
  const all = Array.from(root.querySelectorAll('h2, img'));
  const out: GuideImage[] = [];
  const seen = new Set<string>();
  let inGuide = false;
  for (const el of all) {
    if (el.tagName === 'H2') {
      const id = el.querySelector('.mw-headline')?.id ?? el.id ?? '';
      inGuide = /^guide$/i.test(id) || /^guide$/i.test((el.textContent ?? '').trim());
      continue;
    }
    if (!inGuide) continue;
    const img = el as HTMLImageElement;
    const src = img.getAttribute('data-src') || img.getAttribute('src') || '';
    if (!/^https:\/\/static\.wikia\.nocookie\.net\//.test(src)) continue;
    const alt = (img.getAttribute('alt') || '').trim();
    const width = Number(img.getAttribute('width') || '0');
    if (/\bicon$/i.test(alt) || /icon\.(png|jpe?g|webp|gif)/i.test(src) || (width > 0 && width < 120)) continue;
    const full = resizeWikiImage(src, 0);
    if (seen.has(full)) continue;
    seen.add(full);
    const figCaption = img.closest('figure')?.querySelector('figcaption')?.textContent?.trim();
    out.push({ full, thumb: resizeWikiImage(src, 360), caption: figCaption || (alt === 'frameless' ? '' : alt) });
  }
  return out;
}

type Cache = Record<string, { at: number; images: GuideImage[] }>;

function readCache(): Cache {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Cache;
  } catch {
    return {};
  }
}

function writeCache(c: Cache): void {
  try {
    // Keep the 60 most recent pages.
    const entries = Object.entries(c).sort((a, b) => b[1].at - a[1].at).slice(0, 60);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* storage full or unavailable */
  }
}

const inflight = new Map<string, Promise<GuideImage[]>>();

/** The Guide pictures of a quest's wiki page (cached a few days). */
export function fetchGuideImages(wikiLink: string): Promise<GuideImage[]> {
  const page = wikiPageOf(wikiLink);
  if (!page) return Promise.resolve([]);
  const cached = readCache()[page];
  if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.images);
  const running = inflight.get(page);
  if (running) return running;
  const url = `${API}?action=parse&page=${encodeURIComponent(page)}&prop=text&format=json&formatversion=2&redirects=1&origin=*`;
  const p = (async () => {
    const res = await appFetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`wiki HTTP ${res.status}`);
    const body = (await res.json()) as { parse?: { text?: string } };
    const images = guideImagesFromHtml(body.parse?.text ?? '');
    const c = readCache();
    c[page] = { at: Date.now(), images };
    writeCache(c);
    return images;
  })().finally(() => inflight.delete(page));
  inflight.set(page, p);
  return p;
}
