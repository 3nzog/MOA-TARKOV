// Item names in the app's language, for the loot route's stops: the bundled
// planner names (data/snapshot/progression-<lang>.json), which cover every
// item that spawns loose. Loaded lazily, once per language.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const files = import.meta.glob<{ default: { items?: Record<string, [string, string?]> } }>('../../data/snapshot/progression-*.json');
const cache = new Map<string, Promise<Record<string, string>>>();

/** Short names by item id ("GPU", "Bolts"…), in `lang` (English when missing). */
export function loadItemNames(lang: string): Promise<Record<string, string>> {
  let p = cache.get(lang);
  if (!p) {
    const key =
      Object.keys(files).find((k) => k.endsWith(`progression-${lang}.json`)) ??
      Object.keys(files).find((k) => k.endsWith('progression-en.json'));
    p = key
      ? files[key]()
          .then((m) => Object.fromEntries(Object.entries(m.default.items ?? {}).map(([id, v]) => [id, Array.isArray(v) ? v[1] || v[0] : String(v)])))
          .catch(() => ({}))
      : Promise.resolve({});
    cache.set(lang, p);
  }
  return p;
}

/** The names, once loaded (empty until then); only loads when `enabled`. */
export function useItemNames(enabled: boolean): Record<string, string> {
  const { i18n } = useTranslation();
  const lang = i18n.language.slice(0, 2);
  const [names, setNames] = useState<{ lang: string; names: Record<string, string> } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadItemNames(lang).then((n) => {
      if (alive) setNames({ lang, names: n });
    });
    return () => {
      alive = false;
    };
  }, [enabled, lang]);
  return names?.lang === lang ? names.names : {};
}
