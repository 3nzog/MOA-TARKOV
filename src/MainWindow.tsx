// The main window: the app with its squad and link connections. Its own chunk,
// so the minimap overlay and the phone page do not load it.
import { useEffect } from 'react';
import App from './App.tsx';
import { SquadProvider } from './squad/SquadContext';
import { LinkProvider } from './link/LinkProvider';
import { PairingProvider } from './link/PairingProvider';
// The thermal look, after every component's own stylesheet (imported above through App).
import './ui/thermal.css';

/**
 * While another window (the game) has the focus, this one holds still: the
 * animations pause (ui/thermal.css), so it draws nothing it does not need to.
 */
function useStillWhenUnfocused() {
  useEffect(() => {
    const root = document.documentElement;
    const set = () => root.classList.toggle('app-unfocused', !document.hasFocus() || document.hidden);
    set();
    window.addEventListener('focus', set);
    window.addEventListener('blur', set);
    document.addEventListener('visibilitychange', set);
    return () => {
      window.removeEventListener('focus', set);
      window.removeEventListener('blur', set);
      document.removeEventListener('visibilitychange', set);
      root.classList.remove('app-unfocused');
    };
  }, []);
}

export default function MainWindow() {
  useStillWhenUnfocused();
  return (
    <LinkProvider>
      <SquadProvider>
        <PairingProvider>
          <App />
        </PairingProvider>
      </SquadProvider>
    </LinkProvider>
  );
}
