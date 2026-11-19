// Cartridges named on a screenshot, in the game's language or English: by the
// full name (the flea market's ammo list) and, when `shorts` is on (the ammo
// page), by the short name on the cartridge's picture (stash, inventory).
import { detectGameLang } from '../i18n';
import { loadLocale } from '../prices/usePriceScan';
import type { ScreenText } from '../prices/scan';
import { ammoFromScreen, ammoShortsFromScreen, loadAmmoData } from './data';

export async function ammoOnScreen(text: ScreenText, shorts = false): Promise<string[]> {
  const lines = text.lines.map((l) => l.text);
  if (lines.length < (shorts ? 1 : 3)) return [];
  const game = (await detectGameLang()) ?? 'en';
  const [data, g, en] = await Promise.all([loadAmmoData(), loadLocale(game), loadLocale('en')]);
  const found = ammoFromScreen(lines, data, g.items);
  for (const id of ammoFromScreen(lines, data, en.items)) if (!found.includes(id)) found.push(id);
  if (shorts) found.push(...ammoShortsFromScreen(lines, data, [g.items, en.items], found));
  return found;
}
