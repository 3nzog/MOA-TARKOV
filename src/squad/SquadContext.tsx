// Squad state for the whole app. A single <SquadProvider> owns one transport +
// the live squad state (roster, per-member positions/quests/markers/draws), and
// exposes actions via useSquad(). The provider dispatches decoded envelopes by
// kind into immutable state updates.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { SquadCtx } from "./useSquad";
import { getRelayUrl } from "./config";
import {
  lastPartyHosts,
  partyFind,
  partyHostStart,
  partyHostStop,
  rememberPartyHost,
  shouldYieldTo,
} from "./partyApi";
import { isLinkedViewer } from "../link/linkApi";
import { useMirroredState, usePublishState } from "../link/linkState";
import { useLink } from "../link/useLink";
import { parseSquadSnapshot } from "./squadSnapshot";
import { netLog } from "../net/netApi";
import { SquadTransport, type ConnStatus } from "./transport";
import { loadIdentity, saveIdentity, type SquadIdentity } from "./identity";
import { getSelfSymbol, useSelfSymbol } from "./symbols";
import type {
  AnyEnvelope,
  SquadMember,
  PositionPayload,
  WireMarker,
  DrawPayload,
} from "../../shared/squadProtocol";

export interface MemberPosition {
  payload: PositionPayload;
  ts: number; // client receive time — drives staleness + the fresh-update flash
}

export interface SquadState {
  status: ConnStatus;
  code: string | null;
  selfId: string | null;
  selfColorId: string | null;
  members: SquadMember[]; // roster, including self
  positions: Record<string, MemberPosition>; // by member id (others only)
  quests: Record<string, string[]>; // active quest ids by member id
  markers: Record<string, WireMarker[]>; // shared markers by member id
  draws: Record<string, DrawPayload[]>; // shared drawings by member id
  error: string | null;
}

const EMPTY: SquadState = {
  status: "idle",
  code: null,
  selfId: null,
  selfColorId: null,
  members: [],
  positions: {},
  quests: {},
  markers: {},
  draws: {},
  error: null,
};

export interface SquadApi extends SquadState {
  inSquad: boolean;
  /** This PC is a linked extra screen showing the game PC's party (it did not join it). */
  mirrored: boolean;
  identity: SquadIdentity;
  createSquad: (name: string, colorId: string | null) => void;
  joinSquad: (code: string, name: string, colorId: string | null) => void;
  /** Automatic party on the Radmin network: join whoever hosts, else host. */
  joinParty: (name: string, colorId: string | null) => void;
  /** Join the party hosted at this Radmin address (when the automatic search finds nobody). */
  joinPartyAt: (ip: string, name: string, colorId: string | null) => void;
  /** In an automatic party: whether this PC hosts it. null = not in one. */
  partyRole: "host" | "guest" | null;
  /** Non-fatal party notice (e.g. the firewall prompt was declined). */
  partyNotice: string | null;
  leaveSquad: () => void;
  /** Abort an in-flight connect/reconnect (Cancel button) and reset to idle. */
  cancelConnect: () => void;
  saveProfile: (name: string, colorId: string | null) => void;
  broadcastPosition: (p: PositionPayload) => void;
  broadcastQuests: (ids: string[]) => void;
  addMarker: (m: WireMarker) => void;
  removeMarker: (id: string) => void;
  addDraw: (d: DrawPayload) => void;
  removeDraw: (id: string) => void;
  // Local view pref (NOT synced): hide a member's quest pins on the map. Keyed
  // by member id; self id is allowed too (hides your own quest markers).
  hiddenQuests: Record<string, boolean>;
  toggleQuestVisibility: (memberId: string) => void;
}

// Errors that mean "this join attempt is dead" — stop trying and reset.
const FATAL = new Set<string>([
  "bad_code",
  "squad_full",
  "name_required",
  "protocol_mismatch",
]);

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
}

function omit<T>(rec: Record<string, T>, key: string): Record<string, T> {
  if (!(key in rec)) return rec;
  const next = { ...rec };
  delete next[key];
  return next;
}

