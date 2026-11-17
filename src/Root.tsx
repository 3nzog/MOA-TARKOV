// Which window this is: the main app, the minimap overlay (?view=minimap) or a
// phone on the home Wi-Fi (?view=phone). Each loads only its own code: the
// minimap overlay, open while you play, does not carry the whole app; nor
// does the phone page.
import { Suspense, lazy } from 'react';

const MainWindow = lazy(() => import('./MainWindow'));
const MinimapApp = lazy(() => import('./minimap/MinimapApp'));
const PhoneApp = lazy(() => import('./phone/PhoneApp'));

export default function Root({ view }: { view: string | null }) {
  return <Suspense fallback={null}>{view === 'minimap' ? <MinimapApp /> : view === 'phone' ? <PhoneApp /> : <MainWindow />}</Suspense>;
}
