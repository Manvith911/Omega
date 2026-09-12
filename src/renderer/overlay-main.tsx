import { createRoot } from 'react-dom/client'
import { Suggestions } from './components/Suggestions'
import './index.css'

const container = document.getElementById('overlay-root')
if (!container) throw new Error('#overlay-root is missing from overlay.html')

// No StrictMode: this surface renders into a native view whose height is
// computed from the item count, and a double-invoked effect would briefly
// mount twice for no benefit.
createRoot(container).render(<Suggestions />)
