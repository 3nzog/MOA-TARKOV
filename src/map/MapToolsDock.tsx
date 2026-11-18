// On-map drawing tools — dock floats over the map on the rail side, above the
// zoom dock. Two controls only (Moacir's spec): toggle the pen, and clear all
// your drawings on this map (the eraser icon — per-stroke erasing is gone).

import { PencilSimple, Eraser, Mountains, Cube } from "@phosphor-icons/react";
import { Toggle } from "../ui";
import { useTranslation } from "react-i18next";
import type { DrawTool } from "./DrawLayer";

interface MapToolsDockProps {
  tool: DrawTool;
  onTool: (t: DrawTool) => void;
  /** The local user's ink color (squad color when seated). */
  color: string;
  canClear: boolean;
  onClear: () => void;
  /** Textured relief map: available on this map, and on now. */
  reliefAvailable?: boolean;
  relief?: boolean;
  onRelief?: (on: boolean) => void;
  /** Hand-made 2D / 3D maps for this map (opens the viewer). */
  artCount?: number;
  onArt?: () => void;
  /** The raid route (most objectives before the raid ends): on, and its switch. */
  route?: boolean;
  onRoute?: (on: boolean) => void;
}

export default function MapToolsDock({
  tool,
  onTool,
  color,
  canClear,
  onClear,
  reliefAvailable = false,
  relief = false,
  onRelief,
  artCount = 0,
  onArt,
  route = false,
  onRoute,
}: MapToolsDockProps) {
  const { t } = useTranslation();
  const penOn = tool === "pen";
  return (
    <div className="tc-tools-dock">
      {onRoute && (
        // The routes' switch: on shows them, off turns them off.
        <div className="tc-tools-dock__switch" title={route ? t('route.hide') : t('route.show')}>
          <span>{t('route.switch')}</span>
          <Toggle size="sm" checked={route} onChange={onRoute} label={t('route.switch')} />
        </div>
      )}
      <button
        type="button"
        aria-label={t('rail.drawOnMap')}
        aria-pressed={penOn}
        title={penOn ? t('map.stopDrawing') : t('map.drawOnMapShared')}
        className={penOn ? "active" : undefined}
        style={penOn ? { color } : undefined}
        onClick={() => onTool(penOn ? null : "pen")}
      >
        <PencilSimple weight={penOn ? "fill" : "regular"} />
      </button>
      <button
        type="button"
        aria-label={t('rail.clearDrawings')}
        title={t('rail.clearDrawings')}
        disabled={!canClear}
        onClick={() => {
          onClear();
          // Erasing also drops you out of pen mode — the gesture means "I'm done
          // drawing", so panning is handed straight back.
          if (penOn) onTool(null);
        }}
      >
        <Eraser weight="regular" />
      </button>
      {onRelief && (
        <button
          type="button"
          aria-pressed={relief}
          disabled={!reliefAvailable}
          title={reliefAvailable ? (relief ? t('map.style.toVector') : t('map.style.toRelief')) : t('map.style.noRelief')}
          aria-label={t('map.style.relief')}
          className={relief && reliefAvailable ? "active" : undefined}
          onClick={() => onRelief(!relief)}
        >
          <Mountains weight={relief && reliefAvailable ? "fill" : "regular"} />
        </button>
      )}
      {onArt && (
        <button
          type="button"
          disabled={artCount === 0}
          title={artCount > 0 ? t('map.art.open', { count: artCount }) : t('map.art.none')}
          aria-label={t('map.art.button')}
          onClick={onArt}
        >
          <Cube weight="regular" />
        </button>
      )}
    </div>
  );
}
