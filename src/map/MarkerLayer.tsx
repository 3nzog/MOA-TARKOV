import React, { useEffect, useMemo, useRef } from "react";
import { Marker } from "react-leaflet";
import L from "leaflet";
import type { TarkovTask, TaskObjective } from "../api/types";
import { getGameToLatLng } from "./mapDefs";
import {
  classifyMarker,
  GROUND_FLOOR_ID,
  type MapFloor,
} from "./floorClassify";
import { ALL_FLOORS } from "./FloorSwitcher";
import { MARKER_COLORS, QUEST_GLYPH_SVG } from "../poi/registry";

interface MarkerLayerProps {
  mapId: string;
  objectives: Array<{ task: TarkovTask; objective: TaskObjective }>;
  highlightedTaskId?: string | null;
  highlightedObjectiveId?: string | null;
  floors?: MapFloor[];
  activeFloorId?: string;
  onCounts?: (counts: Record<string, number>) => void;
  onHoverObjective?: (objectiveId: string | null) => void;
  onTogglePin?: (kind: "task" | "objective", id: string) => void;
  /** Quest ids ≥2 squadmates (incl. you) have active — pins get the shared-objective ring. */
  sharedQuestIds?: Set<string>;
  /** Objectives of quests the player can take but has not accepted: drawn dimmer. */
  upcoming?: Array<{ task: TarkovTask; objective: TaskObjective }>;
  /** Write the quest's name under each pin. */
  showNames?: boolean;
}

function resolvePosition(
  objective: TaskObjective,
  mapId: string,
): { x: number; y: number; z: number } | null {
  const zoneWithPos = objective.zones?.find(
    (z) => z.map?.id === mapId && z.position,
  );
  if (zoneWithPos?.position) {
    const p = zoneWithPos.position;
    return { x: p.x, y: p.y, z: p.z };
  }

  const locWithPositions = objective.possibleLocations?.find(
    (pl) => pl.map.id === mapId && pl.positions && pl.positions.length > 0,
  );
  if (locWithPositions?.positions?.[0]) {
    const p = locWithPositions.positions[0];
    return { x: p.x, y: p.y, z: p.z };
  }

  return null;
}

// Quest objective markers: a single yellow (Y) scroll glyph for every objective
// type (Moacir's spec). Same colored-glyph + dark-outline treatment as POI
// markers (.tc-poi-glyph in App.css). Highlight state is applied via a CSS class
// on the marker's DOM element, not by swapping the icon — Leaflet's setIcon
// replaces the DOM element, and if that swap lands between mousedown and mouseup,
// the browser drops the click event. Keeping the DOM stable lets click fire.
const QUEST_GLYPH_SIZE = 22;
// One icon per (quest name, upcoming, label shown): built once and reused, so
// a re-render never swaps the marker's DOM.
const iconCache = new Map<string, L.DivIcon>();
function getIcon(name: string | null, upcoming: boolean): L.DivIcon {
  const key = `${name ?? ""}|${upcoming ? 1 : 0}`;
  let icon = iconCache.get(key);
  if (icon) return icon;
  const label = name ? `<span class="tc-quest-label">${name.replace(/[<>&"]/g, "")}</span>` : "";
  icon = L.divIcon({
    className: upcoming ? "tc-marker tc-quest-upcoming" : "tc-marker",
    iconSize: [QUEST_GLYPH_SIZE, QUEST_GLYPH_SIZE],
    iconAnchor: [QUEST_GLYPH_SIZE / 2, QUEST_GLYPH_SIZE / 2],
    html: `<div class="tc-poi-glyph" style="color:${upcoming ? "#9fb7cf" : MARKER_COLORS.Y}">${QUEST_GLYPH_SVG}</div>${label}`,
  });
  iconCache.set(key, icon);
  return icon;
}

interface ClassifiedMarker {
  task: TarkovTask;
  objective: TaskObjective;
  latLng: [number, number];
  floorId: string;
  /** Not accepted yet, but open to the player (prerequisites and level met). */
  upcoming: boolean;
}

