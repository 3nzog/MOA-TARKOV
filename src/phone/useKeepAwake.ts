// Keeps the phone's screen on while the map is open: a phone that goes dark in
// the middle of a raid stops getting positions (and has to be unlocked to look).
//
// The browser's own screen lock (Screen Wake Lock) only exists on https pages,
// and the phone page comes over plain http on the home network. So, where the
// wake lock is missing, a tiny silent video plays on a loop out of sight:
// phones keep the screen on while a video plays. Phones only start a video
// after a touch, so it is started again on the first touch, and after coming
// back to the page.
import { useEffect } from 'react';

/** 16×16 black, 1.3 s, H.264, no sound (made for this app with the browser's MediaRecorder). */
const SILENT_MP4 =
  'data:video/mp4;base64,AAAAJGZ0eXBpc29tAAACAGlzb21pc282aXNvMmF2YzFtcDQxAAACyW1vb3YAAAB4bXZoZAEAAAAAAAAA5yNsSgAAAADnI2xKAAAD6AAAAAAAAAU6AAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAIhdHJhawAAAGh0a2hkAQAAAwAAAADnI2xKAAAAAOcjbEoAAAABAAAAAAAAAAAAAAU6AAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAQAAAAEAAAAAABsW1kaWEAAAAsbWRoZAEAAAAAAAAA5yNsSgAAAADnI2xKAAB1MAAAAAAAAAU6VcQAAAAAAC1oZGxyAAAAAAAAAAB2aWRlAAAAAAAAAAAAAAAAVmlkZW9IYW5kbGVyAAAAAVBtaW5mAAAAFHZtaGQAAAABAAAAAAAAAAAAAAAlZGluZgAAAB1kcmVmAAAAAAAAAAEAAAANdXJsIAAAAAEAAAABD3N0YmwAAAAQc3RzYwAAAAAAAAAAAAAAEHN0dHMAAAAAAAAAAAAAABRzdHN6AAAAAAAAAAAAAAAAAAAAEHN0Y28AAAAAAAAAAAAAAMNzdHNkAAAAAAAAAAEAAACzYXZjMQAAAAAAAAABAAAAAQAAAAAAAAAAAAAAAAAQABAASAAAAEgAAAAAAAAAAQtBVkMxIENvZGluZwAAAAAAAAAAAAAAAAAAAAAAAAAAABj//wAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAAAAAAAAAAAAACZhdmNDAULACv/hAA9nQsAKjGnJuAhoCDwiEagBAARozjyAAAAAE2NvbHJuY2x4AAEADQABgAAAAChtdmV4AAAAIHRyZXgAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAADQbW9vZgAAABBtZmhkAAAAAAAAAAEAAAC4dHJhZgAAABR0ZmhkAAIAIAAAAAEBAQAAAAAAFHRmZHQBAAAAAAAAAAAAAAAAAACIdHJ1bgEAAwUAAAAOAAAA2AIAAAAAAAy4AAAAEgAACvkAAAAUAAALAQAAAAsAAAylAAAACwAACwQAAAAUAAAMqwAAABQAAAr3AAAAFAAADMAAAAAUAAAK3AAAABQAAAypAAAAFAAACuAAAAAUAAALGQAAABQAAAy6AAAAFAAAA+cAAAAUAAABDG1kYXQAAAAOZbgABAn///h6KAAILvwAAAAQYeAAfkCf4y7u7u7u7u7u8AAAAAdh4AC+QP6gAAAAB2HgAP5AV6gAAAAQYeABPkBv+MqqqqqqqqqqrAAAABBh4AF+QHf4y7u7u7u7u7u8AAAAEGHgAb5Ad/jKqqqqqqqqqqwAAAAQYeAB/kB3+Mu7u7u7u7u7vAAAABBh4AI+QHf4yqqqqqqqqqqsAAAAEGHgAn5Ad/jLu7u7u7u7u7wAAAAQYeACvkB3+MqqqqqqqqqqrAAAABBh4AL+QHf4y7u7u7u7u7u8AAAAEGHgAz5Ad/jKqqqqqqqqqqwAAAAQYeADfkB3+Mu7u7u7u7u7vAAAAExtZnJhAAAANHRmcmEBAAAAAAAAAQAAAD8AAAABAAAAAAAAAAAAAAAAAAAC7QAAAAEAAAABAAAAAQAAABBtZnJvAAAAAAAAAEw=';

interface WakeLockLike {
  release: () => Promise<void>;
}
type WithWakeLock = Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockLike> } };

/** The silent looping video, in the page but out of sight. */
function silentVideo(): HTMLVideoElement {
  const v = document.createElement('video');
  v.src = SILENT_MP4;
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('muted', '');
  v.setAttribute('aria-hidden', 'true');
  v.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1';
  return v;
}

/** While on, the screen stays lit (as long as the page is on screen). */
export function useKeepAwake(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    let lock: WakeLockLike | null = null;
    let video: HTMLVideoElement | null = null;
    let alive = true;
    const wake = (navigator as WithWakeLock).wakeLock;
    const grab = async () => {
      if (!alive || document.visibilityState !== 'visible') return;
      if (wake && window.isSecureContext) {
        if (lock) return;
        try {
          lock = await wake.request('screen');
          return;
        } catch {
          lock = null;
        }
      }
      if (!video) {
        video = silentVideo();
        document.body.appendChild(video);
      }
      if (video.paused) void video.play().catch(() => undefined);
    };
    const onVisible = () => {
      // The lock goes when the page is hidden; asked for again on return.
      if (document.visibilityState === 'visible') {
        lock = null;
        void grab();
      }
    };
    void grab();
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('pointerdown', grab, { passive: true });
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('pointerdown', grab);
      void lock?.release().catch(() => undefined);
      video?.pause();
      video?.remove();
    };
  }, [on]);
}
