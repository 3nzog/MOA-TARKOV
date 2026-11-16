import { afterEach, describe, expect, it } from 'vitest';
import { isLinkedViewer, isNetworkIp, loadPrefs, normalizePrefs, pickAutoTarget, savePrefs, setLinkedViewer } from './linkApi';

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
    expect(normalizePrefs(null)).toEqual({ mode: 'auto', autoAcceptLan: true, target: null, refused: [] });
    expect(normalizePrefs({ allowLinks: 'yes' })).toEqual({ mode: 'auto', autoAcceptLan: true, target: null, refused: [] });
    // Saved by the version before modes: "allow links" was the game PC.
    expect(normalizePrefs({ allowLinks: true, target: { host: '8.8.8.8', port: 8789, name: 'x' } })).toEqual({ mode: 'game', autoAcceptLan: true, target: null, refused: [] });
    expect(normalizePrefs({ mode: 'screen', autoAcceptLan: false }).mode).toBe('screen');
    expect(normalizePrefs({ mode: 'screen', autoAcceptLan: false }).autoAcceptLan).toBe(false);
    expect(normalizePrefs({ mode: 'weird' }).mode).toBe('auto');
    expect(normalizePrefs({ target: { host: '192.168.1.9', port: 0, name: 'x' } }).target).toBeNull();
    expect(normalizePrefs({ target: { host: '192.168.1.9', port: 8789 } }).target).toEqual({ host: '192.168.1.9', port: 8789, name: '192.168.1.9' });
  });

  it('round-trips through storage', () => {
    expect(loadPrefs()).toEqual({ mode: 'auto', autoAcceptLan: true, target: null, refused: [] });
    savePrefs({ mode: 'screen', autoAcceptLan: true, target: { host: '26.1.2.3', port: 8789, name: 'PC-JOGO' }, refused: ['OUTRO'] });
    expect(loadPrefs()).toEqual({ mode: 'screen', autoAcceptLan: true, target: { host: '26.1.2.3', port: 8789, name: 'PC-JOGO' }, refused: ['OUTRO'] });
    localStorage.setItem('tc_link_v1', '{not json');
    expect(loadPrefs()).toEqual({ mode: 'auto', autoAcceptLan: true, target: null, refused: [] });
  });

  it('links on its own only to its own PCs: same house, or the one it showed before', () => {
    const friendRadmin = { host: '26.208.28.168', port: 8789, name: 'NOTDOSGURI' };
    const myGamePcLan = { host: '192.168.0.20', port: 8789, name: 'PC-JOGO' };
    const myGamePcRadmin = { host: '26.10.0.2', port: 8789, name: 'PC-JOGO' };
    const none = { target: null, refused: [] };
    // Another player's PC over Radmin is never asked on its own.
    expect(pickAutoTarget([friendRadmin], none)).toBeNull();
    // A PC in the same house is.
    expect(pickAutoTarget([friendRadmin, myGamePcLan], none)).toEqual(myGamePcLan);
    // The PC linked before (by hand, over Radmin) relinks by name.
    expect(pickAutoTarget([friendRadmin, myGamePcRadmin], { target: myGamePcRadmin, refused: [] })).toEqual(myGamePcRadmin);
    // One that refused is never asked again on its own, even in the same house.
    expect(pickAutoTarget([myGamePcLan], { target: null, refused: ['PC-JOGO'] })).toBeNull();
    expect(normalizePrefs({ refused: ['A', 3, '', 'B'] }).refused).toEqual(['A', 'B']);
  });

  it('tells the squad when this PC is only an extra screen', () => {
    expect(isLinkedViewer()).toBe(false);
    setLinkedViewer(true);
    expect(isLinkedViewer()).toBe(true);
  });
});
