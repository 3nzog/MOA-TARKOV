import { afterEach, describe, expect, it } from 'vitest';
import { isLinkedViewer, isNetworkIp, loadPrefs, normalizePrefs, savePrefs, setLinkedViewer } from './linkApi';

describe('linked PC helpers', () => {
  afterEach(() => {
    localStorage.clear();
    setLinkedViewer(false);
  });

  it('accepts Radmin and home-network addresses only', () => {
    for (const ok of ['26.243.126.84', '192.168.100.11', '10.0.0.5', '172.16.0.1', '172.31.255.254']) {
      expect(isNetworkIp(ok), ok).toBe(true);
    }
    for (const bad of ['8.8.8.8', '172.32.0.1', '192.169.0.1', '127.0.0.1', '26.1.1', '26.1.1.300', 'abc', '', ' 192.168.1.1x']) {
      expect(isNetworkIp(bad), bad).toBe(false);
    }
    expect(isNetworkIp(' 192.168.1.2 ')).toBe(true);
  });

  it('keeps only sane saved choices', () => {
    expect(normalizePrefs(null)).toEqual({ allowLinks: false, target: null });
    expect(normalizePrefs({ allowLinks: 'yes' })).toEqual({ allowLinks: false, target: null });
    expect(normalizePrefs({ allowLinks: true, target: { host: '8.8.8.8', port: 8789, name: 'x' } })).toEqual({ allowLinks: true, target: null });
    expect(normalizePrefs({ target: { host: '192.168.1.9', port: 0, name: 'x' } }).target).toBeNull();
    expect(normalizePrefs({ target: { host: '192.168.1.9', port: 8789 } }).target).toEqual({ host: '192.168.1.9', port: 8789, name: '192.168.1.9' });
  });

  it('round-trips through storage', () => {
    expect(loadPrefs()).toEqual({ allowLinks: false, target: null });
    savePrefs({ allowLinks: true, target: { host: '26.1.2.3', port: 8789, name: 'PC-JOGO' } });
    expect(loadPrefs()).toEqual({ allowLinks: true, target: { host: '26.1.2.3', port: 8789, name: 'PC-JOGO' } });
    localStorage.setItem('tc_link_v1', '{not json');
    expect(loadPrefs()).toEqual({ allowLinks: false, target: null });
  });

  it('tells the squad when this PC is only an extra screen', () => {
    expect(isLinkedViewer()).toBe(false);
    setLinkedViewer(true);
    expect(isLinkedViewer()).toBe(true);
  });
});
