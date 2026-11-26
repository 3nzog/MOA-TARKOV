import { describe, expect, it } from 'vitest';
import { LINK_PORT, parseLinkOffer, parsePcInfo, pickLinkIp } from './linkOffer';

describe('link offers over the party', () => {
  it('keeps a usable offer and drops anything else', () => {
    expect(parseLinkOffer({ port: LINK_PORT, ips: [{ ip: '26.1.2.3', kind: 'radmin' }, { ip: 'x', kind: 'lan' }], name: 'PC-JOGO' })).toEqual({
      port: LINK_PORT,
      ips: [{ ip: '26.1.2.3', kind: 'radmin' }],
      name: 'PC-JOGO',
    });
    expect(parseLinkOffer({ port: LINK_PORT, ips: [] })).toBeNull();
    expect(parseLinkOffer({ port: 0, ips: [{ ip: '26.1.2.3', kind: 'radmin' }] })).toBeNull();
    expect(parseLinkOffer(null)).toBeNull();
    expect(parseLinkOffer('8789')).toBeNull();
  });

  it('reads a member PC (name and addresses)', () => {
    expect(parsePcInfo({ name: 'NOTDOSGURI', ips: [{ ip: '26.208.28.168', kind: 'radmin' }] })).toEqual({
      name: 'NOTDOSGURI',
      ips: [{ ip: '26.208.28.168', kind: 'radmin' }],
    });
    expect(parsePcInfo({ name: 'X', ips: [] })).toBeNull();
    expect(parsePcInfo(undefined)).toBeNull();
  });

  it('links over the home network when both PCs are on it, else over Radmin', () => {
    const theirs = [
      { ip: '26.9.9.9', kind: 'radmin' as const },
      { ip: '192.168.100.20', kind: 'lan' as const },
    ];
    expect(pickLinkIp(theirs, [{ ip: '192.168.100.11', kind: 'lan' }, { ip: '26.1.1.1', kind: 'radmin' }])).toBe('192.168.100.20');
    expect(pickLinkIp(theirs, [{ ip: '192.168.0.5', kind: 'lan' }, { ip: '26.1.1.1', kind: 'radmin' }])).toBe('26.9.9.9');
    expect(pickLinkIp(theirs, [{ ip: '192.168.0.5', kind: 'lan' }])).toBeNull();
  });
});
