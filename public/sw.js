self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname === '/share' && event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event.request));
  }
});

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const text = formData.get('description') || '';
    const rawFiles = formData.getAll('files');

    const files = [];
    for (const file of rawFiles) {
      if (file && file.name) {
        const buffer = await file.arrayBuffer();
        files.push({
          name: file.name,
          type: file.type,
          data: Array.from(new Uint8Array(buffer))
        });
      }
    }

    const redirectUrl = '/?shared=true';

    // Send data to any open app windows
    const allClients = await clients.matchAll({ type: 'window' });
    for (const client of allClients) {
      client.postMessage({
        type: 'SHARED_FILES',
        text: text.toString().trim(),
        files: files
      });
    }

    // If no windows open, open one — data is already in POST
    if (allClients.length === 0) {
      await clients.openWindow(redirectUrl);
    }

    return Response.redirect(redirectUrl, 303);
  } catch (err) {
    console.error('Share target error:', err);
    return Response.redirect('/', 303);
  }
}
