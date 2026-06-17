import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)

// Register service worker for PWA / share target
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});

  // Listen for shared files from service worker
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'SHARED_FILES') {
      // Dispatch custom event so App can pick it up
      window.dispatchEvent(new CustomEvent('app:sharedFiles', {
        detail: { text: event.data.text, files: event.data.files }
      }));
    }
  });
}