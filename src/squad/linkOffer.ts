// "Link to the game PC" from the party list. A game PC whose app accepts links
// (src/link) tells the party where to reach it — its addresses and the link
// port — along with its quests; another member's app can then link to it in
// one click (the ⋮ menu by the name), without looking for it on the network.
// The game PC still confirms on its own screen, as with any link.
import type { LinkOffer } from '../../shared/squadProtocol';

/** The link port (src-tauri/src/link.rs LINK_PORT). */
export const LINK_PORT = 8789;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** A member's offer as it came over the party, checked; null = none or not usable. */
export function parseLinkOffer(v: unknown): LinkOffer | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<LinkOffer>;
  const port = typeof o.port === 'number' && Number.isInteger(o.port) && o.port > 0 && o.port < 65536 ? o.port : null;
  const ips = Array.isArray(o.ips)
    ? o.ips
        .filter((x): x is LinkOffer['ips'][number] => !!x && typeof x === 'object' && typeof x.ip === 'string' && IPV4.test(x.ip))
        .map((x) => ({ ip: x.ip, kind: x.kind === 'radmin' ? ('radmin' as const) : ('lan' as const) }))
        .slice(0, 8)
    : [];
  if (!port || ips.length === 0) return null;
  const name = typeof o.name === 'string' ? o.name.slice(0, 64) : '';
  return { port, ips, name };
}

const prefix24 = (ip: string) => ip.split('.').slice(0, 3).join('.');

/**
 * Which of the game PC's addresses this PC can reach: one on the same home
 * network (same /24) first, else Radmin when this PC is on Radmin too.
 */
export function pickLinkIp(theirs: LinkOffer['ips'], mine: { ip: string; kind: 'radmin' | 'lan' }[]): string | null {
  const myLans = new Set(mine.filter((m) => m.kind === 'lan').map((m) => prefix24(m.ip)));
  const lan = theirs.find((t) => t.kind === 'lan' && myLans.has(prefix24(t.ip)));
  if (lan) return lan.ip;
  const radmin = theirs.find((t) => t.kind === 'radmin');
  if (radmin && mine.some((m) => m.kind === 'radmin')) return radmin.ip;
  return null;
}
