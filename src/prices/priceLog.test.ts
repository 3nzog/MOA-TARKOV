import { describe, expect, it } from 'vitest';
import { DEFAULT_WATCH, MAX_DAYS, parsePriceLog, profile, record, type Sample } from './priceLog';

const H = 3_600_000;
const DAY = 24 * H;
const SALEWA = DEFAULT_WATCH[0];

describe('price log', () => {
  it('writes down the watched items once per tarkov.dev scan', () => {
    const log = parsePriceLog(null);
    const items = { [SALEWA]: { lastLowPrice: 36666, avg24hPrice: 35171, lastOfferCount: 14, lastScan: '2026-11-25T11:08:03.000Z' }, other: { lastLowPrice: 1, lastScan: '2026-11-25T11:08:03.000Z' } };
    const once = record(log, items, Date.parse('2026-11-25T12:00:00Z'));
    expect(once.samples[SALEWA]).toEqual([[Date.parse('2026-11-25T11:08:03.000Z'), 36666, 35171, 14]]);
    expect(once.samples.other).toBeUndefined();
    const twice = record(once, items, Date.parse('2026-11-25T12:30:00Z'));
    expect(twice.samples[SALEWA]).toHaveLength(1);
  });

  it('keeps only the last weeks', () => {
    const now = 100 * DAY;
    const old: Sample = [now - (MAX_DAYS + 1) * DAY, 1, 1, 1];
    const log = { ...parsePriceLog(null), samples: { [SALEWA]: [old] } };
    expect(record(log, {}, now).samples[SALEWA]).toEqual([]);
  });

  it('reads back what it saved, and nothing broken', () => {
    const log = record(parsePriceLog(null), { [SALEWA]: { lastLowPrice: 5, lastScan: '2026-11-25T00:00:00Z' } }, 0);
    expect(parsePriceLog(JSON.stringify(log)).samples[SALEWA]).toHaveLength(1);
    expect(parsePriceLog('{"watch":"x","samples":{"a":[[1,"2",3,4]]}}')).toMatchObject({ watch: DEFAULT_WATCH, samples: { a: [] } });
    expect(parsePriceLog('not json').watch).toEqual(DEFAULT_WATCH);
  });

  it('finds the hours an item sells highest, once there are days of records', () => {
    // A week, every half hour: 20 h and 21 h sell 10% higher, 4 h 10% lower.
    const list: Sample[] = [];
    for (let t = 0; t < 7 * DAY; t += H / 2) {
      const h = Math.floor(t / H) % 24;
      const price = h === 20 || h === 21 ? 33000 : h === 4 ? 27000 : 30000;
      list.push([t, price, 30000, 10]);
    }
    const p = profile(list, (t) => Math.floor(t / H) % 24, (t) => Math.floor(t / DAY) % 7);
    expect(p.ready).toBe(true);
    expect(p.best.map((s) => s.k).slice(0, 2).sort()).toEqual([20, 21]);
    expect(p.best[0].vs).toBe(10);
    expect(p.worst?.k).toBe(4);
    expect(p.hours[12]).toMatchObject({ n: 14, med: 30000, vs: 0 });
  });

  it('is not ready with a day of records', () => {
    const list: Sample[] = Array.from({ length: 48 }, (_, i) => [i * (H / 2), 30000, 30000, 1]);
    expect(profile(list, (t) => Math.floor(t / H) % 24).ready).toBe(false);
  });
});

describe('reading tarkov.dev items file', () => {
  it('reads it once, then only asks whether it changed', async () => {
    const { checkPrices } = await import('./priceLog');
    const calls: { url: string; headers: Record<string, string> }[] = [];
    let status = 200;
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      if (status === 304) return new Response(null, { status: 304 });
      return new Response(
        JSON.stringify({ data: { items: { [SALEWA]: { lastLowPrice: 36666, avg24hPrice: 35171, lastOfferCount: 14, lastScan: '2026-11-25T11:08:03.000Z' } } } }),
        { status: 200, headers: { etag: 'W/"abc"' } },
      );
    }) as typeof fetch;
    try {
      await checkPrices(Date.parse('2026-11-25T12:00:00Z'));
      status = 304;
      await checkPrices(Date.parse('2026-11-25T12:30:00Z'));
    } finally {
      globalThis.fetch = real;
    }
    expect(calls[0].url).toBe('https://json.tarkov.dev/regular/items');
    expect(calls[0].headers['If-None-Match']).toBeUndefined();
    expect(calls[1].headers['If-None-Match']).toBe('W/"abc"');
  });
});
