import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useCountUp } from './useCountUp';

// Animation frames run when the test says so, at the time it says.
let frames: FrameRequestCallback[] = [];
let now = 0;
const flush = (ms: number) => {
  now += ms;
  const run = frames;
  frames = [];
  act(() => run.forEach((f) => f(now)));
};

function Shown({ value }: { value: number }) {
  return <span>{Math.round(useCountUp(value, 600))}</span>;
}

describe('useCountUp', () => {
  let el: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    frames = [];
    now = 0;
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    el = document.createElement('div');
    root = createRoot(el);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete document.documentElement.dataset.motion;
  });

  it('starts at its value and counts to a new one, ending exactly on it', () => {
    act(() => root.render(<Shown value={10} />));
    expect(el.textContent).toBe('10');
    act(() => root.render(<Shown value={110} />));
    flush(0);
    flush(300);
    const mid = Number(el.textContent);
    expect(mid).toBeGreaterThan(10);
    expect(mid).toBeLessThan(110);
    flush(400);
    expect(el.textContent).toBe('110');
  });

  it('jumps straight to the new value with animations turned off', () => {
    document.documentElement.dataset.motion = 'off';
    act(() => root.render(<Shown value={5} />));
    act(() => root.render(<Shown value={500} />));
    flush(16);
    expect(el.textContent).toBe('500');
  });
});
