import { describe, expect, it } from 'vitest';
import { exitBadges, exitBadgesHtml } from './exitBadges';
import { exitReqs } from './extractReqs';

const reqs = (requirements: string, extra: { always?: boolean; singleUse?: boolean } = {}) => exitReqs({ requirements, ...extra });

describe('exitBadges', () => {
  it('shows the item itself for paracord, the ice pick and flares', () => {
    const b = exitBadges(reqs('Paracord, Red Rebel ice pick, no armored rig'));
    expect(b.filter((x) => 'item' in x).map((x) => x.tag)).toEqual(['paracord', 'redRebel']);
    expect(exitBadges(reqs('Green flare = open'))).toEqual([{ tag: 'greenFlare', item: '6217726288ed9f0845317459' }]);
  });

  it('a glyph for keys, power, levers and paying', () => {
    expect(exitBadges(reqs('Requires power and the key')).map((x) => ('glyph' in x ? x.glyph : x.item))).toEqual(['power', 'key']);
    expect(exitBadges(reqs('7000 roubles per player')).map((x) => x.tag)).toEqual(['pay']);
  });

  it('nothing for "not always open" or "single use", nor for an exit that asks nothing', () => {
    expect(exitBadges(reqs('-', { always: false, singleUse: true }))).toEqual([]);
    expect(exitBadges(null)).toEqual([]);
    expect(exitBadgesHtml([], () => '')).toBe('');
  });

  it('names each picture in the player\'s language, safely', () => {
    const html = exitBadgesHtml(exitBadges(reqs('Paracord')), () => 'Corda "paracord"');
    expect(html).toContain('-base-image.webp');
    expect(html).toContain('title="Corda &quot;paracord&quot;"');
  });
});
