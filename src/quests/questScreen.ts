// The game's Tasks screen (Character → Tasks) read from a screenshot: the
// quests listed there with their status. A fallback for when the logs did not
// say a quest was accepted — the screen lists exactly the quests the player
// has taken, each with "active" (or done / failed) in the status column.
//
// Matching is by the quest's full name, in the game's language and in
// English, after the same OCR folding the price scanner uses; the status is
// the word on the same row (same height on the screen).
import type { ScreenLine, ScreenText } from '../prices/scan';
import { skeleton } from '../prices/scan';

/** Quest names → ids (several ids can share a name: faction or event variants). */
export type QuestNameIndex = Map<string, string[]>;

/** From locale dictionaries ({ "<id> name": "Quest name" }), one per language. */
export function buildQuestNameIndex(...dicts: Record<string, string>[]): QuestNameIndex {
  const out: QuestNameIndex = new Map();
  for (const dict of dicts) {
    for (const [key, name] of Object.entries(dict)) {
      const m = /^([0-9a-f]{24}) name$/.exec(key);
      if (!m || typeof name !== 'string') continue;
      const k = skeleton(name);
      if (k.length < 4) continue;
      const list = out.get(k);
      if (!list) out.set(k, [m[1]]);
      else if (!list.includes(m[1])) list.push(m[1]);
    }
  }
  return out;
}

export type ScreenQuestStatus = 'active' | 'done' | 'failed' | 'unknown';

export interface ScreenQuest {
  ids: string[];
  name: string;
  status: ScreenQuestStatus;
}

// The status column's words, by language (skeleton form). Anything else on
// the row counts as unknown.
const ACTIVE = ['ativa', 'ativo', 'active', 'activa', 'activo', 'aktivno', 'активно', 'активен', 'активный', '進行中', '进行中', '进行中的'].map(skeleton);
const DONE = ['concluida', 'concluido', 'completed', 'complete', 'success', 'completada', 'completado', 'выполнено', 'выполнен', '完了', '已完成', '完成'].map(skeleton);
const FAILED = ['falhou', 'fracassada', 'failed', 'fallida', 'fallido', 'провалено', '失敗', '失败'].map(skeleton);

const middle = (l: ScreenLine) => {
  const ys = l.words.map((w) => w.y + w.h / 2);
  return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
};
const height = (l: ScreenLine) => Math.max(1, ...l.words.map((w) => w.h));

/** The line that continues `line` on its row: starting just after it ends. */
function nextOnRow(lines: ScreenLine[], line: ScreenLine): ScreenLine | null {
  const last = line.words[line.words.length - 1];
  if (!last) return null;
  const end = last.x + last.w;
  const y = middle(line);
  const h = height(line);
  let best: ScreenLine | null = null;
  for (const l of lines) {
    const first = l.words[0];
    if (l === line || !first || Math.abs(middle(l) - y) > h) continue;
    const gap = first.x - end;
    if (gap >= -2 && gap <= 40 && (!best || first.x < best.words[0].x)) best = l;
  }
  return best;
}

function statusOf(row: ScreenLine[]): ScreenQuestStatus {
  for (const l of row) {
    for (const w of l.words.length ? l.words.map((x) => x.text) : [l.text]) {
      const k = skeleton(w);
      if (!k) continue;
      if (ACTIVE.some((a) => k === a || k.startsWith(a))) return 'active';
      if (DONE.some((a) => k === a)) return 'done';
      if (FAILED.some((a) => k === a)) return 'failed';
    }
  }
  return 'unknown';
}

/**
 * The quests on a Tasks-screen screenshot. A line names a quest when it is
 * the quest's name, or starts with it (OCR sometimes runs the next column
 * into the line); the longest name wins ("…Part 1" over "…").
 */
export function questsOnScreen(text: ScreenText, index: QuestNameIndex): ScreenQuest[] {
  const out: ScreenQuest[] = [];
  const seen = new Set<string>();
  const matches = (k: string, name: string) =>
    k === name ||
    (k.startsWith(name) && name.length >= 8) ||
    // One stray character at the end ("Escória…" read as "Escóriam").
    (k.length >= 10 && k.slice(0, -1) === name);
  for (const line of text.lines) {
    // OCR sometimes splits a name in two ("Atenção Médica -" + "Parte 1"):
    // also try it joined with the piece right after it on the same row.
    const next = nextOnRow(text.lines, line);
    const keys = [skeleton(line.text), ...(next ? [skeleton(`${line.text} ${next.text}`)] : [])].filter((k) => k.length >= 4);
    let best: string | null = null;
    for (const k of keys) {
      for (const name of index.keys()) {
        if (matches(k, name) && (!best || name.length > best.length)) best = name;
      }
    }
    if (!best || seen.has(best)) continue;
    seen.add(best);
    const y = middle(line);
    const h = height(line);
    const row = text.lines.filter((l) => l !== line && Math.abs(middle(l) - y) <= h);
    // The status can also be at the end of the same OCR line.
    const tail = line.words.filter((w) => w.x > (line.words[0]?.x ?? 0) + 1);
    const status = statusOf([...row, { text: '', words: tail }]);
    out.push({ ids: index.get(best)!, name: line.text.trim(), status });
  }
  return out;
}

/** Enough named quests to be the Tasks screen, not a stray name somewhere else. */
export const MIN_QUESTS_ON_SCREEN = 3;
