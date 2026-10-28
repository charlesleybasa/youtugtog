import React from 'react'
import ReactDOM from 'react-dom/client'
import { inject } from '@vercel/analytics'
import { Capacitor } from '@capacitor/core'
import App from './App'
import './index.css'

// Vercel Analytics loads its script from `/_vercel/insights/script.js`
// relative to the current origin. Inside Capacitor that origin is
// https://localhost, which has no such script — the request 404s against
// the bundled assets on every launch and no events are ever recorded.
// Skip it on native; the web build is unchanged.
if (!Capacitor.isNativePlatform()) {
  inject({ mode: import.meta.env.PROD ? 'production' : 'development' })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
