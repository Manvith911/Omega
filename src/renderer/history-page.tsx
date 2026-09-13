/**
 * History — standalone tab page (omega://app/history.html).
 *
 * Same contract as the settings page: tab surface, reduced preload API,
 * shared panel component rendered full-height.
 */

import { createRoot } from 'react-dom/client'
import { HistoryPanel } from './components/HistoryPanel'
import './index.css'

const container = document.getElementById('page-root')
if (!container) throw new Error('#page-root is missing from history.html')

createRoot(container).render(<HistoryPanel />)
