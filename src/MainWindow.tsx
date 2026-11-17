// The main window: the app with its squad and link connections. Its own chunk,
// so the minimap overlay and the phone page do not load it.
import App from './App.tsx';
import { SquadProvider } from './squad/SquadContext';
import { LinkProvider } from './link/LinkProvider';
// The thermal look, after every component's own stylesheet (imported above through App).
import './ui/thermal.css';

export default function MainWindow() {
  return (
    <LinkProvider>
      <SquadProvider>
        <App />
      </SquadProvider>
    </LinkProvider>
  );
}
