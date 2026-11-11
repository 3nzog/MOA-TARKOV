// Hideout tracker: built level per station (entered by the player — the game
// does not expose it) and what the next level needs.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { stationStatus } from '../progression/needs';
import { Button, Select } from '../ui';
import { formatSeconds } from './names';
import type { PlannerCtx } from './PlannerPanel';

export default function HideoutTab({ ctx }: { ctx: PlannerCtx }) {
  const { t } = useTranslation();
  const { data, names, planner } = ctx;
  const levels = planner.planner.stationLevels;
  const [open, setOpen] = useState<string | null>(null);

  const stations = useMemo(
    () =>
      data.stations
        .filter((s) => s.levels.length > 0)
        .map((s) => ({ station: s, st: stationStatus(s, levels) }))
        .sort((a, b) => names.station(a.station.id).localeCompare(names.station(b.station.id))),
    [data, levels, names],
  );

  const done = stations.filter((s) => s.st.built >= s.st.max).length;

  return (
    <div className="planner-stack">
      <p className="planner-hint">{t('planner.hideout.hint')}</p>
      <p className="planner-hint">{t('planner.hideout.progress', { done, total: stations.length })}</p>
      <ul className="planner-quests">
        {stations.map(({ station, st }) => {
          const next = station.levels.find((l) => l.level === st.built + 1);
          const maxed = st.built >= st.max;
          const isOpen = open === station.id;
          return (
            <li key={station.id} className={`planner-quest${isOpen ? ' planner-quest--open' : ''}`}>
              <div className="planner-station__head">
                <button type="button" className="planner-quest__head" onClick={() => setOpen((c) => (c === station.id ? null : station.id))} aria-expanded={isOpen}>
                  <span className="planner-quest__name">{names.station(station.id)}</span>
                  <span className="planner-meta">
                    {maxed ? (
                      <span className="planner-status planner-status--complete">{t('planner.hideout.max')}</span>
                    ) : st.blockedBy.length > 0 ? (
                      <span className="planner-status planner-status--locked">{t('planner.status.locked')}</span>
                    ) : (
                      <span className="planner-status planner-status--available">{t('planner.hideout.next', { level: st.built + 1 })}</span>
                    )}
                  </span>
                </button>
                <Select
                  aria-label={t('planner.hideout.builtLevel', { station: names.station(station.id) })}
                  className="planner-level-select"
                  value={String(st.built)}
                  onChange={(e) => planner.setStationLevel(station.id, Number(e.target.value))}
                >
                  {Array.from({ length: st.max + 1 }, (_, i) => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </Select>
              </div>
              {isOpen && next && (
                <div className="planner-quest__body">
                  <h4 className="planner-subhead">
                    {t('planner.hideout.requirementsFor', { level: next.level })}
                    {next.time > 0 && <span className="planner-hint"> · {formatSeconds(next.time)}</span>}
                  </h4>
                  <ul className="planner-list planner-list--dense">
                    {next.items.map((r) => (
                      <li key={r.itemId}>
                        {names.item(r.itemId)}
                        {r.fir && <span className="planner-fir">FIR</span>}
                        <span className="planner-meta mono">×{r.count.toLocaleString()}</span>
                      </li>
                    ))}
                    {next.stations.map((r) => {
                      const ok = (levels[r.stationId] ?? 0) >= r.level;
                      return (
                        <li key={r.stationId} className={ok ? 'planner-objective--done' : undefined}>
                          {t('planner.hideout.stationLevel', { station: names.station(r.stationId), level: r.level })}
                          <span className="planner-meta">{ok ? '✓' : '✗'}</span>
                        </li>
                      );
                    })}
                    {next.traders.map((r) => (
                      <li key={r.traderId}>
                        {t('planner.quests.traderLevel', { trader: names.trader(r.traderId), value: r.level })}
                        <span className="planner-meta planner-hint">?</span>
                      </li>
                    ))}
                    {next.skills.map((r) => (
                      <li key={r.skill}>
                        {t('planner.hideout.skill', { skill: r.skill, level: r.level })}
                        <span className="planner-meta planner-hint">?</span>
                      </li>
                    ))}
                  </ul>
                  {(next.traders.length > 0 || next.skills.length > 0) && (
                    <p className="planner-hint">{t('planner.hideout.unknownReqs')}</p>
                  )}
                  <Button size="sm" onClick={() => planner.setStationLevel(station.id, next.level)} disabled={st.blockedBy.length > 0}>
                    {t('planner.hideout.markBuilt', { level: next.level })}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
