// Keeps the link between this PC and the player's other PC going, on its own:
//  - "auto" (default): the PC with the game (its logs) is the game PC and
//    accepts links; a PC without the game looks for the game PC on the
//    network every few seconds and links as soon as it shows up.
//  - On the same home network the game PC accepts without asking (Radmin
//    still asks once); a known PC relinks by itself, even if its IP changed.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  hasGameLogs,
  linkAnswer,
  linkAvailable,
  linkConnect,
  linkDisconnect,
  linkFind,
  linkForget,
  linkHostStart,
  linkHostStatus,
  linkHostStop,
  linkSetAutoAccept,
  loadPrefs,
  onLinkChanged,
  onLinkClient,
  onLinkRequest,
  onLinkRequestDone,
  savePrefs,
  setLinkedViewer,
  type FoundLink,
  type LinkClientStatus,
  type LinkHostStatus,
  type LinkMode,
  type LinkPrefs,
  type LinkRequest,
} from './linkApi';
import { LinkCtx, type LinkApi } from './useLink';
import { netLog } from '../net/netApi';

const SEARCH_EVERY_MS = 8000;
/** Lost this long: look for the game PC again (its IP may have changed). */
const REFIND_AFTER_MS = 20000;

export function LinkProvider({ children }: { children: ReactNode }) {
  const available = linkAvailable();
  const [prefs, setPrefs] = useState<LinkPrefs>(() => loadPrefs());
  const [host, setHost] = useState<LinkHostStatus | null>(null);
  const [client, setClient] = useState<LinkClientStatus | null>(null);
  const [requests, setRequests] = useState<LinkRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasGame, setHasGame] = useState<boolean | null>(null);
  const prefsRef = useRef(prefs);
  const clientRef = useRef(client);
  const lostSince = useRef<number | null>(null);

  const update = useCallback((next: LinkPrefs) => {
    prefsRef.current = next;
    setPrefs(next);
    savePrefs(next);
  }, []);

  // Which PC is this? The one with the game's logs is the game PC.
  useEffect(() => {
    if (!available) return;
    let alive = true;
    void hasGameLogs().then((g) => alive && setHasGame(g));
    return () => {
      alive = false;
    };
  }, [available]);

  const role: 'game' | 'screen' | 'off' | null =
    prefs.mode === 'off'
      ? 'off'
      : prefs.mode === 'game' || prefs.mode === 'screen'
        ? prefs.mode
        : hasGame === null
          ? null
          : hasGame
            ? 'game'
            : 'screen';

  // Events from the Rust side.
  useEffect(() => {
    if (!available) return;
    const unlistens: (() => void)[] = [];
    let alive = true;
    void (async () => {
      const subs = await Promise.all([
        onLinkRequest((r) => setRequests((list) => (list.some((x) => x.id === r.id) ? list : [...list, r]))),
        onLinkRequestDone((id) => setRequests((list) => list.filter((x) => x.id !== id))),
        onLinkChanged((s) => setHost((cur) => ({ ...s, firewall: cur?.firewall ?? s.firewall }))),
        onLinkClient((s) => {
          clientRef.current = s;
          setClient(s);
          setLinkedViewer(s.state === 'linked');
          if (s.state === 'linked') lostSince.current = null;
          else if (s.state === 'lost' && lostSince.current === null) lostSince.current = Date.now();
          // The game PC said no (or forgot this PC): forget it here too.
          if (s.state === 'refused' && prefsRef.current.target) update({ ...prefsRef.current, target: null });
          if (s.state === 'linked' && s.name && prefsRef.current.target && prefsRef.current.target.name !== s.name) {
            update({ ...prefsRef.current, target: { ...prefsRef.current.target, name: s.name } });
          }
        }),
      ]);
      if (alive) unlistens.push(...subs);
      else subs.forEach((u) => u());
    })();
    return () => {
      alive = false;
      unlistens.forEach((u) => u());
    };
  }, [available, update]);

  // Home-network PCs accepted without asking (setting).
  useEffect(() => {
    if (available) void linkSetAutoAccept(prefs.autoAcceptLan).catch(() => undefined);
  }, [available, prefs.autoAcceptLan]);

  const connect = useCallback(
    async (to: FoundLink) => {
      setError(null);
      try {
        const { code } = await linkConnect(to.host, to.port);
        update({ ...prefsRef.current, target: to });
        const s: LinkClientStatus = { state: 'connecting', host: to.host, port: to.port, code };
        clientRef.current = s;
        setClient(s);
      } catch (e) {
        setError(String(e));
      }
    },
    [update],
  );

  // Game PC: accept links. Anything else: stop accepting.
  useEffect(() => {
    if (!available || role === null) return;
    if (role === 'game') {
      linkHostStart()
        .then(setHost)
        .catch((e) => {
          setError(String(e));
          netLog(`não abriu este PC para anexar: ${String(e)}`);
        });
    } else {
      void linkHostStop()
        .catch(() => undefined)
        .then(() => linkHostStatus().then(setHost).catch(() => undefined));
    }
  }, [available, role]);

  // Extra screen: relink to the last game PC at once, then keep looking.
  useEffect(() => {
    if (!available || role !== 'screen') {
      if (available && role !== null && clientRef.current) {
        void linkDisconnect().catch(() => undefined);
        setLinkedViewer(false);
        clientRef.current = null;
        setClient(null);
      }
      return;
    }
    const t0 = prefsRef.current.target;
    if (t0 && !clientRef.current) void connect(t0);
    let busy = false;
    const tick = async () => {
      if (busy) return;
      const c = clientRef.current;
      const lostLong = c?.state === 'lost' && lostSince.current !== null && Date.now() - lostSince.current > REFIND_AFTER_MS;
      const idle = !c || c.state === 'off' || c.state === 'refused';
      if (!idle && !lostLong) return;
      busy = true;
      try {
        const found = await linkFind(1500);
        if (found.length === 0) return;
        const want = prefsRef.current.target;
        const pick = (want && found.find((f) => f.name === want.name)) || found[0];
        // Lost but the same address still answers: the link retries on its own.
        if (lostLong && c && pick.host === c.host) return;
        netLog(`anexar: achou ${pick.name} (${pick.host}), anexando sozinho`);
        lostSince.current = null;
        await connect(pick);
      } catch {
        /* nothing found this time */
      } finally {
        busy = false;
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), SEARCH_EVERY_MS);
    return () => window.clearInterval(id);
  }, [available, role, connect]);

  const setMode = useCallback(
    (mode: LinkMode) => {
      setError(null);
      update({ ...prefsRef.current, mode });
    },
    [update],
  );

  const setAutoAcceptLan = useCallback(
    (on: boolean) => update({ ...prefsRef.current, autoAcceptLan: on }),
    [update],
  );

  // Kept for the settings screen: "allow links" = this is the game PC.
  const setAllowLinks = useCallback(async (on: boolean) => setMode(on ? 'game' : 'off'), [setMode]);

  const find = useCallback(async () => {
    setError(null);
    try {
      return await linkFind(1800);
    } catch (e) {
      setError(String(e));
      return [];
    }
  }, []);

  const disconnect = useCallback(async () => {
    await linkDisconnect().catch(() => undefined);
    setLinkedViewer(false);
    clientRef.current = null;
    setClient(null);
    // Unlinking by hand: stop looking on its own too.
    update({ ...prefsRef.current, target: null, mode: prefsRef.current.mode === 'auto' ? 'off' : prefsRef.current.mode });
  }, [update]);

  const answer = useCallback(async (id: string, accept: boolean) => {
    setRequests((list) => list.filter((x) => x.id !== id));
    await linkAnswer(id, accept).catch(() => undefined);
  }, []);

  const forget = useCallback(async (device: string) => {
    await linkForget(device).catch(() => undefined);
    setHost(await linkHostStatus().catch(() => null));
  }, []);

  const api = useMemo<LinkApi>(
    () => ({
      available,
      prefs,
      role,
      hasGame,
      host,
      client,
      requests,
      error,
      setMode,
      setAutoAcceptLan,
      setAllowLinks,
      find,
      connect,
      disconnect,
      answer,
      forget,
    }),
    [available, prefs, role, hasGame, host, client, requests, error, setMode, setAutoAcceptLan, setAllowLinks, find, connect, disconnect, answer, forget],
  );
  return <LinkCtx.Provider value={api}>{children}</LinkCtx.Provider>;
}
