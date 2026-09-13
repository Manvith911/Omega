/**
 * Downloads — standalone tab page (omega://app/downloads.html).
 */

import { createRoot } from 'react-dom/client'
import { DownloadsPage } from './DownloadsPanel'
import './index.css'

const container = document.getElementById('page-root')
if (!container) throw new Error('#page-root is missing from downloads.html')

createRoot(container).render(<DownloadsPage />)
