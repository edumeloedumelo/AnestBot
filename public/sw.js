const CACHE_NAME = 'preanestesica-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Intercept share target POST
  if (url.pathname === '/share' && event.request.method === 'POST') {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const sharedFiles = [];
          const sharedText = formData.get('text') || '';
          const sharedTitle = formData.get('title') || '';

          const files = formData.getAll('files');
          for (const file of files) {
            if (file && file.size > 0) {
              const arrayBuffer = await file.arrayBuffer();
              sharedFiles.push({
                name: file.name,
                type: file.type,
                size: file.size,
                data: Array.from(new Uint8Array(arrayBuffer))
              });
            }
          }

          // Store shared data in a client that will be opened
          const allClients = await self.clients.matchAll({ type: 'window' });
          if (allClients.length > 0) {
            allClients[0].postMessage({
              type: 'SHARED_FILES',
              text: sharedText || sharedTitle,
              files: sharedFiles
            });
            allClients[0].focus();
            return Response.redirect('/', 303);
          }

          // Open new window if none open
          const newClient = await self.clients.openWindow('/');
          if (newClient) {
            // Wait a moment for the page to load then post message
            setTimeout(() => {
              newClient.postMessage({
                type: 'SHARED_FILES',
                text: sharedText || sharedTitle,
                files: sharedFiles
              });
            }, 1500);
          }

          return Response.redirect('/', 303);
        } catch (err) {
          console.error('Share target error:', err);
          return Response.redirect('/', 303);
        }
      })()
    );
  }
});
