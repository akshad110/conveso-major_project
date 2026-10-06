import { createRoot } from 'react-dom/client'
import App from './App'
// The suite's shared look first, this app's own rules second, so a courtroom
// override always wins over the pack.
import '@converso/night-desk/night-desk.css'
import './styles.css'

// No StrictMode: its double-mount duplicates GLTF clones and animation mixers,
// which makes heavy 3D scenes misbehave in development.
createRoot(document.getElementById('root')).render(<App />)
