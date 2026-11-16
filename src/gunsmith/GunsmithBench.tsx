// The weapon bench: pick a gun, fit parts slot by slot like the in-game
// modding screen, see the stats move, and see where each part comes from for
// this player (trader loyalty levels, quests, flea, barters, crafts). Builds
// are saved as MoA presets.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowCounterClockwise,
  Copy,
  CopySimple,
  DownloadSimple,
  FloppyDisk,
  MagnifyingGlass,
  PencilSimple,
  Storefront,
  Trash,
  Warning,
  X,
} from '@phosphor-icons/react';
import { Button, HelpTip, IconButton, Input, Segmented, Select, Spinner, Toggle } from '../ui';
import {
  itemIcon,
  itemImage,
  itemName,
  itemShort,
  loadWeaponData,
  loadWeaponLocale,
  slotLabel,
  type WeaponData,
  type WeaponLocale,
} from './data';
import { buildStats, conflictsWith, equip, factoryBuild, missingRequired, slotTree, type Build } from './build';
import {
  availabilityLookup,
  effectiveAccess,
  isObtainable,
  maxLevelFor,
  partTraders,
  setTraderLevels,
  useTraderLevels,
  type Availability,
  type Source,
} from './availability';
import {
  createPreset,
  deletePreset,
  duplicatePreset,
  readShareCode,
  renamePreset,
  shareCode,
  updatePreset,
  usePresets,
} from './presets';
import BenchStage from './BenchStage';
import './gunsmith.css';

/** A stat as the modding screen shows it: a bar, the value, and the change from the factory build. */
function StatBar({
  label,
  value,
  base,
  max,
  lowerIsBetter,
  unit = '',
  digits = 1,
}: {
  label: string;
  value: number;
  base: number;
  max: number;
  lowerIsBetter?: boolean;
  unit?: string;
  digits?: number;
}) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const d = Math.round((value - base) * 10 ** digits) / 10 ** digits;
  const good = lowerIsBetter ? d < 0 : d > 0;
  return (
    <div className="gs-bar">
      <div className="gs-bar__top">
        <span>{label}</span>
        <strong>
          {Number.isInteger(value) ? value : value.toFixed(digits)}
          {unit}
          {d !== 0 && <em className={good ? 'gs-good' : 'gs-bad'}>{d > 0 ? ` +${d}` : ` ${d}`}</em>}
        </strong>
      </div>
      <div className="gs-bar__track">
        <span className="gs-bar__base" style={{ width: pct(base) }} />
        <span className={`gs-bar__fill ${d === 0 ? '' : good ? 'is-good' : 'is-bad'}`} style={{ width: pct(value) }} />
      </div>
    </div>
  );
}

const LAST_KEY = 'tc_gunsmith_last_v1';
const M4A1 = '5447a9cd4bdc2dbd208b4567';

type SortKey = 'recoil' | 'ergo' | 'price' | 'name';

interface Props {
  onClose: () => void;
  /** The player's level when they set it, else null (levels are then estimated as max). */
  playerLevel: number | null;
  taskDone: (taskId: string) => boolean;
}

