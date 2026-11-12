// The modding table itself: the assembled gun in the middle, every slot as a
// cell above or below it, lined up with where that part sits on the gun and
// joined to it by a thin wire. Clicking a cell opens its part list right there.
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { itemGrid, itemImage, itemName, slotLabel, type WeaponLocale } from './data';
import type { SlotRow } from './build';

// Where along the gun (0 = butt, 1 = muzzle) and on which side a slot's part
// usually sits. Nested slots use their own kind. The pictures show the gun
// muzzle-LEFT, so anchorOf() mirrors these onto the image.
const ANCHORS: [RegExp, number, 'top' | 'bottom'][] = [
  [/muzzle|silencer/, 0.97, 'top'],
  [/barrel/, 0.84, 'bottom'],
  [/gas_block/, 0.76, 'top'],
  [/launcher/, 0.78, 'bottom'],
  [/foregrip|bipod/, 0.7, 'bottom'],
  [/tactical|flashlight/, 0.66, 'bottom'],
  [/handguard/, 0.68, 'top'],
  [/sight_front/, 0.84, 'top'],
  [/scope|mount|sight/, 0.52, 'top'],
  [/reciever|receiver|dust_cover/, 0.46, 'top'],
  [/charge/, 0.36, 'top'],
  [/magazine|mag/, 0.52, 'bottom'],
  [/pistol_?grip/, 0.38, 'bottom'],
  [/stock|butt|buffer/, 0.14, 'bottom'],
  [/catch|trigger|hammer|camora|chamber/, 0.44, 'bottom'],
];

function anchorOf(slot: string): { x: number; side: 'top' | 'bottom' } {
  for (const [re, x, side] of ANCHORS) if (re.test(slot)) return { x: 1 - x, side };
  return { x: 0.5, side: 'top' };
}

interface Cell extends SlotRow {
  x: number;
  side: 'top' | 'bottom';
}

interface Placed {
  left: number;
  top: number;
}

interface Wire {
  path: string;
  d: string;
  ax: number;
  ay: number;
}

const GAP = 6;
const EDGE = 10;

