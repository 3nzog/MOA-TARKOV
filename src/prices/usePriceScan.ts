// Data for the price check and the hook that listens for screenshot text.
import { useEffect, useRef, useState } from 'react';
import { subscribeScreenText } from '../services/tauriEvents';
import { detectGameLang } from '../i18n';
import { buildIndex, scanScreen, type ItemIndex, type ItemNames, type ScanResult, type ScreenText } from './scan';

/** prices.json per item: a = flea 24h average, l = lowest, st/sp = best trader to sell to and its price. */
export interface Price {
  a?: number;
  l?: number;
  st?: string;
  sp?: number;
}
export interface Locale {
  items: ItemNames;
  traders: Record<string, string>;
}

const localeModules = import.meta.glob<{ default: Locale }>('../../data/snapshot/progression-*.json');
export async function loadLocale(lang: string): Promise<Locale> {
  const key =
    Object.keys(localeModules).find((k) => k.endsWith(`progression-${lang}.json`)) ??
    Object.keys(localeModules).find((k) => k.endsWith('progression-en.json'))!;
  return (await localeModules[key]()).default;
}

let indexPromise: Promise<ItemIndex> | null = null;
function loadIndex(): Promise<ItemIndex> {
  indexPromise ??= (async () => {
    const game = (await detectGameLang()) ?? 'en';
    const [g, en] = await Promise.all([loadLocale(game), loadLocale('en')]);
    return buildIndex(g.items, en.items);
  })();
  return indexPromise;
}

let pricesPromise: Promise<Record<string, Price>> | null = null;
export function loadPrices(): Promise<Record<string, Price>> {
  pricesPromise ??= import('../../data/snapshot/prices.json').then(
    (m) => (m as unknown as { default: { items: Record<string, Price> } }).default.items,
  );
  return pricesPromise;
}

/** Best of flea average and trader sale, per item. */
export const best = (p: Price | undefined) => Math.max(p?.a ?? 0, p?.sp ?? 0);

/**
 * Listens for screenshot text and keeps the last price result. `skipUntil`
 * (ms) lets an O+O screenshot, already read as an extract list, pass silently.
 */
export function usePriceScan(skipUntil: () => number, onFound?: () => void) {
  const [result, setResult] = useState<ScanResult>(null);
  const skipRef = useRef(skipUntil);
  const foundRef = useRef(onFound);
  useEffect(() => {
    skipRef.current = skipUntil;
    foundRef.current = onFound;
  }, [skipUntil, onFound]);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let alive = true;
    void subscribeScreenText(async (text) => {
      if (Date.now() < skipRef.current()) return;
      const [index, prices] = await Promise.all([loadIndex(), loadPrices()]);
      const r = scanScreen(text, index, (id) => best(prices[id]) > 0);
      if (alive && r) {
        foundRef.current?.();
        setResult(r);
      }
    })
      .then((u) => {
        if (alive) unlisten = u;
        else u();
      })
      .catch(() => {
        /* outside Tauri */
      });
    // In development a page can feed a screen by hand
    // (window.dispatchEvent(new CustomEvent('price-demo', { detail }))) to check it in a browser.
    const onDemo = async (e: Event) => {
      const [index, prices] = await Promise.all([loadIndex(), loadPrices()]);
      const r = scanScreen((e as CustomEvent<ScreenText>).detail, index, (id) => best(prices[id]) > 0);
      if (alive) setResult(r);
    };
    if (import.meta.env.DEV) window.addEventListener('price-demo', onDemo);
    return () => {
      alive = false;
      unlisten?.();
      if (import.meta.env.DEV) window.removeEventListener('price-demo', onDemo);
    };
  }, []);
  return { result, clear: () => setResult(null) };
}