function Icon({ id, alt, big }: { id: string; alt: string; big?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className={big ? 'gs-img gs-img--big gs-img--none' : 'gs-img gs-img--none'} aria-hidden="true" />;
  return (
    <img
      className={big ? 'gs-img gs-img--big' : 'gs-img'}
      src={big ? itemImage(id) : itemIcon(id)}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

export default function GunsmithBench({ onClose, playerLevel, taskDone }: Props) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<WeaponData | null>(null);
  const [loc, setLoc] = useState<WeaponLocale | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([loadWeaponData(), loadWeaponLocale(i18n.language)])
      .then(([d, l]) => {
        if (!alive) return;
        setData(d);
        setLoc(l);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [i18n.language]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="gs" role="dialog" aria-modal="true" aria-label={t('gunsmith.title')}>
      {!data || !loc ? (
        <div className="gs-loading">
          {failed ? <p>{t('gunsmith.loadFailed')}</p> : <Spinner size="lg" />}
          <Button variant="tertiary" onClick={onClose}>{t('gunsmith.close')}</Button>
        </div>
      ) : (
        <Bench data={data} loc={loc} onClose={onClose} playerLevel={playerLevel} taskDone={taskDone} />
      )}
    </div>
  );
}

function Bench({ data, loc, onClose, playerLevel, taskDone }: Props & { data: WeaponData; loc: WeaponLocale }) {
  const { t, i18n } = useTranslation();
  const money = useMemo(() => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }), [i18n.language]);
  const rub = (v: number) => `₽${money.format(v)}`;
  const savedLevels = useTraderLevels();
  const access = useMemo(
    () => effectiveAccess(data, savedLevels, playerLevel, taskDone),
    [data, savedLevels, playerLevel, taskDone],
  );
  const presets = usePresets();

  const [build, setBuild] = useState<Build>(() => {
    let id = M4A1;
    try {
      const last = localStorage.getItem(LAST_KEY);
      if (last && data.weapons[last]) id = last;
    } catch {
      /* storage unavailable */
    }
    return factoryBuild(data, data.weapons[id] ? id : Object.keys(data.weapons)[0]);
  });
  const [presetId, setPresetId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [onlyObtainable, setOnlyObtainable] = useState(true);
  const [sort, setSort] = useState<SortKey>('recoil');
  const [partSearch, setPartSearch] = useState('');
  const [gunSearch, setGunSearch] = useState('');
  const [tradersOpen, setTradersOpen] = useState(!savedLevels.set);
  const [notice, setNotice] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  // An imported preset is loaded once the preset store has it.
  const loadPresetLater = useRef<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(LAST_KEY, build.weaponId);
    } catch {
      /* storage unavailable */
    }
  }, [build.weaponId]);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(id);
  }, [notice]);

  const avail = useMemo(() => availabilityLookup(data, access), [data, access]);

  const rows = useMemo(() => slotTree(data, build), [data, build]);
  const stats = useMemo(() => buildStats(data, build), [data, build]);
  const missing = useMemo(() => missingRequired(data, build), [data, build]);
  const gun = data.weapons[build.weaponId];
  const gunName = itemName(loc, build.weaponId);
  const factory = useMemo(() => buildStats(data, factoryBuild(data, build.weaponId)), [data, build.weaponId]);

  const partIds = Object.values(build.parts);
  const cost = partIds.reduce((sum, id) => sum + (avail(id).cash ?? 0), 0);
  const unavailable = partIds.filter((id) => !isObtainable(avail(id)));
  const noCash = partIds.filter((id) => isObtainable(avail(id)) && avail(id).cash === null);
  const gunAvail = avail(build.weaponId);

  // ---- labels -------------------------------------------------------------
  const traderName = (id: string) => loc.traders[id] ?? id;
  const sourceLabel = (s: Source): string => {
    switch (s.kind) {
      case 'trader':
        return t('gunsmith.src.trader', { trader: traderName(s.trader), level: s.level, price: rub(s.price) });
      case 'barter':
        return t('gunsmith.src.barter', {
          trader: traderName(s.trader),
          level: s.level,
          items: s.items.map(([id, n]) => `${n}× ${itemShort(loc, id)}`).join(', '),
        });
      case 'craft':
        return t('gunsmith.src.craft', { station: loc.stations[s.station] ?? s.station, level: s.level });
      case 'flea':
        return t('gunsmith.src.flea', { price: rub(s.price) });
    }
  };
  const lockLabel = (l: Availability['locked'][number]): string => {
    const r = l.reason;
    if (r.why === 'flea') return t('gunsmith.lock.flea', { level: data.fleaMinLevel });
    if (r.why === 'task') return t('gunsmith.lock.task', { trader: 'trader' in l.source ? traderName(l.source.trader) : '' });
    return t('gunsmith.lock.level', { trader: 'trader' in l.source ? traderName(l.source.trader) : '', level: r.need });
  };
  const bestLabel = (a: Availability) =>
    a.open.length ? sourceLabel(a.open[0]) : a.locked.length ? lockLabel(a.locked[0]) : t('gunsmith.notSold');

  // ---- weapons list ---------------------------------------------------------
  const gunsByCat = useMemo(() => {
    const q = gunSearch.trim().toLowerCase();
    const groups = new Map<string, string[]>();
    for (const id of Object.keys(data.weapons)) {
      const n = itemName(loc, id);
      if (q && !n.toLowerCase().includes(q) && !itemShort(loc, id).toLowerCase().includes(q)) continue;
      const cat = data.weapons[id].cat ?? '';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(id);
    }
    for (const list of groups.values()) list.sort((a, b) => itemName(loc, a).localeCompare(itemName(loc, b)));
    return [...groups.entries()].sort((a, b) => (loc.cats[a[0]] ?? a[0]).localeCompare(loc.cats[b[0]] ?? b[0]));
  }, [data, loc, gunSearch]);

  const pickWeapon = (id: string) => {
    setBuild(factoryBuild(data, id));
    setPresetId(null);
    setName('');
    setSelected(null);
  };

  // ---- presets ---------------------------------------------------------------
  const rowsFor = (b: Build) => slotTree(data, b);
  const loadPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p || !data.weapons[p.weaponId]) return;
    // Drop parts the data no longer knows (a refresh renamed a slot, say).
    let b: Build = { weaponId: p.weaponId, parts: {} };
    for (const [path, item] of Object.entries(p.parts).sort((a, c) => a[0].split('/').length - c[0].split('/').length)) {
      if (rowsFor(b).some((r) => r.path === path && r.allowed.includes(item))) b = { ...b, parts: { ...b.parts, [path]: item } };
    }
    setBuild(b);
    setPresetId(p.id);
    setName(p.name);
    setSelected(null);
  };
  const save = () => {
    if (presetId && presets.some((p) => p.id === presetId)) {
      updatePreset(presetId, build, name);
      setNotice(t('gunsmith.saved'));
    } else {
      const p = createPreset(name || `${itemShort(loc, build.weaponId)} ${presets.length + 1}`, build);
      setPresetId(p.id);
      setName(p.name);
      setNotice(t('gunsmith.created'));
    }
  };
  const saveAsNew = () => {
    const p = createPreset(name ? t('gunsmith.copyName', { name }) : `${itemShort(loc, build.weaponId)} ${presets.length + 1}`, build);
    setPresetId(p.id);
    setName(p.name);
    setNotice(t('gunsmith.created'));
  };
  const copyCode = async () => {
    const code = shareCode(name || gunName, build);
    try {
      await navigator.clipboard.writeText(code);
      setNotice(t('gunsmith.codeCopied'));
    } catch {
      setImportText(code);
    }
  };
  const importCode = () => {
    const r = readShareCode(importText);
    if (!r || !data.weapons[r.build.weaponId]) {
      setNotice(t('gunsmith.badCode'));
      return;
    }
    const p = createPreset(r.name, r.build);
    setImportText('');
    loadPresetLater.current = p.id;
    setNotice(t('gunsmith.imported', { name: r.name }));
  };
  useEffect(() => {
    if (loadPresetLater.current && presets.some((p) => p.id === loadPresetLater.current)) {
      const id = loadPresetLater.current;
      loadPresetLater.current = null;
      loadPreset(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets]);

  // ---- part picker -------------------------------------------------------------
  const selRow = rows.find((r) => r.path === selected) ?? null;
  const candidates = useMemo(() => {
    if (!selRow) return [];
    const q = partSearch.trim().toLowerCase();
    const list = selRow.allowed
      .filter((id) => !q || itemName(loc, id).toLowerCase().includes(q))
      .map((id) => {
        const a = avail(id);
        const m = data.mods[id] ?? {};
        return { id, a, m, clash: conflictsWith(data, build, id, selRow.path) };
      })
      .filter((c) => !onlyObtainable || isObtainable(c.a) || c.id === selRow.itemId);
    const by: Record<SortKey, (x: (typeof list)[number], y: (typeof list)[number]) => number> = {
      recoil: (x, y) => (x.m.r ?? 0) - (y.m.r ?? 0) || (y.m.e ?? 0) - (x.m.e ?? 0),
      ergo: (x, y) => (y.m.e ?? 0) - (x.m.e ?? 0),
      price: (x, y) => (x.a.cash ?? Infinity) - (y.a.cash ?? Infinity),
      name: (x, y) => itemName(loc, x.id).localeCompare(itemName(loc, y.id)),
    };
    return list.sort((x, y) => Number(isObtainable(y.a)) - Number(isObtainable(x.a)) || by[sort](x, y));
  }, [selRow, partSearch, onlyObtainable, sort, avail, data, build, loc]);

  const fmtDelta = (v: number | undefined, pct = false) => {
    if (!v) return null;
    const n = pct ? Math.round(v * 1000) / 10 : Math.round(v * 10) / 10;
    return `${n > 0 ? '+' : ''}${n}${pct ? '%' : ''}`;
  };

  const traders = partTraders(data);

  return (
    <>
      <header className="gs-top">
        <div className="gs-title">
          <h2>{t('gunsmith.title')}</h2>
          <span className="gs-sub">{t('gunsmith.subtitle')}</span>
        </div>
        <div className="gs-preset-bar">
          <Input
            uiSize="sm"
            value={name}
            maxLength={60}
            placeholder={t('gunsmith.presetName')}
            aria-label={t('gunsmith.presetName')}
            onChange={(e) => setName(e.target.value)}
            icon={<PencilSimple />}
          />
          <Button size="sm" variant="primary" icon={<FloppyDisk weight="bold" />} onClick={save}>
            {presetId ? t('gunsmith.save') : t('gunsmith.saveNew')}
          </Button>
          {presetId && (
            <Button size="sm" icon={<CopySimple />} onClick={saveAsNew}>
              {t('gunsmith.saveAs')}
            </Button>
          )}
          <IconButton size="sm" icon={<Copy />} label={t('gunsmith.copyCode')} onClick={() => void copyCode()} />
          <IconButton
            size="sm"
            icon={<ArrowCounterClockwise />}
            label={t('gunsmith.factory')}
            onClick={() => {
              setBuild(factoryBuild(data, build.weaponId));
              setSelected(null);
            }}
          />
          <Button size="sm" variant={tradersOpen ? 'primary' : 'secondary'} icon={<Storefront />} onClick={() => setTradersOpen((v) => !v)}>
            {t('gunsmith.traders')}
          </Button>
        </div>
        <IconButton icon={<X weight="bold" />} label={t('gunsmith.close')} onClick={onClose} />
      </header>
      {notice && <div className="gs-notice" role="status">{notice}</div>}

      <div className="gs-body">
        {/* ---- left: presets + guns ---- */}
        <aside className="gs-col gs-left">
          <div className="gs-block">
            <div className="gs-block__title">{t('gunsmith.myPresets')}</div>
            {presets.length === 0 ? (
              <p className="gs-hint">{t('gunsmith.noPresets')}</p>
            ) : (
              <ul className="gs-presets">
                {presets.map((p) => (
                  <li key={p.id} className={p.id === presetId ? 'is-on' : ''}>
                    <button type="button" className="gs-preset" onClick={() => loadPreset(p.id)}>
                      <Icon id={p.weaponId} alt="" />
                      <span>
                        <strong>{p.name}</strong>
                        <small>{itemShort(loc, p.weaponId)}</small>
                      </span>
                    </button>
                    <span className="gs-preset__acts">
                      <IconButton
                        size="sm"
                        icon={<PencilSimple />}
                        label={t('gunsmith.rename')}
                        onClick={() => {
                          const n = window.prompt(t('gunsmith.rename'), p.name);
                          if (n) renamePreset(p.id, n);
                          if (n && p.id === presetId) setName(n.trim());
                        }}
                      />
                      <IconButton
                        size="sm"
                        icon={<CopySimple />}
                        label={t('gunsmith.duplicate')}
                        onClick={() => duplicatePreset(p.id, (n) => t('gunsmith.copyName', { name: n }))}
                      />
                      <IconButton
                        size="sm"
                        variant="danger"
                        icon={<Trash />}
                        label={t('gunsmith.delete')}
                        onClick={() => {
                          if (!window.confirm(t('gunsmith.deleteConfirm', { name: p.name }))) return;
                          deletePreset(p.id);
                          if (p.id === presetId) setPresetId(null);
                        }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="gs-import">
              <Input
                uiSize="sm"
                value={importText}
                placeholder={t('gunsmith.importPlaceholder')}
                aria-label={t('gunsmith.importPlaceholder')}
                onChange={(e) => setImportText(e.target.value)}
              />
              <IconButton size="sm" icon={<DownloadSimple />} label={t('gunsmith.importBtn')} onClick={importCode} disabled={!importText.trim()} />
            </div>
          </div>

          <div className="gs-block gs-block--grow">
            <div className="gs-block__title">{t('gunsmith.weapons')}</div>
            <Input
              uiSize="sm"
              value={gunSearch}
              placeholder={t('gunsmith.searchWeapon')}
              aria-label={t('gunsmith.searchWeapon')}
              icon={<MagnifyingGlass />}
              onChange={(e) => setGunSearch(e.target.value)}
            />
            <div className="gs-guns">
              {gunsByCat.map(([cat, ids]) => (
                <div key={cat}>
                  <div className="gs-cat">{loc.cats[cat] ?? cat}</div>
                  {ids.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={`gs-gun${id === build.weaponId ? ' is-on' : ''}`}
                      onClick={() => pickWeapon(id)}
                    >
                      <Icon id={id} alt="" />
                      <span>{itemName(loc, id)}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* ---- center: the modding table ---- */}
        <main className="gs-col gs-center">
          <div className="gs-stage-head">
            <h3>{gunName}</h3>
            <div className="gs-gun-card__meta">
              {gun?.cal && <span>{gun.cal}</span>}
              {gun?.fr ? <span>{t('gunsmith.rpm', { n: gun.fr })}</span> : null}
              <span className={isObtainable(gunAvail) ? 'gs-ok' : 'gs-locked'}>{bestLabel(gunAvail)}</span>
            </div>
          </div>
          <BenchStage
            rows={rows}
            loc={loc}
            gunImageId={gun?.p ?? build.weaponId}
            gunName={gunName}
            selected={selected}
            onSelect={(path) => {
              setSelected(path);
              setPartSearch('');
            }}
            ok={(id) => isObtainable(avail(id))}
            popover={
              selRow && (
                <>
                  <div className="gs-pop__head">
                    <div className="gs-block__title">{slotLabel(loc, selRow.slot)}</div>
                    <IconButton size="sm" icon={<X />} label={t('gunsmith.close')} onClick={() => setSelected(null)} />
                  </div>
                  <Input
                    uiSize="sm"
                    value={partSearch}
                    autoFocus
                    placeholder={t('gunsmith.searchPart')}
                    aria-label={t('gunsmith.searchPart')}
                    icon={<MagnifyingGlass />}
                    onChange={(e) => setPartSearch(e.target.value)}
                  />
                  <div className="gs-pick-opts">
                    <label className="gs-check">
                      <Toggle size="sm" checked={onlyObtainable} onChange={setOnlyObtainable} label={t('gunsmith.onlyObtainable')} />
                      <span>{t('gunsmith.onlyObtainable')}</span>
                    </label>
                    <Select aria-label={t('gunsmith.sort')} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                      <option value="recoil">{t('gunsmith.sortBy.recoil')}</option>
                      <option value="ergo">{t('gunsmith.sortBy.ergo')}</option>
                      <option value="price">{t('gunsmith.sortBy.price')}</option>
                      <option value="name">{t('gunsmith.sortBy.name')}</option>
                    </Select>
                  </div>
                  <ul className="gs-parts">
                    {!selRow.required && (
                      <li>
                        <button
                          type="button"
                          className={`gs-part${!selRow.itemId ? ' is-on' : ''}`}
                          onClick={() => {
                            setBuild(equip(data, build, selRow.path, null));
                            setSelected(null);
                          }}
                        >
                          <span className="gs-img gs-img--none" aria-hidden="true" />
                          <span className="gs-part__main"><strong>{t('gunsmith.leaveEmpty')}</strong></span>
                        </button>
                      </li>
                    )}
                    {candidates.length === 0 && <li className="gs-hint">{t('gunsmith.nothingFits')}</li>}
                    {candidates.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className={`gs-part${c.id === selRow.itemId ? ' is-on' : ''}${isObtainable(c.a) ? '' : ' is-locked'}`}
                          onClick={() => {
                            setBuild(equip(data, build, selRow.path, c.id));
                            setSelected(null);
                          }}
                          title={[...c.a.open.map(sourceLabel), ...c.a.locked.map(lockLabel)].join('\n')}
                        >
                          <Icon id={c.id} alt="" />
                          <span className="gs-part__main">
                            <strong>{itemName(loc, c.id)}</strong>
                            <small className={isObtainable(c.a) ? 'gs-ok' : 'gs-locked'}>{bestLabel(c.a)}</small>
                            {c.clash.length > 0 && (
                              <small className="gs-bad">{t('gunsmith.replaces', { items: c.clash.map((x) => itemShort(loc, x)).join(', ') })}</small>
                            )}
                          </span>
                          <span className="gs-part__stats">
                            {fmtDelta(c.m.e) && <span className={(c.m.e ?? 0) > 0 ? 'gs-good' : 'gs-bad'}>{t('gunsmith.ergoShort')} {fmtDelta(c.m.e)}</span>}
                            {fmtDelta(c.m.r, true) && <span className={(c.m.r ?? 0) < 0 ? 'gs-good' : 'gs-bad'}>{t('gunsmith.recoilShort')} {fmtDelta(c.m.r, true)}</span>}
                            {c.m.cap ? <span>{t('gunsmith.capacity', { n: c.m.cap })}</span> : null}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {selRow.itemId && (
                    <p className="gs-hint gs-pop__src">
                      {[...avail(selRow.itemId).open.map(sourceLabel), ...avail(selRow.itemId).locked.map(lockLabel)].join(' · ')}
                    </p>
                  )}
                </>
              )
            }
          />
          <p className="gs-hint gs-stage-hint">{t('gunsmith.pickSlot')}</p>
        </main>

        {/* ---- right: stats like the modding screen, then trader levels ---- */}
        <aside className="gs-col gs-right">
          <div className="gs-block__title">
            {t('gunsmith.statsTitle')} <HelpTip>{t('gunsmith.statsNote')}</HelpTip>
          </div>
          <div className="gs-bars">
            <StatBar label={t('gunsmith.stat.ergo')} value={stats.ergonomics} base={factory.ergonomics} max={100} />
            <StatBar label={t('gunsmith.stat.recoilV')} value={stats.recoilVertical} base={factory.recoilVertical} max={Math.max(200, factory.recoilVertical * 1.3)} lowerIsBetter />
            <StatBar label={t('gunsmith.stat.recoilH')} value={stats.recoilHorizontal} base={factory.recoilHorizontal} max={Math.max(400, factory.recoilHorizontal * 1.3)} lowerIsBetter />
            <StatBar label={t('gunsmith.stat.weight')} value={stats.weight} base={factory.weight} max={Math.max(6, factory.weight * 2)} lowerIsBetter unit=" kg" digits={2} />
          </div>
          <div className="gs-cost">
            <small>{t('gunsmith.stat.cost')}</small>
            <strong>{rub(cost)}</strong>
          </div>

          {(missing.length > 0 || unavailable.length > 0 || noCash.length > 0) && (
            <div className="gs-warn">
              <Warning weight="fill" />
              <div>
                {missing.length > 0 && <p>{t('gunsmith.missing', { slots: missing.map((r) => slotLabel(loc, r.slot)).join(', ') })}</p>}
                {unavailable.length > 0 && <p>{t('gunsmith.unavailable', { count: unavailable.length })}</p>}
                {noCash.length > 0 && <p>{t('gunsmith.noCash', { count: noCash.length })}</p>}
              </div>
            </div>
          )}

          {tradersOpen && (
            <section className="gs-traders">
              <div className="gs-block__title">{t('gunsmith.traders')}</div>
              <p className="gs-hint">{t('gunsmith.tradersHint')}</p>
              {traders.map((tr) => (
                <div key={tr.id} className="gs-trader">
                  <span>{traderName(tr.id)}</span>
                  <Segmented
                    value={String(access.traderLevels[tr.id] ?? 0)}
                    onChange={(v) =>
                      setTraderLevels({ ...savedLevels, set: true, levels: { ...savedLevels.levels, [tr.id]: Number(v) } })
                    }
                    options={[0, 1, 2, 3, 4].map((n) => ({ id: String(n), label: n === 0 ? '—' : String(n) }))}
                  />
                </div>
              ))}
              <div className="gs-trader">
                <span>{t('gunsmith.flea')}</span>
                <Toggle
                  checked={access.flea}
                  onChange={(v) => setTraderLevels({ ...savedLevels, set: true, flea: v })}
                  label={t('gunsmith.flea')}
                />
              </div>
              <div className="gs-trader-actions">
                {playerLevel !== null && (
                  <Button
                    size="sm"
                    onClick={() =>
                      setTraderLevels({
                        set: true,
                        flea: playerLevel >= data.fleaMinLevel,
                        levels: Object.fromEntries(traders.map((tr) => [tr.id, maxLevelFor(tr, playerLevel)])),
                      })
                    }
                  >
                    {t('gunsmith.estimate', { level: playerLevel })}
                  </Button>
                )}
                <Button size="sm" variant="primary" onClick={() => setTradersOpen(false)}>
                  {t('gunsmith.done')}
                </Button>
              </div>
            </section>
          )}
        </aside>
      </div>
      <footer className="gs-foot">{t('gunsmith.dataNote', { date: new Date(data.generatedAt).toLocaleDateString(i18n.language) })}</footer>
    </>
  );
}
