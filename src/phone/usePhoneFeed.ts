// The phone page's link to the PC: the map state over a WebSocket, connecting
// again on its own.
//
// - Speed: a screenshot's position comes on its own small frame straight from
//   the PC's screenshot watcher, ahead of the full map state. The page pings
//   the PC every PING_MS while it is on screen: that measures the delay, and
//   the steady trickle keeps the phone's Wi-Fi awake (a dozing phone gets each
//   packet up to a few hundred ms late).
// - A link can die without anyone saying so: the phone slept while the PC gave
//   up on it, or the Wi-Fi dropped, and the browser still calls the socket
//   open while nothing will ever come through it again. Each ping is answered
//   at once, so a page on screen that stops hearing back connects again.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { parsePhoneState, parsePosFrame, phoneSocketUrl, type PhoneState } from './phoneApi';
import { parsePhoneLayers, type PhoneLayers } from './phoneLayers';

export const RETRY_MS = 2500;
export const PING_MS = 200;
/** On screen and no word from the PC for this long: the link is dead (it answers every ping). */
export const SILENT_MS = 3000;
/** Back from the lock screen: how long the PC has to answer a ping before the link is redone. */
export const PROBE_MS = 1000;
const CHECK_MS = 500;

export type Conn = 'connecting' | 'live' | 'down' | 'nokey';

/** How fast the link is, for the bar (read from a timer, so the map does not redraw for it). */
export interface LinkStats {
  /** Ping round trip, ms (smoothed). */
  rtt: number | null;
  /** Screenshot seen on the PC → position here, ms (the latest one). */
  lag: number | null;
  /** When `lag` was measured (this phone's clock). */
  lagAt: number;
}

/** Lets a socket go without hearing from it again. */
function drop(ws: WebSocket): void {
  ws.onopen = null;
  ws.onmessage = null;
  ws.onclose = null;
  ws.close();
}

const onScreen = () => document.visibilityState !== 'hidden';

/** The PC's state over the socket, reconnecting on its own. */
export function usePhoneFeed(): { state: PhoneState | null; layers: PhoneLayers | null; conn: Conn; link: RefObject<LinkStats> } {
  const [state, setState] = useState<PhoneState | null>(null);
  const [layers, setLayers] = useState<PhoneLayers | null>(null);
  const [conn, setConn] = useState<Conn>(() => (phoneSocketUrl(window.location) ? 'connecting' : 'nokey'));
  const link = useRef<LinkStats>({ rtt: null, lag: null, lagAt: 0 });
  useEffect(() => {
    const url = phoneSocketUrl(window.location);
    // In development a page can feed a state by hand
    // (window.dispatchEvent(new CustomEvent('phone-demo', { detail: JSON.stringify(state) }))),
    // or the map's layers (detail: JSON.stringify({ layers })).
    const onDemo = (e: Event) => {
      const raw = (e as CustomEvent<string>).detail;
      if (typeof raw === 'string' && raw.startsWith('{"layers"')) {
        setLayers(parsePhoneLayers(raw));
        return;
      }
      const s = parsePhoneState(raw);
      if (s) {
        setState(s);
        setConn('live');
      }
    };
    if (import.meta.env.DEV) window.addEventListener('phone-demo', onDemo);
    if (!url) {
      return () => {
        if (import.meta.env.DEV) window.removeEventListener('phone-demo', onDemo);
      };
    }
    let ws: WebSocket | null = null;
    let timer: number | undefined;
    let alive = true;
    let heard = Date.now();
    let probe = 0;
    // The newest screenshot shown (the PC counts them from 1 each time it starts).
    let lastSeq = 0;
    // PC clock minus this phone's, from the quickest ping (null until one comes back).
    let best: { rtt: number; off: number; at: number } | null = null;
    const local = (pcTs: number) => (best ? pcTs - best.off : pcTs);

    const onPong = (raw: string) => {
      try {
        const v = JSON.parse(raw) as { pong?: unknown; t?: unknown };
        if (typeof v.pong !== 'number' || typeof v.t !== 'number') return;
        const now = Date.now();
        const rtt = Math.max(0, now - v.pong);
        if (!best || rtt <= best.rtt || now - best.at > 30_000) best = { rtt, off: v.t - (v.pong + rtt / 2), at: now };
        const prev = link.current.rtt;
        link.current.rtt = prev === null ? rtt : prev * 0.8 + rtt * 0.2;
      } catch {
        /* not a pong */
      }
    };
    const onPos = (raw: string) => {
      const p = parsePosFrame(raw);
      if (!p || (p.seq ?? 0) <= lastSeq) return;
      lastSeq = p.seq ?? 0;
      if (best) {
        link.current.lag = Math.max(0, Date.now() - local(p.ts));
        link.current.lagAt = Date.now();
      }
      const pos = { ...p, ts: local(p.ts) };
      setState((s) => (s ? { ...s, pos } : s));
    };
    const onState = (raw: string) => {
      const s = parsePhoneState(raw);
      if (!s || !alive) return;
      const seq = s.pos?.seq ?? 0;
      // The position on its own frame came first: keep it (same screenshot,
      // or a newer one than this state carries).
      const keep = seq > 0 && seq <= lastSeq;
      if (seq > lastSeq) lastSeq = seq;
      const pos = s.pos ? { ...s.pos, ts: local(s.pos.ts) } : null;
      setState((prev) => ({ ...s, pos: keep && pos && prev?.pos ? prev.pos : pos }));
    };

    const open = () => {
      if (!alive) return;
      window.clearTimeout(timer);
      if (ws) drop(ws);
      setConn((c) => (c === 'live' ? 'down' : c));
      heard = Date.now();
      probe = 0;
      lastSeq = 0;
      const sock = new WebSocket(url);
      ws = sock;
      sock.onopen = () => {
        heard = Date.now();
        if (alive) setConn('live');
      };
      sock.onmessage = (ev) => {
        heard = Date.now();
        const raw: unknown = ev.data;
        if (typeof raw !== 'string') return;
        if (raw.startsWith('{"pong"')) onPong(raw);
        else if (raw.startsWith('{"pos"')) onPos(raw);
        else if (raw.startsWith('{"layers"')) {
          const l = parsePhoneLayers(raw);
          if (l && alive) setLayers(l);
        }
        else onState(raw);
      };
      sock.onclose = () => {
        if (!alive) return;
        setConn('down');
        timer = window.setTimeout(open, RETRY_MS);
      };
    };
    open();

    const ping = () => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ping: Date.now() }));
    };
    const pinger = window.setInterval(() => {
      if (onScreen()) ping();
    }, PING_MS);
    const watch = window.setInterval(() => {
      if (!ws || !onScreen() || ws.readyState > WebSocket.OPEN) return;
      const now = Date.now();
      // Asked after the lock screen and not answered, or silent for too long while on screen.
      if ((probe && heard < probe && now - probe > PROBE_MS) || now - heard > SILENT_MS) open();
    }, CHECK_MS);
    // Back from the lock screen, or the Wi-Fi back: a closed link reconnects at
    // once; an open one is asked, and redone if the PC does not answer quickly.
    const onBack = () => {
      if (!onScreen() || !ws) return;
      if (ws.readyState > WebSocket.OPEN) {
        open();
        return;
      }
      probe = Date.now();
      ping();
    };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('online', onBack);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.clearInterval(pinger);
      window.clearInterval(watch);
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('online', onBack);
      if (import.meta.env.DEV) window.removeEventListener('phone-demo', onDemo);
      if (ws) drop(ws);
    };
  }, []);
  return { state, layers, conn, link };
}
