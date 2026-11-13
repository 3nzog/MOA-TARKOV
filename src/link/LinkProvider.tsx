// Keeps the link between this PC and the player's other PC going: on start it
// reopens this PC for linking (game PC) or relinks to the game PC (extra
// screen), as last chosen, and tracks requests and status for the UI.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  linkAnswer,
  linkAvailable,
  linkConnect,
  linkDisconnect,
  linkFind,
  linkForget,
  linkHostStart,
  linkHostStatus,
  linkHostStop,
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
  type LinkPrefs,
  type LinkRequest,
} from './linkApi';
import { LinkCtx, type LinkApi } from './useLink';
import { netLog } from '../net/netApi';

export function LinkProvider({ children }: { children: ReactNode }) {
  const available = linkAvailable();
  const [prefs, setPrefs] = useState<LinkPrefs>(() => loadPrefs());
  const [host, setHost] = useState<LinkHostStatus | null>(null);
  const [client, setClient] = useState<LinkClientStatus | null>(null);
  const [requests, setRequests] = useState<LinkRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const prefsRef = useRef(prefs);

  const update = useCallback((next: LinkPrefs) => {
    prefsRef.current = next;
    setPrefs(next);
    savePrefs(next);
  }, []);

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
          setClient(s);
          setLinkedViewer(s.state === 'linked');
          // The game PC said no (or forgot this PC): stop relinking at start.
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

  // Resume what was chosen last time.
  useEffect(() => {
    if (!available) return;
    const p = prefsRef.current;
    if (p.allowLinks) {
      linkHostStart()
        .then(setHost)
        .catch((e) => {
          setError(String(e));
          netLog(`não reabriu este PC para anexar: ${String(e)}`);
        });
    } else {
      linkHostStatus().then(setHost).catch(() => undefined);
    }
    // (StrictMode runs this twice in development; both calls are idempotent.)
    if (p.target) {
      linkConnect(p.target.host, p.target.port).catch((e) => setError(String(e)));
    }
  }, [available]);

  const setAllowLinks = useCallback(
    async (on: boolean) => {
      setError(null);
      update({ ...prefsRef.current, allowLinks: on });
      try {
        if (on) setHost(await linkHostStart());
        else {
          await linkHostStop();
          setHost(await linkHostStatus());
        }
      } catch (e) {
        setError(String(e));
        update({ ...prefsRef.current, allowLinks: false });
      }
    },
    [update],
  );

  const find = useCallback(async () => {
    setError(null);
    try {
      return await linkFind(1800);
    } catch (e) {
      setError(String(e));
      return [];
    }
  }, []);

  const connect = useCallback(
    async (to: FoundLink) => {
      setError(null);
      try {
        const { code } = await linkConnect(to.host, to.port);
        update({ ...prefsRef.current, target: to });
        setClient({ state: 'connecting', host: to.host, port: to.port, code });
      } catch (e) {
        setError(String(e));
      }
    },
    [update],
  );

  const disconnect = useCallback(async () => {
    await linkDisconnect().catch(() => undefined);
    setLinkedViewer(false);
    setClient(null);
    update({ ...prefsRef.current, target: null });
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
    () => ({ available, prefs, host, client, requests, error, setAllowLinks, find, connect, disconnect, answer, forget }),
    [available, prefs, host, client, requests, error, setAllowLinks, find, connect, disconnect, answer, forget],
  );
  return <LinkCtx.Provider value={api}>{children}</LinkCtx.Provider>;
}
