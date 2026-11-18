// Planner → Hideout: what is running (with the time left, which can be
// corrected), and the "started" buttons for a station's upgrade and crafts.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Trash, Timer } from '@phosphor-icons/react';
import { Button, IconButton, Input } from '../ui';
import { clock } from '../map/raidDuration';
import { formatSeconds, type Names } from '../planner/names';
import type { Craft, Station } from '../progression/types';
import { parseLeft, removeTimer, setTimeLeft, startTimer, useHideoutTimers, type HideoutTimer } from './timers';

function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
}

function TimerRow({ timer, now }: { timer: HideoutTimer; now: number }) {
  const { t } = useTranslation();
  const [edit, setEdit] = useState<string | null>(null);
  const left = Math.max(0, timer.endsAt - now);
  const apply = () => {
    const ms = edit === null ? null : parseLeft(edit);
    if (ms !== null) setTimeLeft(timer.id, ms);
    setEdit(null);
  };
  return (
    <li className="hideout-timer">
      <Timer weight="bold" />
      <span className="hideout-timer__label">{timer.label}</span>
      {edit === null ? (
        <button type="button" className="hideout-timer__left mono" title={t('hideoutTimers.adjust')} onClick={() => setEdit('')}>
          {clock(left)}
        </button>
      ) : (
        <form
          className="hideout-timer__edit"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <Input autoFocus value={edit} placeholder="1:30" aria-label={t('hideoutTimers.adjust')} onChange={(e) => setEdit(e.target.value)} onBlur={apply} />
        </form>
      )}
      <IconButton size="sm" icon={<Trash />} label={t('hideoutTimers.remove')} onClick={() => removeTimer(timer.id)} />
    </li>
  );
}

/** The running timers, at the top of the hideout tab. */
export function RunningTimers() {
  const { t } = useTranslation();
  const timers = useHideoutTimers();
  const now = useNow(timers.length > 0);
  if (timers.length === 0) return <p className="planner-hint">{t('hideoutTimers.none')}</p>;
  return (
    <div>
      <h4 className="planner-subhead">{t('hideoutTimers.running')}</h4>
      <ul className="hideout-timers">
        {[...timers]
          .sort((a, b) => a.endsAt - b.endsAt)
          .map((x) => (
            <TimerRow key={x.id} timer={x} now={now} />
          ))}
      </ul>
    </div>
  );
}

/** "Started" buttons for one station: its next upgrade, and the crafts its built level allows. */
export function StationStarters({ station, built, crafts, names }: { station: Station; built: number; crafts: Craft[]; names: Names }) {
  const { t } = useTranslation();
  const next = station.levels.find((l) => l.level === built + 1);
  const mine = crafts.filter((c) => c.stationId === station.id && c.level <= built);
  const stationName = names.station(station.id);
  return (
    <div className="hideout-starters">
      {next && next.time > 0 && (
        <Button
          size="sm"
          variant="secondary"
          icon={<Play weight="bold" />}
          onClick={() =>
            startTimer({ kind: 'upgrade', stationId: station.id, level: next.level, label: t('hideoutTimers.upgradeLabel', { station: stationName, level: next.level }) }, next.time)
          }
        >
          {t('hideoutTimers.startUpgrade', { level: next.level, time: formatSeconds(next.time) })}
        </Button>
      )}
      {mine.length > 0 && (
        <>
          <h4 className="planner-subhead">{t('hideoutTimers.crafts')}</h4>
          <ul className="planner-list planner-list--dense">
            {mine.map((c) => {
              const out = `${names.item(c.output.itemId)}${c.output.count > 1 ? ` ×${c.output.count}` : ''}`;
              return (
                <li key={c.id} className="hideout-craft">
                  <span>{out}</span>
                  <span className="planner-meta mono">{formatSeconds(c.duration)}</span>
                  <IconButton
                    size="sm"
                    icon={<Play weight="bold" />}
                    label={t('hideoutTimers.startCraft')}
                    onClick={() => startTimer({ kind: 'craft', stationId: station.id, craftId: c.id, label: `${out} · ${stationName}` }, c.duration)}
                  />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
