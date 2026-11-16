// The player's level, read from a screenshot. The game writes it nowhere a
// passive reader can see (not in the logs), but two screens show it:
//  - the main menu's season / profile card: "Nickname | 12";
//  - the flea market, small, under ADD OFFER: "Nível atual: 12".
// Only those count: other numbers on a screen ("available at level 15") are
// not the player's level.
import type { ScreenText } from './scan';

const PATTERNS: RegExp[] = [
  /n[ií]vel\s+atual\s*[:.]?\s*(\d{1,2})\b/i, // pt
  /current\s+level\s*[:.]?\s*(\d{1,2})\b/i, // en
  /nivel\s+actual\s*[:.]?\s*(\d{1,2})\b/i, // es
  /текущий\s+уровень\s*[:.]?\s*(\d{1,2})\b/i, // ru
  /現在のレベル\s*[:：]?\s*(\d{1,2})/, // ja
  /当前等级\s*[:：]?\s*(\d{1,2})/, // zh
];

// The profile card's "Nickname | 12", only on a menu screen that says which
// mode it is (season / PvP / PvE), so a stray "x | 3" elsewhere does not count.
const CARD = /^[^\s|]{3,24}\s*[|Il]\s*(\d{1,2})$/;
const MENU_WORDS = /temporada|season|сезон|シーズン|赛季|\bpvp\b|\bpve\b/i;

/** The level shown on this screenshot, or null. */
export function levelFromScreen(text: ScreenText | null | undefined): number | null {
  if (!text) return null;
  const all = [...text.lines.map((l) => l.text), ...(text.levelLines ?? [])];
  if (all.some((s) => MENU_WORDS.test(s))) {
    for (const raw of text.lines.map((l) => l.text.trim())) {
      const m = CARD.exec(raw);
      if (!m) continue;
      const n = Number(m[1]);
      if (Number.isInteger(n) && n >= 1 && n <= 79) return n;
    }
  }
  for (const line of all) {
    // OCR sometimes reads "1" as "l" or "I" and "0" as "O" inside the number.
    const s = line.replace(/(?<=[:\s])([lI|O\d]{1,2})\b/g, (m) => m.replace(/[lI|]/g, '1').replace(/O/g, '0'));
    for (const re of PATTERNS) {
      const m = re.exec(s);
      if (!m) continue;
      const n = Number(m[1]);
      if (Number.isInteger(n) && n >= 1 && n <= 79) return n;
    }
  }
  return null;
}
