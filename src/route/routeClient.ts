// Hands route planning to the Web Worker (routeWorker.ts). Where there is no
// worker (tests) or it fails to start, the same code runs here instead.
import { computeRoutes, type ComputeInput, type PlanLite } from './compute';

type Pending = { input: ComputeInput; resolve: (plans: PlanLite[]) => void; reject: (e: Error) => void };

let worker: Worker | null | undefined;
let seq = 0;
const pending = new Map<number, Pending>();

/** Runs what is still waiting here, after the worker died. */
function drainHere(): void {
  for (const [id, p] of pending) {
    pending.delete(id);
    try {
      p.resolve(computeRoutes(p.input));
    } catch (e) {
      p.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === 'undefined' ? null : new Worker(new URL('./routeWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  worker?.addEventListener('message', (e: MessageEvent<{ id: number; plans?: PlanLite[]; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.plans) p.resolve(e.data.plans);
    else p.reject(new Error(e.data.error ?? 'route worker failed'));
  });
  worker?.addEventListener('error', () => {
    worker?.terminate();
    worker = null;
    drainHere();
  });
  return worker;
}

/** The plans of every style asked for, computed off the main thread when possible. */
export function computeInBackground(input: ComputeInput): Promise<PlanLite[]> {
  const w = getWorker();
  if (!w) {
    try {
      return Promise.resolve(computeRoutes(input));
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { input, resolve, reject });
    w.postMessage({ id, input });
  });
}
