// Cartridges named on a screenshot (the flea market's ammo list), in the
// game's language or English.
import { detectGameLang } from '../i18n';
import { loadLocale } from '../prices/usePriceScan';
import type { ScreenText } from '../prices/scan';
import { ammoFromScreen, loadAmmoData } from './data';

export async function ammoOnScreen(text: ScreenText): Promise<string[]> {
  const lines = text.lines.map((l) => l.text);
  if (lines.length < 3) return [];
  const game = (await detectGameLang()) ?? 'en';
  const [data, g, en] = await Promise.all([loadAmmoData(), loadLocale(game), loadLocale('en')]);
  const found = ammoFromScreen(lines, data, g.items);
  for (const id of ammoFromScreen(lines, data, en.items)) if (!found.includes(id)) found.push(id);
  return found;
}
