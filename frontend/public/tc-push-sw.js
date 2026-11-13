/*
 * [Gate TDay-Push] 端末への通知を受け持つ Service Worker。
 * 中身は backend(app/services/web_push.py)が端末の鍵で暗号化して送り、ブラウザが復号して push で渡す:
 *   { title, body, url, tag, kind }
 * 通知を押したら、同じサイトの url を開く(開いている画面があればそこへ移る)。他のサイトへは移らない。
 *
 * [Gate Remaining-1] アプリの殻(画面の HTML・JS・CSS・アイコン)を端末に置き、通信が無くても画面を開けるようにする。
 * - API(/api/)の応答は一切置かない(個人の情報は暗号化した端末の保存(Offline Pack)だけが持つ)
 * - 画面の HTML は通信を優先し、通信できない時だけ置いた物を出す(無ければ offline.html)
 * - /assets/ は名前に内容のハッシュがあるので、置いた物を優先する。古い物は数を決めて消す
 * 同じ範囲(/)に Service Worker は 1 つしか置けないため、通知と同じこのファイルで受け持つ。
 */
const SHELL = 'tc-shell-v1';
const SHELL_MAX = 300;
const PRECACHE = ['/', '/offline.html', '/manifest.json', '/icons/icon-192x192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).catch(() => undefined).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith('tc-shell-') && k !== SHELL).map((k) => caches.delete(k)));
  await self.clients.claim();
})()));

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= SHELL_MAX) return;
  await Promise.all(keys.slice(0, keys.length - SHELL_MAX).map((k) => cache.delete(k)));
}

async function put(request, response) {
  if (!response || !response.ok || response.type !== 'basic') return;
  const cache = await caches.open(SHELL);
  await cache.put(request, response);
  await trim(cache);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/u/')) return;
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
          await put(new Request('/'), res.clone()).catch(() => undefined);
        }
        return res;
      } catch {
        return (await caches.match('/')) || (await caches.match('/offline.html')) || Response.error();
      }
    })());
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      event.waitUntil(put(req, res.clone()).catch(() => undefined));
      return res;
    })());
    return;
  }
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.json' || url.pathname.startsWith('/fonts/')) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      const net = fetch(req).then((res) => { event.waitUntil(put(req, res.clone()).catch(() => undefined)); return res; });
      return hit || net;
    })());
  }
});

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
