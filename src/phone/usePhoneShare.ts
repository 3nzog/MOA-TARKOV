// Main window side of "map on the phone": starts/stops the PC's phone server,
// keeps its status (QR, phones connected) and sends it the map state.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadPhoneOn,
  phoneAvailable,
  phoneNewKey,
  phonePublish,
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

export function usePhoneShare(state: PhoneState): PhoneShare {
  const available = phoneAvailable();
  const [on, setOnState] = useState(() => available && loadPhoneOn());
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
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

  const setOn = useCallback(async (next: boolean) => {
    savePhoneOn(next);
    setOnState(next);
  }, []);

  const newKey = useCallback(async () => {
    try {
      const s = await phoneNewKey();
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
