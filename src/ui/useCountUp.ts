// A number that counts to its new value instead of jumping (route minutes,
// roubles, shares). Eases out over ~0.65 s; lands at once when motion is
// reduced (the system setting, or animations off in Settings → Appearance).
import { useEffect, useRef, useState } from 'react';

const still = (): boolean =>
  (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) ||
  (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'off');

export function useCountUp(target: number, ms = 650): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    let raf = 0;
    const a = from.current;
    if (still() || a === target || typeof requestAnimationFrame !== 'function') {
      raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => setShown(target)) : 0;
      from.current = target;
      return () => cancelAnimationFrame(raf);
    }
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const v = a + (target - a) * (1 - Math.pow(1 - k, 3));
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return shown;
}
