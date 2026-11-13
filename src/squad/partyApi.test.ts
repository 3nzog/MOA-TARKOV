import { afterEach, describe, expect, it } from 'vitest';
import { compareIpv4, lastPartyHosts, rememberPartyHost, shouldYieldTo, type FoundParty } from './partyApi';

const found = (id: string): FoundParty => ({ host: '26.1.1.1', port: 8787, room: 'ABCD2345', id });

describe('automatic party helpers', () => {
  afterEach(() => localStorage.clear());

  it('orders addresses numerically', () => {
    expect(compareIpv4('26.9.0.1', '26.10.0.1')).toBeLessThan(0);
    expect(compareIpv4('26.10.0.1', '26.9.0.1')).toBeGreaterThan(0);
    expect(compareIpv4('26.1.1.1', '26.1.1.1')).toBe(0);
  });

  it('two hosts at once: exactly one of them yields, whatever network each found the other on', () => {
    const a = 'a1b2';
    const b = 'f9e8';
    // A sees B and B sees A; only the higher id (B) joins the other.
    expect(shouldYieldTo(found(b), a)).toBe(false);
    expect(shouldYieldTo(found(a), b)).toBe(true);
    // Never to itself, never without ids.
    expect(shouldYieldTo(found(a), a)).toBe(false);
    expect(shouldYieldTo(found(''), a)).toBe(false);
    expect(shouldYieldTo(found(a), '')).toBe(false);
  });

  it('remembers a Radmin or home-network host, nothing else', () => {
    expect(lastPartyHosts()).toEqual([]);
    rememberPartyHost('26.12.34.56');
    expect(lastPartyHosts()).toEqual(['26.12.34.56']);
    rememberPartyHost('192.168.0.10');
    expect(lastPartyHosts()).toEqual(['192.168.0.10']);
    rememberPartyHost('8.8.8.8');
    expect(lastPartyHosts()).toEqual([]);
  });
});
