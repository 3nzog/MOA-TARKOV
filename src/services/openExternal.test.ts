import { afterEach, describe, expect, it, vi } from 'vitest';
import { installExternalLinks, isWebLink } from './openExternal';

describe('external links', () => {
  let uninstall: (() => void) | null = null;
  afterEach(() => {
    uninstall?.();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('knows a web link', () => {
    expect(isWebLink('https://escapefromtarkov.fandom.com/wiki/Debut')).toBe(true);
    expect(isWebLink('http://tarkov.dev')).toBe(true);
    expect(isWebLink('#top')).toBe(false);
    expect(isWebLink('javascript:alert(1)')).toBe(false);
    expect(isWebLink(null)).toBe(false);
  });

  it('sends a click on a wiki link to the browser instead of the app window', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    uninstall = installExternalLinks();
    document.body.innerHTML =
      '<a id="w" href="https://escapefromtarkov.fandom.com/wiki/Debut" target="_blank"><span id="inner">Abrir na wiki</span></a>' +
      '<a id="local" href="#map">mapa</a>';
    const click = (id: string) => {
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      document.getElementById(id)!.dispatchEvent(ev);
      return ev;
    };
    expect(click('inner').defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith('https://escapefromtarkov.fandom.com/wiki/Debut', '_blank', 'noopener,noreferrer');
    expect(click('local').defaultPrevented).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
