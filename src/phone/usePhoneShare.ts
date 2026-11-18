// Main window side of "map on the phone": starts/stops the PC's phone server,
// keeps its status (QR, phones connected) and sends it the map state.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PhoneLayers } from './phoneLayers';
import {
  loadPhoneOn,
  phoneAvailable,
  phoneNewKey,
  phonePublish,
  phonePublishLayers,
  phoneStart,
  phoneStatus,
  phoneStop,
  savePhoneOn,
  type PhoneState,
  type PhoneStatus,
} from './phoneApi';

export interface PhoneShare {
  available: boolean;
  on: boolean;
  status: PhoneStatus | null;
  error: string | null;
  setOn: (on: boolean) => Promise<void>;
  newKey: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function usePhoneShare(state: PhoneState, layers: PhoneLayers | null = null): PhoneShare {
  const available = phoneAvailable();
  const [on, setOnState] = useState(() => available && loadPhoneOn());
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  // The layers frame the running server has (a restarted one, or a new key, has none).
  const sentLayers = useRef<string | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // On: the server runs (also after a restart of the app). Off: stopped.
  useEffect(() => {
    if (!available) return;
    let alive = true;
    if (on) {
      phoneStart()
        .then((s) => {
          if (!alive) return;
          sentLayers.current = null;
          setStatus(s);
          setError(null);
          void phonePublish(stateRef.current).catch(() => undefined);
        })
        .catch((e) => alive && setError(String(e)));
    } else {
      void phoneStop()
        .catch(() => undefined)
        .then(() => alive && setStatus(null));
    }
    return () => {
      alive = false;
    };
  }, [available, on]);

  // Every change of the map state goes to the phones.
  useEffect(() => {
    if (!available || !on || !status?.running) return;
    void phonePublish(state).catch(() => undefined);
  }, [available, on, status?.running, state]);

  // The map's layers, only when they really changed (the server keeps the
  // last ones for phones that connect later).
  const layersFrame = useMemo(() => (layers ? JSON.stringify({ layers }) : null), [layers]);
  useEffect(() => {
    // Development: the frame a phone would get, to feed a phone page by hand ('phone-demo').
    if (import.meta.env.DEV) (window as { __moaPhoneLayers?: string | null }).__moaPhoneLayers = layersFrame;
    if (!available || !on || !status?.running) {
      sentLayers.current = null;
      return;
    }
    if (!layersFrame || layersFrame === sentLayers.current) return;
    sentLayers.current = layersFrame;
    void phonePublishLayers(layersFrame).catch(() => {
      sentLayers.current = null;
    });
  }, [available, on, status, layersFrame]);

  const setOn = useCallback(async (next: boolean) => {
    savePhoneOn(next);
    setOnState(next);
  }, []);

  const newKey = useCallback(async () => {
    try {
      const s = await phoneNewKey();
      sentLayers.current = null;
      setStatus(s);
      void phonePublish(stateRef.current).catch(() => undefined);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!available) return;
    try {
      setStatus(await phoneStatus());
    } catch {
      /* off */
    }
  }, [available]);

  return { available, on, status, error, setOn, newKey, refresh };
}
