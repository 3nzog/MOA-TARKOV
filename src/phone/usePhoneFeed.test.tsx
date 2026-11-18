import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PING_MS, PROBE_MS, RETRY_MS, SILENT_MS, usePhoneFeed, type Conn, type LinkStats } from './usePhoneFeed';

// A socket the test drives: the PC accepting, speaking, or the link dying.
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static all: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
  }
  send(data: string) {
    this.sent.push(data);
  }
  /** The PC answers every ping so far (its clock `pcAhead` ms ahead of the phone's). */
  answer(pcAhead = 0) {
    for (const m of this.sent.splice(0)) {
      const { ping } = JSON.parse(m) as { ping: number };
      this.say(JSON.stringify({ pong: ping, t: Date.now() + pcAhead }));
    }
  }
  accept() {
    this.readyState = FakeSocket.OPEN;
    act(() => this.onopen?.());
  }
  say(data: string) {
    act(() => this.onmessage?.({ data }));
  }
  /** The browser noticed the link closed. */
  die() {
    this.readyState = FakeSocket.CLOSED;
    act(() => this.onclose?.());
  }
}

const STATE = JSON.stringify({ mapId: 'bigmap', points: [] });
const HEARTBEAT = '{"hb":1}';
const sockets = () => FakeSocket.all;
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const setVisible = (visible: boolean) => {
  Object.defineProperty(document, 'visibilityState', { value: visible ? 'visible' : 'hidden', configurable: true });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
};

const last: { conn: Conn | null; mapId: string | null; x: number | null; link: LinkStats | null } = { conn: null, mapId: null, x: null, link: null };
function Probe() {
  const { state, conn, link } = usePhoneFeed();
  useEffect(() => {
    last.conn = conn;
    last.mapId = state?.mapId ?? null;
    last.x = state?.pos?.x ?? null;
    last.link = link.current;
  });
  return null;
}

describe('usePhoneFeed', () => {
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    FakeSocket.all = [];
    last.conn = null;
    last.mapId = null;
    last.x = null;
    last.link = null;
    window.history.replaceState({}, '', '/?view=phone&k=abcdef0123456789');
    root = createRoot(document.createElement('div'));
    act(() => root.render(<Probe />));
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (document as { visibilityState?: unknown }).visibilityState;
  });

  it('a link that goes silent is dropped and opened again (the phone slept, the PC let it go)', () => {
    expect(sockets()).toHaveLength(1);
    expect(sockets()[0].url).toContain('/ws?k=abcdef0123456789');
    sockets()[0].accept();
    sockets()[0].say(STATE);
    expect(last).toMatchObject({ conn: 'live', mapId: 'bigmap' });
    // Nothing more ever comes through (not even the pings' answers), and the browser still calls it open.
    advance(SILENT_MS + 600);
    expect(sockets()).toHaveLength(2);
    expect(sockets()[0].readyState).toBe(FakeSocket.CLOSED);
    expect(last.conn).toBe('down');
    sockets()[1].accept();
    expect(last.conn).toBe('live');
    // The last map stays on screen meanwhile; the old socket is not heard any more.
    expect(last.mapId).toBe('bigmap');
    sockets()[0].say(JSON.stringify({ mapId: 'old', points: [] }));
    expect(last.mapId).toBe('bigmap');
  });

  it('a link that answers its pings stays (no screenshot for a while) without touching the map', () => {
    sockets()[0].accept();
    sockets()[0].say(STATE);
    for (let i = 0; i < 300; i++) {
      advance(PING_MS);
      sockets()[0].answer();
    }
    expect(sockets()).toHaveLength(1);
    expect(last).toMatchObject({ conn: 'live', mapId: 'bigmap' });
    expect(last.link?.rtt).toBe(0);
  });

  it('pings only while the page is on screen', () => {
    sockets()[0].accept();
    advance(PING_MS * 5);
    expect(sockets()[0].sent).toHaveLength(5);
    sockets()[0].sent = [];
    setVisible(false);
    advance(PING_MS * 5);
    expect(sockets()[0].sent).toHaveLength(0);
  });

  it("a screenshot's own position frame moves the dot, and the map state that follows does not undo it", () => {
    const sock = sockets()[0];
    sock.accept();
    sock.answer();
    advance(PING_MS);
    sock.answer(5000); // the PC's clock is 5 s ahead
    const posState = (x: number, seq: number) => JSON.stringify({ mapId: 'bigmap', points: [], pos: { x, y: 0, z: 0, rotation: 0, ts: 0, seq } });
    sock.say(posState(1, 1));
    expect(last.x).toBe(1);
    // Screenshot 2 on its own frame, seen on the PC 40 ms ago (PC clock).
    sock.say(JSON.stringify({ pos: { x: 2, y: 0, z: 0, rotation: 0, ts: Date.now() + 5000 - 40, seq: 2 } }));
    expect(last.x).toBe(2);
    expect(last.link?.lag).toBe(40);
    // The app's map state for screenshot 1 arrives late: the dot stays on 2.
    sock.say(posState(1, 1));
    expect(last.x).toBe(2);
    sock.say(posState(2, 2));
    expect(last.x).toBe(2);
    sock.say(posState(3, 3));
    expect(last.x).toBe(3);
    // An old position frame is ignored.
    sock.say(JSON.stringify({ pos: { x: 9, y: 0, z: 0, rotation: 0, ts: 0, seq: 2 } }));
    expect(last.x).toBe(3);
  });

  it('back from the lock screen, a link that does not answer is redone within a second', () => {
    sockets()[0].accept();
    sockets()[0].say(STATE);
    setVisible(false);
    // Asleep: no timer ran on the phone, the clock moved on.
    vi.setSystemTime(Date.now() + 60_000);
    sockets()[0].sent = [];
    setVisible(true);
    expect(sockets()[0].sent).toHaveLength(1); // asked at once
    advance(PROBE_MS + 500);
    expect(sockets()).toHaveLength(2);
  });

  it('back from the lock screen with the link still there: nothing changes', () => {
    sockets()[0].accept();
    setVisible(false);
    vi.setSystemTime(Date.now() + 60_000);
    sockets()[0].say(HEARTBEAT);
    setVisible(true);
    sockets()[0].answer();
    for (let i = 0; i < 10; i++) {
      advance(PING_MS);
      sockets()[0].answer();
    }
    expect(sockets()).toHaveLength(1);
  });

  it('a link the browser saw close tries again after a moment', () => {
    sockets()[0].accept();
    sockets()[0].die();
    expect(last.conn).toBe('down');
    advance(RETRY_MS - 1);
    expect(sockets()).toHaveLength(1);
    advance(1);
    expect(sockets()).toHaveLength(2);
  });
});
