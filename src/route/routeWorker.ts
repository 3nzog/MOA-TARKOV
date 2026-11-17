// Plans the raid route off the main thread (compute.ts), so the map and the
// panels never wait for it.
import { computeRoutes, type ComputeInput } from './compute';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; input: ComputeInput }>) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = (e) => {
  const { id, input } = e.data;
  try {
    scope.postMessage({ id, plans: computeRoutes(input) });
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
