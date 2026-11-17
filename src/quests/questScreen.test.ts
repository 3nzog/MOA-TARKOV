import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ScreenLine, ScreenText } from '../prices/scan';
import { buildQuestNameIndex, questsOnScreen } from './questScreen';

const tasksOf = (lang: string) =>
  (JSON.parse(readFileSync(`data/snapshot/locale-${lang}.json`, 'utf8')) as { tasks: Record<string, string> }).tasks;
const index = buildQuestNameIndex(tasksOf('pt'), tasksOf('en'));

/** One OCR line: its words laid out left to right at height y. */
function line(text: string, x: number, y: number): ScreenLine {
  let at = x;
  const words = text.split(' ').map((w) => {
    const word = { text: w, x: at, y, w: w.length * 12, h: 22 };
    at += w.length * 12 + 8;
    return word;
  });
  return { text, words };
}

// Rows like the game's Tasks screen (1920×1080, Portuguese): name, location, status, progress.
function row(name: string, where: string, status: string, y: number): ScreenLine[] {
  return [line(name, 271, y), line(where, 790, y), line(status, 967, y), line('0%', 1148, y - 12)];
}
const screen = (rows: ScreenLine[][]): ScreenText => ({
  width: 1920,
  height: 1080,
  lines: [line('Comerciante Tipo Classe', 43, 112), line('Missão', 498, 112), line('Situação', 952, 112), ...rows.flat()],
});

describe('questsOnScreen', () => {
  it('reads the quests and their status from the Tasks screen', () => {
    const found = questsOnScreen(
      screen([
        row('Sangue na Água', 'Customs', 'ativa', 180),
        row('Farmacêutico', 'Customs', 'ativa', 283),
        row('Carga Abandonada', 'Customs', 'ativa', 386),
        row('Longa fila', 'Interchange', 'ativa', 489),
        row('Vestido para Matar', 'Qualquer local', 'concluída', 592),
      ]),
      index,
    );
    expect(found.map((f) => f.name)).toEqual(['Sangue na Água', 'Farmacêutico', 'Carga Abandonada', 'Longa fila', 'Vestido para Matar']);
    expect(found.slice(0, 4).every((f) => f.status === 'active')).toBe(true);
    expect(found[4].status).toBe('done');
    expect(found.every((f) => f.ids.length > 0)).toBe(true);
  });

  it('tells Part 1 from Part 2 and tolerates OCR look-alikes', () => {
    const found = questsOnScreen(
      screen([
        row('Atenção Médica - Parte 1', 'Qualquer local', 'ativa', 260),
        row('Atenção Médica - Parte 2', 'Qualquer local', 'ativa', 363),
        row('Sangue na Agua', 'Customs', 'atival', 466),
      ]),
      index,
    );
    expect(found).toHaveLength(3);
    expect(found[0].ids).not.toEqual(found[1].ids);
    expect(found[2].status).toBe('active');
  });

  it('ignores menus and headers', () => {
    const found = questsOnScreen(screen([[line('MENU PRINCIPAL ESCONDERIJO PERSONAGEM', 20, 1060)]]), index);
    expect(found).toEqual([]);
  });

  it('reads English names too', () => {
    const en = Object.entries(tasksOf('en')).find(([k, v]) => k.endsWith(' name') && v.length > 10)!;
    const found = questsOnScreen(screen([row(en[1], 'Customs', 'active', 300)]), index);
    expect(found[0]?.ids).toContain(en[0].split(' ')[0]);
    expect(found[0]?.status).toBe('active');
  });
});

describe('real Tasks-screen screenshots (Portuguese, 1080p, Windows OCR)', () => {
  const shots = [0, 1, 2, 3, 4].map(
    (i) => JSON.parse(readFileSync(`src/quests/__fixtures__/tasks-pt-1080p-${i}.json`, 'utf8')) as ScreenText,
  );

  it('finds the listed quests on every screenshot, all active', () => {
    for (const shot of shots) {
      const found = questsOnScreen(shot, index);
      expect(found.length).toBeGreaterThanOrEqual(6);
      expect(found.every((f) => f.status === 'active')).toBe(true);
    }
  });

  it('reads these quests across the five screenshots', () => {
    const names = new Set(shots.flatMap((s) => questsOnScreen(s, index).map((f) => f.name)));
    for (const n of ['Toda Essa Escóriam', 'Atenção Médica -', 'Armeiro', 'Sangue na Água', 'Farmacêutico', 'Carga Abandonada', 'Longa fila', 'Vestido para Matar', 'Pássaros de Metal', 'Belka e Strelka', 'Ágil', 'Sinal estável', 'Mau hábito']) {
      expect(names, n).toContain(n);
    }
    // Menus, columns and the side panel are not quests.
    expect([...names].some((n) => /MENU|Progresso|Itens de missão/i.test(n))).toBe(false);
  });
});
