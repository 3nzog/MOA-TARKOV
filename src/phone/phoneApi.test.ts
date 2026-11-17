import { describe, expect, it } from 'vitest';
import { parsePhoneState, phoneSocketUrl } from './phoneApi';

describe('phone map helpers', () => {
  it('builds the socket address from the page address, only with a sane key', () => {
    expect(phoneSocketUrl({ host: '192.168.100.11:8791', search: '?view=phone&k=abcdef0123456789abcdef0123456789' })).toBe(
      'ws://192.168.100.11:8791/ws?k=abcdef0123456789abcdef0123456789',
    );
    expect(phoneSocketUrl({ host: 'x:8791', search: '?view=phone' })).toBeNull();
    expect(phoneSocketUrl({ host: 'x:8791', search: '?view=phone&k=short' })).toBeNull();
    expect(phoneSocketUrl({ host: 'x:8791', search: '?view=phone&k=abcdef0123456789%26x%3D1' })).toBeNull();
  });

  it('reads what the PC sends and drops junk', () => {
    const s = parsePhoneState(
      JSON.stringify({
        mapId: '56f40101d2720b2a4d8b45d6',
        mapName: 'Customs',
        pos: { x: 1, y: 2, z: 3, rotation: 90, ts: 5 },
        activeFloorId: null,
        points: [{ x: 1, z: 2, kind: 'extract', label: 'ZB-1011' }, { nope: true }],
        mates: [],
        raidClock: null,
        sentAt: 9,
      }),
    );
    expect(s?.mapName).toBe('Customs');
    expect(s?.points).toHaveLength(1);
    expect(s?.pos?.rotation).toBe(90);
    expect(parsePhoneState('not json')).toBeNull();
    expect(parsePhoneState(JSON.stringify({ mapId: 'x' }))).toBeNull();
    expect(parsePhoneState(42)).toBeNull();
  });
});