export function SquadProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  // The party's Rust error codes, worded for the player.
  const partyError = useCallback(
    (code: string) => {
      netLog(`party: erro ${code}`);
      switch (code) {
        case "no_radmin":
        case "no_network":
          return t("squad.party.noNetwork");
        case "lan_public":
          return t("squad.party.lanPublic");
        case "port_busy":
          return t("squad.party.portBusy");
        default:
          return t("squad.party.failed");
      }
    },
    [t],
  );
  const [state, setState] = useState<SquadState>(EMPTY);
  const [identity, setIdentityState] = useState<SquadIdentity>(() => loadIdentity());
  const [hiddenQuests, setHiddenQuests] = useState<Record<string, boolean>>({});

  const transportRef = useRef<SquadTransport | null>(null);
  const [partyRole, setPartyRole] = useState<"host" | "guest" | null>(null);
  const [partyNotice, setPartyNotice] = useState<string | null>(null);
  // This PC's id while hosting (for the two-hosts tie-break).
  const hostIdRef = useRef<string>("");
  const partyBusyRef = useRef(false);
  // identityRef mirrors the latest identity for the connect/setIdentity
  // callbacks, which read it outside render — sync it after each commit.
  const identityRef = useRef<SquadIdentity>(identity);
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);
  // Which action is in flight, so a connect-timeout error speaks the right
  // language: a create has no code to "check", a join does.
  const lastConnectModeRef = useRef<"create" | "join">("join");
  // The texts in the language of the moment, read by the transport's callbacks
  // (the transport itself is not rebuilt, and the link not cut, when it changes).
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // Our own latest broadcast state — kept so we can resync to a peer who joins
  // after us (the relay never replays anything sent before they arrived).
  const selfPos = useRef<PositionPayload | null>(null);
  const selfQuests = useRef<string[] | null>(null);
  const selfMarkers = useRef<Map<string, WireMarker>>(new Map());
  const selfDraws = useRef<Map<string, DrawPayload>>(new Map());

  const resyncSelf = useCallback(() => {
    const transport = transportRef.current;
    if (!transport) return;
    if (selfPos.current) transport.send("position", selfPos.current);
    if (selfQuests.current) transport.send("quests", { activeQuestIds: selfQuests.current });
    for (const m of selfMarkers.current.values()) transport.send("marker-add", m);
    for (const d of selfDraws.current.values()) transport.send("draw-add", d);
  }, []);

  const resetSelf = useCallback(() => {
    selfPos.current = null;
    selfQuests.current = null;
    selfMarkers.current.clear();
    selfDraws.current.clear();
  }, []);

  const handleMessage = useCallback(
    (env: AnyEnvelope) => {
      switch (env.kind) {
        case "joined":
          setState((s) => ({
            ...s,
            status: "connected",
            code: env.payload.code,
            selfId: env.payload.selfId,
            selfColorId: env.payload.colorId,
            members: env.payload.members,
            error: null,
          }));
          resyncSelf();
          break;
        case "peer-join":
          setState((s) => ({ ...s, members: upsert(s.members, env.payload.member) }));
          // The newcomer can't see anything we sent before they arrived — resend.
          resyncSelf();
          break;
        case "peer-leave": {
          const id = env.payload.id;
          setState((s) => ({
            ...s,
            members: s.members.filter((m) => m.id !== id),
            positions: omit(s.positions, id),
            quests: omit(s.quests, id),
            markers: omit(s.markers, id),
            draws: omit(s.draws, id),
          }));
          break;
        }
        case "position": {
          const from = env.from;
          const payload = env.payload;
          setState((s) => ({
            ...s,
            positions: { ...s.positions, [from]: { payload, ts: Date.now() } },
          }));
          break;
        }
        case "quests": {
          const from = env.from;
          const ids = env.payload.activeQuestIds;
          setState((s) => ({ ...s, quests: { ...s.quests, [from]: ids } }));
          break;
        }
        case "marker-add": {
          const from = env.from;
          const marker = env.payload;
          setState((s) => ({
            ...s,
            markers: { ...s.markers, [from]: upsert(s.markers[from] ?? [], marker) },
          }));
          break;
        }
        case "marker-remove": {
          const from = env.from;
          const rid = env.payload.id;
          setState((s) => ({
            ...s,
            markers: { ...s.markers, [from]: (s.markers[from] ?? []).filter((m) => m.id !== rid) },
          }));
          break;
        }
        case "draw-add": {
          const from = env.from;
          const draw = env.payload;
          setState((s) => ({
            ...s,
            draws: { ...s.draws, [from]: upsert(s.draws[from] ?? [], draw) },
          }));
          break;
        }
        case "draw-remove": {
          const from = env.from;
          const did = env.payload.id;
          setState((s) => ({
            ...s,
            draws: { ...s.draws, [from]: (s.draws[from] ?? []).filter((d) => d.id !== did) },
          }));
          break;
        }
        case "error": {
          const { code, message } = env.payload;
          if (FATAL.has(code)) {
            transportRef.current?.close();
            resetSelf();
            setHiddenQuests({});
            setState({ ...EMPTY, error: message });
          } else {
            setState((s) => ({ ...s, error: message }));
          }
          break;
        }
      }
    },
    [resyncSelf, resetSelf],
  );

  // Create the transport once.
  useEffect(() => {
    // Read once: changing the relay in Settings reloads the window.
    const transport = new SquadTransport(getRelayUrl(), {
      onStatus: (status) =>
        setState((s) => ({
          ...s,
          status,
          // The transport gives up to "error" when an initial join never lands —
          // surface a plain-language reason. Clear stale errors once we're
          // making progress again.
          error:
            status === "error" && !s.error
              ? lastConnectModeRef.current === "create"
                ? tRef.current('errors.squadServerOffline')
                : tRef.current('errors.squadUnreachable')
              : status === "connecting" || status === "connected"
                ? null
                : s.error,
        })),
      onMessage: handleMessage,
    });
    transportRef.current = transport;
    return () => {
      transport.close();
      transportRef.current = null;
    };
  }, [handleMessage]);

  const persist = useCallback((name: string, colorId: string | null) => {
    const next: SquadIdentity = { clientId: identityRef.current.clientId, name, colorId };
    identityRef.current = next;
    setIdentityState(next);
    saveIdentity(next);
  }, []);

  const connectTo = useCallback(
    (url: string, code: string | null, name: string, colorId: string | null) => {
      lastConnectModeRef.current = code === null ? "create" : "join";
      persist(name, colorId);
      resetSelf();
      setState({ ...EMPTY, status: "connecting" });
      transportRef.current?.connect(
        {
          code,
          name,
          colorId,
          clientId: identityRef.current.clientId,
        },
        url,
      );
    },
    [persist, resetSelf],
  );

  const startConnect = useCallback(
    (code: string | null, name: string, colorId: string | null) => {
      setPartyRole(null);
      connectTo(getRelayUrl(), code, name, colorId);
    },
    [connectTo],
  );

  const joinParty = useCallback(
    async (name: string, colorId: string | null) => {
      if (partyBusyRef.current) return;
      partyBusyRef.current = true;
      persist(name, colorId);
      resetSelf();
      setPartyNotice(null);
      setState({ ...EMPTY, status: "connecting" });
      try {
        const found = await partyFind(lastPartyHosts());
        if (found) {
          rememberPartyHost(found.host);
          setPartyRole("guest");
          connectTo(`ws://${found.host}:${found.port}`, found.room, name, colorId);
          return;
        }
        // Nobody is hosting: this PC becomes the host.
        const host = await partyHostStart();
        hostIdRef.current = host.id;
        if (!host.firewall) setPartyNotice(t("squad.party.firewallDeclined"));
        setPartyRole("host");
        connectTo(`ws://127.0.0.1:${host.port}`, null, name, colorId);
      } catch (e) {
        const code = String(e);
        setPartyRole(null);
        setState({
          ...EMPTY,
          error: partyError(code),
        });
      } finally {
        partyBusyRef.current = false;
      }
    },
    [connectTo, partyError, persist, resetSelf, t],
  );
  const joinPartyAt = useCallback(
    async (ip: string, name: string, colorId: string | null) => {
      if (partyBusyRef.current) return;
      partyBusyRef.current = true;
      persist(name, colorId);
      resetSelf();
      setPartyNotice(null);
      setState({ ...EMPTY, status: "connecting" });
      try {
        const found = await partyFind([ip.trim()], 2500);
        if (!found) {
          setState({ ...EMPTY, error: t("squad.party.notAtIp", { ip: ip.trim() }) });
          return;
        }
        rememberPartyHost(found.host);
        setPartyRole("guest");
        connectTo(`ws://${found.host}:${found.port}`, found.room, name, colorId);
      } catch (e) {
        setPartyRole(null);
        setState({ ...EMPTY, error: partyError(String(e)) });
      } finally {
        partyBusyRef.current = false;
      }
    },
    [connectTo, partyError, persist, resetSelf, t],
  );
  const joinPartyRef = useRef(joinParty);
  useEffect(() => {
    joinPartyRef.current = joinParty;
  }, [joinParty]);

  // The host left (or their PC went away): look again — someone else hosts.
  useEffect(() => {
    if (partyRole !== "guest") return;
    if (state.status !== "reconnecting" && state.status !== "error") return;
    const timer = window.setTimeout(
      () => {
        transportRef.current?.close();
        const { name, colorId } = identityRef.current;
        if (name) void joinPartyRef.current(name, colorId);
      },
      state.status === "error" ? 500 : 6000,
    );
    return () => window.clearTimeout(timer);
  }, [partyRole, state.status]);

  // Two players clicked at the same moment and both host: while alone, keep
  // asking; the host with the higher address joins the other one.
  const alone = state.members.length <= 1;
  useEffect(() => {
    if (partyRole !== "host" || state.status !== "connected" || !alone) return;
    const id = window.setInterval(() => {
      void (async () => {
        const found = await partyFind([], 800).catch(() => null);
        if (!found || !shouldYieldTo(found, hostIdRef.current)) return;
        transportRef.current?.close();
        await partyHostStop().catch(() => undefined);
        rememberPartyHost(found.host);
        setPartyRole("guest");
        const { name, colorId } = identityRef.current;
        connectTo(`ws://${found.host}:${found.port}`, found.room, name, colorId);
      })();
    }, 7000);
    return () => window.clearInterval(id);
  }, [partyRole, state.status, alone, connectTo]);

  const createSquad = useCallback(
    (name: string, colorId: string | null) => startConnect(null, name, colorId),
    [startConnect],
  );

  const joinSquad = useCallback(
    (code: string, name: string, colorId: string | null) => startConnect(code, name, colorId),
    [startConnect],
  );

  const leaveSquad = useCallback(() => {
    transportRef.current?.close();
    // Leaving as host ends the party here; the others look again and one of them hosts.
    setPartyRole((role) => {
      if (role === "host") void partyHostStop().catch(() => undefined);
      return null;
    });
    setPartyNotice(null);
    resetSelf();
    setHiddenQuests({});
    setState(EMPTY);
  }, [resetSelf]);

  const toggleQuestVisibility = useCallback((memberId: string) => {
    setHiddenQuests((h) => ({ ...h, [memberId]: !h[memberId] }));
  }, []);

  const saveProfile = useCallback(
    (name: string, colorId: string | null) => persist(name, colorId),
    [persist],
  );

  const broadcastPosition = useCallback((p: PositionPayload) => {
    // An extra screen replays the game PC's position; the game PC sends it.
    if (isLinkedViewer()) return;
    const withSymbol = { ...p, symbol: getSelfSymbol() };
    selfPos.current = withSymbol;
    transportRef.current?.send("position", withSymbol);
  }, []);

  // A new symbol reaches the squad at once, not only with the next screenshot.
  const selfSymbol = useSelfSymbol();
  useEffect(() => {
    const p = selfPos.current;
    if (!p || p.symbol === selfSymbol) return;
    selfPos.current = { ...p, symbol: selfSymbol };
    transportRef.current?.send("position", selfPos.current);
  }, [selfSymbol]);

  const broadcastQuests = useCallback((ids: string[]) => {
    if (isLinkedViewer()) return;
    selfQuests.current = ids;
    transportRef.current?.send("quests", { activeQuestIds: ids });
  }, []);

  const addMarker = useCallback((m: WireMarker) => {
    selfMarkers.current.set(m.id, m);
    transportRef.current?.send("marker-add", m);
  }, []);

  const removeMarker = useCallback((id: string) => {
    selfMarkers.current.delete(id);
    transportRef.current?.send("marker-remove", { id });
  }, []);

  const addDraw = useCallback((d: DrawPayload) => {
    selfDraws.current.set(d.id, d);
    transportRef.current?.send("draw-add", d);
  }, []);

  const removeDraw = useCallback((id: string) => {
    selfDraws.current.delete(id);
    transportRef.current?.send("draw-remove", { id });
  }, []);

  // Linked extra screen: show the game PC's party as it is, without joining
  // (friends see nobody extra). The game PC publishes it; one way only.
  const link = useLink();
  const linkedViewer = link.client?.state === "linked";
  usePublishState("squad", state.code !== null ? state : null);
  const [mirror, setMirror] = useState<SquadState | null>(null);
  useMirroredState("squad", parseSquadSnapshot, (r) => setMirror(r.snap));
  const mirrored = linkedViewer && state.code === null && mirror !== null;
  const shown = mirrored ? mirror : state;

  const api = useMemo<SquadApi>(
    () => ({
      ...shown,
      inSquad: shown.code !== null,
      mirrored,
      identity,
      createSquad,
      joinSquad,
      joinParty: (name: string, colorId: string | null) => void joinParty(name, colorId),
      joinPartyAt: (ip: string, name: string, colorId: string | null) => void joinPartyAt(ip, name, colorId),
      partyRole,
      partyNotice,
      leaveSquad,
      cancelConnect: leaveSquad,
      saveProfile,
      broadcastPosition,
      broadcastQuests,
      addMarker,
      removeMarker,
      addDraw,
      removeDraw,
      hiddenQuests,
      toggleQuestVisibility,
    }),
    [
      shown,
      mirrored,
      identity,
      joinPartyAt,
      createSquad,
      joinSquad,
      joinParty,
      partyRole,
      partyNotice,
      leaveSquad,
      saveProfile,
      broadcastPosition,
      broadcastQuests,
      addMarker,
      removeMarker,
      addDraw,
      removeDraw,
      hiddenQuests,
      toggleQuestVisibility,
    ],
  );

  return <SquadCtx.Provider value={api}>{children}</SquadCtx.Provider>;
}