function ObjectiveMarker({
  m,
  highlighted,
  offFloor,
  shared,
  onHoverObjective,
  onTogglePin,
  showName,
}: {
  m: ClassifiedMarker;
  highlighted: boolean;
  offFloor: boolean;
  shared: boolean;
  showName: boolean;
  onHoverObjective?: (id: string | null) => void;
  onTogglePin?: (kind: "task" | "objective", id: string) => void;
}): React.JSX.Element {
  const markerRef = useRef<L.Marker | null>(null);

  // Apply highlight + off-floor + shared state as classes on the live DOM — no
  // setIcon, no DOM swap (which would drop clicks landing between
  // mousedown/mouseup).
  useEffect(() => {
    const el = markerRef.current?.getElement();
    if (!el) return;
    el.classList.toggle("tc-hl", highlighted);
    el.classList.toggle("tc-marker-offfloor", offFloor);
    el.classList.toggle("tc-shared", shared);
  }, [highlighted, offFloor, shared]);

  return (
    <Marker
      ref={markerRef}
      position={m.latLng as L.LatLngExpression}
      icon={getIcon(showName ? m.task.name : null, m.upcoming)}
      eventHandlers={{
        mouseover: () => onHoverObjective?.(m.objective.id),
        mouseout: () => onHoverObjective?.(null),
        click: () => onTogglePin?.("objective", m.objective.id),
      }}
    />
  );
}

export default function MarkerLayer({
  mapId,
  objectives,
  highlightedTaskId,
  highlightedObjectiveId,
  floors,
  activeFloorId = ALL_FLOORS,
  onCounts,
  onHoverObjective,
  onTogglePin,
  sharedQuestIds,
  upcoming,
  showNames = false,
}: MarkerLayerProps): React.JSX.Element {
  // getGameToLatLng returns a fresh closure each call; memoize per-map so it
  // doesn't invalidate the `classified`/`counts` memos every render, which
  // otherwise made the onCounts effect fire on every render → setFloorCounts →
  // re-render → infinite loop ("Maximum update depth exceeded").
  const toLatLng = useMemo(() => getGameToLatLng(mapId), [mapId]);

  const classified = useMemo<ClassifiedMarker[]>(() => {
    if (!toLatLng) return [];
    const all = [
      ...objectives.map((o) => ({ ...o, upcoming: false })),
      ...(upcoming ?? []).map((o) => ({ ...o, upcoming: true })),
    ];
    return all
      .map(({ task, objective, upcoming: isUpcoming }) => {
        const pos = resolvePosition(objective, mapId);
        if (!pos) return null;
        const floorId =
          floors && floors.length > 0
            ? classifyMarker(pos.x, pos.y, pos.z, floors)
            : GROUND_FLOOR_ID;
        return {
          task,
          objective,
          latLng: toLatLng(pos.x, pos.z),
          floorId,
          upcoming: isUpcoming,
        };
      })
      .filter((m): m is ClassifiedMarker => m !== null);
  }, [objectives, upcoming, mapId, floors, toLatLng]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { [ALL_FLOORS]: classified.length };
    if (floors) {
      for (const f of floors) c[f.id] = 0;
      for (const m of classified) {
        c[m.floorId] = (c[m.floorId] ?? 0) + 1;
      }
    }
    return c;
  }, [classified, floors]);

  useEffect(() => {
    onCounts?.(counts);
  }, [counts, onCounts]);

  return (
    <>
      {classified.map((m) => {
        // Off-floor markers are dimmed (not hidden) so cross-floor objectives
        // still read as "there, but on another level". "All" = nothing dimmed.
        const offFloor =
          activeFloorId !== ALL_FLOORS && m.floorId !== activeFloorId;
        const highlighted = highlightedObjectiveId
          ? highlightedObjectiveId === m.objective.id
          : highlightedTaskId === m.task.id;

        return (
          <ObjectiveMarker
            key={`${m.task.id}-${m.objective.id}-${m.upcoming ? "u" : "a"}`}
            m={m}
            highlighted={highlighted}
            offFloor={offFloor}
            shared={sharedQuestIds?.has(m.task.id) ?? false}
            onHoverObjective={onHoverObjective}
            onTogglePin={onTogglePin}
            showName={showNames}
          />
        );
      })}
    </>
  );
}