export default function BenchStage({
  rows,
  loc,
  gunImageId,
  gunName,
  selected,
  onSelect,
  ok,
  popover,
}: {
  rows: SlotRow[];
  loc: WeaponLocale;
  /** Item whose picture shows the gun (the factory preset = assembled). */
  gunImageId: string;
  gunName: string;
  selected: string | null;
  onSelect: (path: string | null) => void;
  /** Whether the player can get this item now. */
  ok: (itemId: string) => boolean;
  /** The part list for the selected slot. */
  popover: ReactNode;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const gunRef = useRef<HTMLImageElement>(null);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  const [placed, setPlaced] = useState<Record<string, Placed>>({});
  const [wires, setWires] = useState<Wire[]>([]);
  const [pop, setPop] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const [gunBroken, setGunBroken] = useState(false);
  const [gunLoaded, setGunLoaded] = useState(0);
  // Height taken by the slot rows above and below; the gun fills the space between.
  const [bands, setBands] = useState({ top: 110, bottom: 110 });

  // A nested slot sits where its parent part does, nudged by its own kind.
  const cells: Cell[] = rows.map((r) => {
    const own = anchorOf(r.slot);
    if (r.depth === 0) return { ...r, ...own };
    const root = anchorOf(r.path.split('/')[0]);
    return { ...r, x: Math.max(0.03, Math.min(0.97, root.x + (own.x - 0.5) * 0.3)), side: own.side };
  });

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const W = stage.clientWidth;
      const H = stage.clientHeight;
      const s = stage.getBoundingClientRect();
      // The picture's drawn box inside its object-fit: contain element.
      const img = gunRef.current;
      let gx = W * 0.15;
      let gy = H * 0.38;
      let gw = W * 0.7;
      let gh = H * 0.24;
      if (img && img.naturalWidth) {
        const r = img.getBoundingClientRect();
        const k = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
        gw = img.naturalWidth * k;
        gh = img.naturalHeight * k;
        gx = r.left - s.left + (r.width - gw) / 2;
        gy = r.top - s.top + (r.height - gh) / 2;
      }

      // Each side in as few rows as fit (cells dealt out in turn, so every row
      // spans the gun), each cell as close above/below its anchor as the
      // others allow: pushed right past its neighbour, then back left from the edge.
      const next: Record<string, Placed> = {};
      const wiresNext: Wire[] = [];
      const bandOf: Record<'top' | 'bottom', number> = { top: 0, bottom: 0 };
      for (const side of ['top', 'bottom'] as const) {
        const list = cells
          .filter((c) => c.side === side)
          .sort((a, b) => a.x - b.x)
          .map((c) => {
            const el = cellRefs.current.get(c.path);
            return { c, w: el?.offsetWidth ?? 76, h: el?.offsetHeight ?? 84 };
          });
        if (list.length === 0) continue;
        const rowH = Math.max(...list.map((i) => i.h));
        const total = list.reduce((sum, i) => sum + i.w + GAP, 0);
        const nRows = Math.min(3, Math.max(1, Math.ceil(total / (W - 2 * EDGE))));
        bandOf[side] = EDGE + nRows * rowH + (nRows - 1) * GAP;
        for (let row = 0; row < nRows; row++) {
          const inRow = list.filter((_, i) => i % nRows === row);
          const lefts = inRow.map((i) => gx + gw * i.c.x - i.w / 2);
          for (let i = 0; i < inRow.length; i++) {
            lefts[i] = Math.max(EDGE, lefts[i], i ? lefts[i - 1] + inRow[i - 1].w + GAP : EDGE);
          }
          for (let i = inRow.length - 1; i >= 0; i--) {
            const limit = i < inRow.length - 1 ? lefts[i + 1] - GAP - inRow[i].w : W - EDGE - inRow[i].w;
            lefts[i] = Math.max(EDGE, Math.min(lefts[i], limit));
          }
          inRow.forEach((it, i) => {
            const top = side === 'top' ? EDGE + row * (rowH + GAP) : H - EDGE - (row + 1) * rowH - row * GAP;
            next[it.c.path] = { left: lefts[i], top };
            const ax = gx + gw * it.c.x;
            const ay = gy + gh * (side === 'top' ? 0.36 : 0.64);
            const x1 = lefts[i] + it.w / 2;
            const y1 = side === 'top' ? top + it.h : top;
            // Down (or up) from the cell, across, then into the gun.
            const lane = side === 'top' ? bandOf.top + 6 + (i % 4) * 4 : H - bandOf.bottom - 6 - (i % 4) * 4;
            wiresNext.push({ path: it.c.path, d: `M${x1},${y1} L${x1},${lane} L${ax},${lane} L${ax},${ay}`, ax, ay });
          });
        }
      }
      setBands((cur) => (cur.top === bandOf.top && cur.bottom === bandOf.bottom ? cur : { top: bandOf.top, bottom: bandOf.bottom }));
      setPlaced(next);
      setWires(wiresNext);

      const selPlace = selected ? next[selected] : null;
      const selCell = cells.find((c) => c.path === selected);
      const selEl = selected ? cellRefs.current.get(selected) : null;
      if (selPlace && selCell && selEl) {
        const left = Math.max(EDGE, Math.min(selPlace.left - 8, W - 390));
        setPop(
          selCell.side === 'top'
            ? { left, top: selPlace.top + selEl.offsetHeight + 8 }
            : { left, bottom: H - selPlace.top + 8 },
        );
      } else setPop(null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
    // `cells` is rebuilt from rows each render; rows, selection and the picture cover it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selected, gunBroken, gunLoaded, bands]);

  const cell = (c: Cell) => {
    const name = c.itemId ? itemName(loc, c.itemId) : null;
    const at = placed[c.path];
    const style: CSSProperties = at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: 'hidden' };
    return (
      <button
        key={c.path}
        ref={(el) => {
          if (el) cellRefs.current.set(c.path, el);
          else cellRefs.current.delete(c.path);
        }}
        type="button"
        style={style}
        className={[
          'gs-cell',
          c.itemId ? '' : 'is-empty',
          c.required && !c.itemId ? 'is-required' : '',
          selected === c.path ? 'is-on' : '',
          c.depth > 0 ? 'is-nested' : '',
        ].join(' ')}
        title={name ? `${slotLabel(loc, c.slot)}: ${name}` : slotLabel(loc, c.slot)}
        onClick={() => onSelect(selected === c.path ? null : c.path)}
      >
        <span className="gs-cell__label">{slotLabel(loc, c.slot)}</span>
        <span className="gs-cell__box">
          {c.itemId ? <CellImage key={c.itemId} id={c.itemId} /> : <span className="gs-cell__plus">+</span>}
          {c.itemId && <span className={`gs-cell__dot ${ok(c.itemId) ? 'is-ok' : 'is-locked'}`} />}
        </span>
      </button>
    );
  };

  return (
    <div className="gs-stage" ref={stageRef} onMouseDown={(e) => e.target === e.currentTarget && onSelect(null)}>
      <div className="gs-gunwrap" style={{ top: bands.top + 34, bottom: bands.bottom + 34 }}>
        {gunBroken ? (
          <div className="gs-gun-fallback">{gunName}</div>
        ) : (
          <img
            ref={gunRef}
            className="gs-gunimg"
            src={itemImage(gunImageId)}
            alt={gunName}
            onLoad={() => setGunLoaded((n) => n + 1)}
            onError={() => setGunBroken(true)}
          />
        )}
      </div>
      <svg className="gs-wires" aria-hidden="true">
        {wires.map((w) => (
          <g key={w.path} className={selected === w.path ? 'is-on' : ''}>
            <path d={w.d} />
            <circle cx={w.ax} cy={w.ay} r={3} />
          </g>
        ))}
      </svg>
      {cells.map(cell)}
      {pop && (
        <div className="gs-pop" style={{ left: pop.left, top: pop.top, bottom: pop.bottom }}>
          {popover}
        </div>
      )}
    </div>
  );
}

function CellImage({ id }: { id: string }) {
  const [src, setSrc] = useState(itemGrid(id));
  return <img className="gs-cell__img" src={src} alt="" loading="lazy" onError={() => setSrc(`https://assets.tarkov.dev/${id}-icon.webp`)} />;
}
