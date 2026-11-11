import { describe, expect, it } from 'vitest';
import { effectiveStatus, loadProgress, markQuestComplete, markQuestAccepted, setQuestOverride, type LocalProgress } from './localProgress';
import {
  applyPushedTasks,
  applyRemoteTasks,
  changedOverrides,
  dequeue,
  enqueue,
  liveQuestState,
  mergeHideout,
  mergeObjectives,
  parseRemote,
  parseTrackerCache,
  pendingDiff,
  type TrackerRemote,
} from './trackerSync';
import type { Station } from '../progression/types';

const fresh = (): LocalProgress => ({
  acceptedQuestIds: [],
  completedQuestIds: [],
  failedQuestIds: [],
  playerLevel: 1,
  faction: 'USEC',
  levelSet: false,
  factionSet: false,
  overrides: {},
  remoteCompletedIds: [],
  remoteFailedIds: [],
});

const remote = (over: Partial<TrackerRemote> = {}): TrackerRemote => ({
  completed: [],
  failed: [],
  objectives: [],
  hideoutModules: [],
  playerLevel: null,
  faction: null,
  displayName: '',
  ...over,
});

describe('TarkovTracker sync', () => {
  it('parses a progress payload defensively', () => {
    const r = parseRemote({
      tasksProgress: [
        { id: 'a', complete: true },
        { id: 'b', complete: true, failed: true },
        { id: 'c', complete: true, invalid: true },
        { id: 7, complete: true },
      ],
      taskObjectivesProgress: [{ id: 'o1', complete: true, count: 2 }, { id: 'o2', complete: false }],
      hideoutModulesProgress: [{ id: 'st-1', complete: true }],
      hideoutPartsProgress: [],
      playerLevel: 7,
      pmcFaction: 'BEAR',
      displayName: 'x',
    })!;
    expect(r.completed).toEqual(['a']);
    expect(r.failed).toEqual(['b']);
    expect(r.objectives).toEqual(['o1']);
    expect(r.hideoutModules).toEqual(['st-1']);
    expect(r.playerLevel).toBe(7);
    expect(r.faction).toBe('BEAR');
    expect(parseRemote({ nope: 1 })).toBeNull();
    expect(parseRemote({ tasksProgress: [], playerLevel: 300 })!.playerLevel).toBeNull();
  });

  it('lays remote quests below the logs and above "accepted"', () => {
    let p = markQuestAccepted(fresh(), 'a');
    p = markQuestComplete(p, 'logged');
    p = applyRemoteTasks(p, remote({ completed: ['a'], failed: ['logged'] }));
    expect(effectiveStatus(p, 'a')).toBe('complete');
    expect(effectiveStatus(p, 'logged')).toBe('complete'); // the log wins
    p = setQuestOverride(p, 'a', 'active', 1);
    expect(effectiveStatus(p, 'a')).toBe('active'); // the player wins
  });

  it('takes the higher level and the faction only when not set here', () => {
    let p = applyRemoteTasks(fresh(), remote({ playerLevel: 7, faction: 'BEAR' }));
    expect(p).toMatchObject({ playerLevel: 7, levelSet: true, faction: 'BEAR', factionSet: true });
    p = { ...p, playerLevel: 20, faction: 'USEC' };
    p = applyRemoteTasks(p, remote({ playerLevel: 9, faction: 'BEAR' }));
    expect(p).toMatchObject({ playerLevel: 20, faction: 'USEC' });
  });

  it('returns the same object when a pull changes nothing', () => {
    const p = applyRemoteTasks(fresh(), remote({ completed: ['a'] }));
    expect(applyRemoteTasks(p, remote({ completed: ['a'] }))).toBe(p);
  });

  it('merges objective ticks three-way and leaves pending ticks alone', () => {
    // First pull: adds, removes nothing.
    expect(mergeObjectives(['local'], null, ['r1'], new Set()).sort()).toEqual(['local', 'r1']);
    // r1 unticked on TarkovTracker since last pull; local untouched; r2 new.
    expect(mergeObjectives(['local', 'r1'], ['r1'], ['r2'], new Set()).sort()).toEqual(['local', 'r2']);
    // The player unticked r1 here and it waits in the outbox: a pull still showing r1 does not re-tick it.
    expect(mergeObjectives([], ['r1'], ['r1'], new Set(['r1']))).toEqual([]);
    const same = ['x'];
    expect(mergeObjectives(same, ['x'], ['x'], new Set())).toBe(same);
  });

  it('raises hideout levels from newly built remote levels only', () => {
    const stations = [
      { id: 'st', levels: [{ id: 'st-1', level: 1 }, { id: 'st-2', level: 2 }] },
    ] as unknown as Station[];
    expect(mergeHideout({}, stations, null, ['st-1', 'st-2'])).toEqual({ st: 2 });
    expect(mergeHideout({ st: 3 }, stations, null, ['st-1'])).toEqual({ st: 3 });
    const lv = { st: 1 };
    expect(mergeHideout(lv, stations, ['st-1'], ['st-1'])).toBe(lv);
  });

  it('pushes manual changes and live events, not log history', () => {
    const p = setQuestOverride(fresh(), 'q', 'complete', 5);
    expect(changedOverrides({}, p.overrides)).toEqual([{ id: 'q', state: 'completed' }]);
    expect(changedOverrides(p.overrides, p.overrides)).toEqual([]);
    expect(changedOverrides(p.overrides, setQuestOverride(p, 'q', 'none', 6).overrides)).toEqual([{ id: 'q', state: 'uncompleted' }]);
    expect(liveQuestState('Finished')).toBe('completed');
    expect(liveQuestState('Started')).toBeNull();
  });

  it('lists what MoA knows that TarkovTracker does not, for the explicit send', () => {
    let p = markQuestComplete(fresh(), 'a');
    p = markQuestComplete(p, 'b');
    p = setQuestOverride(p, 'c', 'none', 1);
    p = applyRemoteTasks(p, remote({ completed: ['b', 'c'] }));
    expect(pendingDiff(p)).toEqual([
      { id: 'a', state: 'completed' },
      { id: 'c', state: 'uncompleted' },
    ]);
    const after = applyPushedTasks(p, pendingDiff(p));
    expect(pendingDiff(after)).toEqual([]);
  });

  it('coalesces the outbox by target', () => {
    let box = enqueue([], [{ kind: 'task', id: 'a', state: 'completed' }, { kind: 'level', level: 5 }]);
    box = enqueue(box, [{ kind: 'task', id: 'a', state: 'failed' }, { kind: 'level', level: 6 }]);
    expect(box).toEqual([
      { kind: 'task', id: 'a', state: 'failed' },
      { kind: 'level', level: 6 },
    ]);
    expect(dequeue(box, [{ kind: 'level', level: 6 }])).toEqual([{ kind: 'task', id: 'a', state: 'failed' }]);
    // A newer item queued while an older one was in flight survives the dequeue.
    expect(dequeue(box, [{ kind: 'task', id: 'a', state: 'completed' }])).toHaveLength(2);
  });

  it('reads the persisted cache defensively and never stores a key', () => {
    const c = parseTrackerCache(JSON.stringify({ outbox: [{ kind: 'level', level: 99 }, { kind: 'task', id: 'a', state: 'completed' }], autoPush: false }));
    expect(c.outbox).toEqual([{ kind: 'task', id: 'a', state: 'completed' }]);
    expect(c.autoPush).toBe(false);
    expect(parseTrackerCache('{bad')).toMatchObject({ remote: null, autoPush: true });
    expect(Object.keys(c)).not.toContain('token');
  });

  it('loads older saved progress without the remote layer', () => {
    localStorage.setItem('tc_local_progress_v1', JSON.stringify({ completedQuestIds: ['a'] }));
    expect(loadProgress()).toMatchObject({ remoteCompletedIds: [], remoteFailedIds: [] });
  });
});
