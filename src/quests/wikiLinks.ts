// Task id -> its Escape from Tarkov Wiki page (data/snapshot/wiki-links.json,
// written by scripts/fetch-snapshot.mjs and bundled with the app). Loaded once,
// when the quest panel first needs it.
import { useEffect, useState } from 'react';

const WIKI = 'https://escapefromtarkov.fandom.com/wiki/';
let cache: Promise<Record<string, string>> | null = null;

function load(): Promise<Record<string, string>> {
  cache ??= import('../../data/snapshot/wiki-links.json')
    .then((m) => (m as { default: Record<string, string> }).default ?? {})
    .catch(() => ({}));
  return cache;
}

/** id -> full wiki URL, for every quest that has a page ({} until loaded). */
export function useWikiLinks(): Record<string, string> {
  const [links, setLinks] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    void load().then((pages) => {
      if (!alive) return;
      setLinks(Object.fromEntries(Object.entries(pages).map(([id, page]) => [id, WIKI + page])));
    });
    return () => {
      alive = false;
    };
  }, []);
  return links;
}
