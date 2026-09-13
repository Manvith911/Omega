/**
 * Settings — standalone tab page (omega://app/settings.html).
 *
 * This is a tab surface, not the chrome window: the preload runs in
 * `--omega-page` mode, which exposes only the reduced page API (settings,
 * history, page:open). The panel component is shared with the old overlay UI
 * and renders itself full-height here.
 */

import { createRoot } from 'react-dom/client'
import { SettingsPanel } from './components/SettingsPanel'
import './index.css'

const container = document.getElementById('page-root')
if (!container) throw new Error('#page-root is missing from settings.html')

createRoot(container).render(<SettingsPanel />)
