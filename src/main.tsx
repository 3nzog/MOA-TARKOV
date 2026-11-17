import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/index.css'
import '@fontsource-variable/jetbrains-mono/index.css'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/700.css'
import './ui/tokens.css'
import './index.css'
import './squad/squad.css'
import App from './App.tsx'
import { SquadProvider } from './squad/SquadContext'
import { LinkProvider } from './link/LinkProvider'
import { setupI18n } from './i18n'
import MinimapApp from './minimap/MinimapApp'
import { initAppearance } from './appearance/useAppearance'
import { installExternalLinks } from './services/openExternal'

// Theme, accent and glass come from the saved appearance before anything paints.
initAppearance()

// Links to the wiki, tarkov.dev and the like open in the player's browser.
installExternalLinks()

// The same bundle serves the minimap overlay window (opened by the main window
// with ?view=minimap). It renders only the minimap — no squad connection, no
// watchers of its own; the main window feeds it over Tauri events.
const isMinimap = new URLSearchParams(window.location.search).get('view') === 'minimap'

// Resolve the language (user choice → EFT game language → system → English)
// and init i18next before first render so the UI never flashes the wrong locale.
void setupI18n().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {isMinimap ? (
        <MinimapApp />
      ) : (
        <LinkProvider>
          <SquadProvider>
            <App />
          </SquadProvider>
        </LinkProvider>
      )}
    </StrictMode>,
  )
})
