// The opening: the MoA mark revealed through liquid glass (glassReveal.ts),
// then the name, then the app. Any click or key skips it; it is off when
// Settings → Appearance turns the intro or animations off, or the system asks
// for reduced motion. Without WebGL2 it falls back to a plain fade.
import { useEffect, useRef, useState } from 'react';
import mark from '@phosphor-icons/core/assets/bold/crosshair-bold.svg?raw';
import { getAppearance } from '../appearance/useAppearance';
import { loadLogo, playReveal, REVEAL_LOOKS } from './glassReveal';
import './intro.css';

type Phase = 'reveal' | 'title' | 'out';

export default function GlassIntro({ onDone }: { onDone: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('reveal');
  const [fallback, setFallback] = useState(false);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  const a = getAppearance();
  const skip =
    !a.animations ||
    (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    if (skip) {
      doneRef.current();
      return;
    }
    const wrap = wrapRef.current;
    if (!wrap) return;
    const look = { ...REVEAL_LOOKS[a.theme], logoColor: a.accent };
    let player: { dispose: () => void } | null = null;
    let cancelled = false;
    loadLogo(mark)
      .then((logo) => {
        if (cancelled) return;
        player = playReveal(wrap, logo, look, () => setPhase((p) => (p === 'reveal' ? 'title' : p)));
        if (!player) setFallback(true);
      })
      .catch(() => {
        if (!cancelled) setFallback(true);
      });
    return () => {
      cancelled = true;
      player?.dispose();
    };
    // The look is read once: the intro plays with the theme it opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip]);

  // Fallback: show the mark with a CSS fade for as long as the reveal would take.
  useEffect(() => {
    if (!fallback) return;
    const id = window.setTimeout(() => setPhase((p) => (p === 'reveal' ? 'title' : p)), 1400);
    return () => window.clearTimeout(id);
  }, [fallback]);

  useEffect(() => {
    if (phase === 'title') {
      const id = window.setTimeout(() => setPhase('out'), 1000);
      return () => window.clearTimeout(id);
    }
    if (phase === 'out') {
      const id = window.setTimeout(() => doneRef.current(), 480);
      return () => window.clearTimeout(id);
    }
  }, [phase]);

  useEffect(() => {
    const skipNow = () => setPhase('out');
    window.addEventListener('keydown', skipNow);
    // Never hold the app back: whatever happens, the opening ends by 7 s.
    const guard = window.setTimeout(skipNow, 7000);
    return () => {
      window.removeEventListener('keydown', skipNow);
      window.clearTimeout(guard);
    };
  }, []);

  if (skip) return null;
  const bg = REVEAL_LOOKS[a.theme].background;

  return (
    <div
      className={`glass-intro glass-intro--${phase}`}
      style={{ background: bg }}
      onClick={() => setPhase('out')}
      role="presentation"
    >
      <div ref={wrapRef} className="glass-intro__stage" />
      {fallback && (
        <div className="glass-intro__fallback" style={{ color: a.accent }} dangerouslySetInnerHTML={{ __html: mark }} />
      )}
      <div className="glass-intro__title">
        <span className="glass-intro__name">Tarkov MoA</span>
      </div>
    </div>
  );
}
