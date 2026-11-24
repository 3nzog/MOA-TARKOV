// A party snapshot sent by a linked game PC (src/link/linkState.ts, key
// "squad"), checked before the extra screen shows it.
import type { SquadMember } from "../../shared/squadProtocol";
import type { SquadState } from "./SquadContext";

/** A party snapshot sent by a linked game PC, checked; null = none (not in a party). */
export function parseSquadSnapshot(raw: unknown): { snap: SquadState | null } | null {
  if (raw === null) return { snap: null };
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<SquadState>;
  const rec = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, never>) : {});
  if (!Array.isArray(r.members)) return null;
  return {
    snap: {
      error: null,
      status: "connected",
      code: typeof r.code === "string" ? r.code : "PARTY",
      selfId: typeof r.selfId === "string" ? r.selfId : null,
      selfColorId: typeof r.selfColorId === "string" ? r.selfColorId : null,
      members: r.members.filter((m): m is SquadMember => !!m && typeof m === "object" && typeof (m as SquadMember).id === "string"),
      positions: rec(r.positions),
      quests: rec(r.quests),
      markers: rec(r.markers),
      draws: rec(r.draws),
      links: rec(r.links),
    },
  };
}

