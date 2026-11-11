import { useEffect, useMemo, useState } from 'react';
import { loadProgression } from '../api/progression';
import type { ApiLang } from '../api/tarkov-dev';
import type { TarkovTask } from '../api/types';
import { i18n } from '../i18n';
import { computeQuestStatuses, type QuestInfo } from '../progression/status';
import type { ProgressionData } from '../progression/types';
import { effectiveStatus, type LocalProgress } from '../state/localProgress';

export type ProgressionLoad =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; data: ProgressionData };

// Progression / economy data, loaded the first time `enabled` turns true (the
// planner panel is opened) and again on a language switch. ~2 MB of JSON — not
// worth parsing on every launch for players who never open the planner.
export function useProgressionData(enabled: boolean): ProgressionLoad {
  const [load, setLoad] = useState<ProgressionLoad>({ state: 'idle' });
  const [lang, setLang] = useState<string>(i18n.language);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    // Latches on: once loaded, the data stays even if the panel closes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (enabled) setRequested(true);
  }, [enabled]);

  useEffect(() => {
    const onLang = (l: string) => setLang(l);
    i18n.on('languageChanged', onLang);
    return () => {
      i18n.off('languageChanged', onLang);
    };
  }, []);

  useEffect(() => {
    if (!requested) return;
    let cancelled = false;
    // An external fetch driving loading/result state — the intended use of an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoad((cur) => (cur.state === 'ready' ? cur : { state: 'loading' }));
    void loadProgression(lang as ApiLang).then(
      (data) => {
        if (cancelled) return;
        setLoad(data ? { state: 'ready', data } : { state: 'error' });
      },
      () => {
        if (!cancelled) setLoad({ state: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [requested, lang]);

  return load;
}

/** Per-quest status over the whole task list (see progression/status.ts). */
export function useQuestStatuses(
  tasks: TarkovTask[],
  data: ProgressionData | null,
  progress: LocalProgress,
): Map<string, QuestInfo> {
  return useMemo(() => {
    if (!data || tasks.length === 0) return new Map();
    return computeQuestStatuses({
      tasks,
      meta: data.tasks,
      baseStatus: (id) => effectiveStatus(progress, id),
      isManual: (id) => id in progress.overrides,
      profile: {
        level: progress.levelSet ? progress.playerLevel : null,
        faction: progress.factionSet ? progress.faction : null,
      },
    });
  }, [tasks, data, progress]);
}
