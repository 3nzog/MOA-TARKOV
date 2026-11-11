import { afterEach, describe, expect, it } from 'vitest';
import { compareIpv4, lastPartyHosts, rememberPartyHost } from './partyApi';

describe('automatic party helpers', () => {
  afterEach(() => localStorage.clear());

  it('orders addresses numerically, so two hosts agree on which one yields', () => {
    expect(compareIpv4('26.9.0.1', '26.10.0.1')).toBeLessThan(0);
    expect(compareIpv4('26.10.0.1', '26.9.0.1')).toBeGreaterThan(0);
    expect(compareIpv4('26.1.1.1', '26.1.1.1')).toBe(0);
  });

  it('remembers only a Radmin host address', () => {
    expect(lastPartyHosts()).toEqual([]);
    rememberPartyHost('26.12.34.56');
    expect(lastPartyHosts()).toEqual(['26.12.34.56']);
    rememberPartyHost('192.168.0.10');
    expect(lastPartyHosts()).toEqual([]);
  });
});
