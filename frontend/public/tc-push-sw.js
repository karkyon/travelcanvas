/*
 * [Gate TDay-Push] 端末への通知だけを受け持つ Service Worker(画面の通信・保存(キャッシュ)には関わらない)。
 * 中身は backend(app/services/web_push.py)が端末の鍵で暗号化して送り、ブラウザが復号して push で渡す:
 *   { title, body, url, tag, kind }
 * 通知を押したら、同じサイトの url を開く(開いている画面があればそこへ移る)。他のサイトへは移らない。
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function safePath(url) {
  try {
    const u = new URL(url || '/', self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : '/';
  } catch {
    return '/';
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'TravelCanvas', body: event.data ? event.data.text() : '' };
  }
  const title = String(data.title || 'TravelCanvas').slice(0, 80);
  const options = {
    body: String(data.body || '').slice(0, 240),
    tag: String(data.tag || 'tc'),
    renotify: true,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-96x96.png',
    lang: 'ja',
    data: { url: safePath(data.url), kind: String(data.kind || '') },
    requireInteraction: data.kind === 'depart',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
        await c.focus();
        if ('navigate' in c) {
          try {
            await c.navigate(path);
          } catch {
            // 開けない時は今の画面のまま
          }
        }
        return;
      }
    }
    await self.clients.openWindow(path);
  })());
});
