// TravelCanvas Service Worker
// Version: 1.0.0

const CACHE_NAME = 'travelcanvas-v1.0.0'
const API_CACHE_NAME = 'travelcanvas-api-v1.0.0'
const IMAGE_CACHE_NAME = 'travelcanvas-images-v1.0.0'
const STATIC_CACHE_NAME = 'travelcanvas-static-v1.0.0'

// キャッシュするリソース
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
]

// API エンドポイント
const API_ENDPOINTS = [
  '/api/v1/auth/me',
  '/api/v1/travel/plans',
  '/api/v1/ai/search',
]

// インストール時の処理
self.addEventListener('install', (event) => {
  console.log('[SW] Install event')
  
  event.waitUntil(
    Promise.all([
      // 静的アセットのキャッシュ
      caches.open(STATIC_CACHE_NAME).then((cache) => {
        console.log('[SW] Caching static assets')
        return cache.addAll(STATIC_ASSETS)
      }),
      
      // 即座にアクティベート
      self.skipWaiting(),
    ])
  )
})

// アクティベート時の処理
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event')
  
  event.waitUntil(
    Promise.all([
      // 古いキャッシュの削除
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (
              cacheName !== CACHE_NAME &&
              cacheName !== API_CACHE_NAME &&
              cacheName !== IMAGE_CACHE_NAME &&
              cacheName !== STATIC_CACHE_NAME
            ) {
              console.log('[SW] Deleting old cache:', cacheName)
              return caches.delete(cacheName)
            }
          })
        )
      }),
      
      // 全てのクライアントを制御
      self.clients.claim(),
    ])
  )
})

// フェッチイベントの処理
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  
  // Chrome拡張機能のリクエストは無視
  if (url.protocol === 'chrome-extension:') {
    return
  }
  
  // GET リクエストのみ処理
  if (request.method !== 'GET') {
    return
  }
  
  event.respondWith(handleFetch(request))
})

// フェッチ処理のメインロジック
async function handleFetch(request) {
  const url = new URL(request.url)
  
  try {
    // API リクエストの処理
    if (url.pathname.startsWith('/api/')) {
      return await handleApiRequest(request)
    }
    
    // 画像リクエストの処理
    if (isImageRequest(request)) {
      return await handleImageRequest(request)
    }
    
    // 静的アセットの処理
    if (isStaticAsset(request)) {
      return await handleStaticAsset(request)
    }
    
    // ナビゲーションリクエストの処理
    if (request.mode === 'navigate') {
      return await handleNavigation(request)
    }
    
    // その他のリクエスト
    return await fetch(request)
    
  } catch (error) {
    console.error('[SW] Fetch error:', error)
    return await handleFallback(request)
  }
}

// API リクエストの処理（Network First）
async function handleApiRequest(request) {
  const cache = await caches.open(API_CACHE_NAME)
  
  try {
    // ネットワークを最初に試行
    const networkResponse = await fetch(request.clone())
    
    // 成功した場合はキャッシュに保存
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone())
    }
    
    return networkResponse
    
  } catch (error) {
    // ネットワークエラー時はキャッシュから取得
    console.log('[SW] Network failed, trying cache for API request')
    const cachedResponse = await cache.match(request)
    
    if (cachedResponse) {
      return cachedResponse
    }
    
    // キャッシュもない場合はオフライン応答
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'OFFLINE',
          message: 'オフライン中です。ネットワーク接続を確認してください。',
        },
      }),
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    )
  }
}

// 画像リクエストの処理（Cache First）
async function handleImageRequest(request) {
  const cache = await caches.open(IMAGE_CACHE_NAME)
  const cachedResponse = await cache.match(request)
  
  if (cachedResponse) {
    return cachedResponse
  }
  
  try {
    const networkResponse = await fetch(request)
    
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone())
    }
    
    return networkResponse
    
  } catch (error) {
    // フォールバック画像を返す
    return await cache.match('/icons/fallback-image.png')
  }
}

// 静的アセットの処理（Cache First）
async function handleStaticAsset(request) {
  const cache = await caches.open(STATIC_CACHE_NAME)
  const cachedResponse = await cache.match(request)
  
  if (cachedResponse) {
    return cachedResponse
  }
  
  try {
    const networkResponse = await fetch(request)
    
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone())
    }
    
    return networkResponse
    
  } catch (error) {
    throw error
  }
}

// ナビゲーションリクエストの処理
async function handleNavigation(request) {
  try {
    // ネットワークを最初に試行
    const networkResponse = await fetch(request)
    return networkResponse
    
  } catch (error) {
    // オフライン時はオフラインページを表示
    console.log('[SW] Navigation failed, serving offline page')
    const cache = await caches.open(STATIC_CACHE_NAME)
    return await cache.match('/offline.html')
  }
}

// フォールバック処理
async function handleFallback(request) {
  const url = new URL(request.url)
  
  // ナビゲーションリクエストの場合
  if (request.mode === 'navigate') {
    const cache = await caches.open(STATIC_CACHE_NAME)
    return await cache.match('/offline.html')
  }
  
  // 画像リクエストの場合
  if (isImageRequest(request)) {
    const cache = await caches.open(IMAGE_CACHE_NAME)
    return await cache.match('/icons/fallback-image.png')
  }
  
  // その他の場合
  return new Response('', {
    status: 408,
    statusText: 'Request Timeout',
  })
}

// ヘルパー関数
function isImageRequest(request) {
  return request.destination === 'image' ||
         /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(new URL(request.url).pathname)
}

function isStaticAsset(request) {
  const url = new URL(request.url)
  return url.origin === self.location.origin &&
         (url.pathname.startsWith('/assets/') ||
          url.pathname.startsWith('/icons/') ||
          url.pathname === '/manifest.json' ||
          url.pathname === '/favicon.ico')
}

// バックグラウンド同期
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag)
  
  if (event.tag === 'background-sync-plan') {
    event.waitUntil(syncPlanData())
  }
})

// プランデータの同期
async function syncPlanData() {
  try {
    // IndexedDBから未同期データを取得
    const unsyncedData = await getUnsyncedData()
    
    if (unsyncedData.length > 0) {
      console.log('[SW] Syncing', unsyncedData.length, 'items')
      
      for (const item of unsyncedData) {
        try {
          await syncItem(item)
          await markAsSynced(item.id)
        } catch (error) {
          console.error('[SW] Failed to sync item:', item.id, error)
        }
      }
    }
    
  } catch (error) {
    console.error('[SW] Background sync failed:', error)
  }
}

// プッシュ通知
self.addEventListener('push', (event) => {
  console.log('[SW] Push received')
  
  if (!event.data) {
    return
  }
  
  const data = event.data.json()
  const options = {
    body: data.body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    tag: data.tag || 'general',
    data: data.data || {},
    actions: data.actions || [
      {
        action: 'open',
        title: '開く',
        icon: '/icons/action-open.png',
      },
      {
        action: 'close',
        title: '閉じる',
        icon: '/icons/action-close.png',
      },
    ],
    requireInteraction: data.requireInteraction || false,
    silent: data.silent || false,
    vibrate: data.vibrate || [200, 100, 200],
  }
  
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  )
})

// 通知クリック
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification click:', event.action)
  
  event.notification.close()
  
  if (event.action === 'close') {
    return
  }
  
  const urlToOpen = event.notification.data?.url || '/'
  
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      // 既存のウィンドウがあれば、そこに移動
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus()
        }
      }
      
      // 新しいウィンドウを開く
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen)
      }
    })
  )
})

// メッセージ処理
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data)
  
  const { type, payload } = event.data
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting()
      break
      
    case 'GET_VERSION':
      event.ports[0].postMessage({
        type: 'VERSION',
        payload: { version: CACHE_NAME },
      })
      break
      
    case 'CACHE_URLS':
      event.waitUntil(
        cacheUrls(payload.urls).then(() => {
          event.ports[0].postMessage({
            type: 'CACHE_URLS_RESPONSE',
            payload: { success: true },
          })
        })
      )
      break
      
    default:
      console.log('[SW] Unknown message type:', type)
  }
})

// URL群をキャッシュ
async function cacheUrls(urls) {
  const cache = await caches.open(CACHE_NAME)
  return cache.addAll(urls)
}

// IndexedDB ヘルパー関数（簡易実装）
async function getUnsyncedData() {
  // TODO: IndexedDBから未同期データを取得
  return []
}

async function syncItem(item) {
  // TODO: サーバーにデータを送信
  return fetch('/api/v1/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(item),
  })
}

async function markAsSynced(id) {
  // TODO: IndexedDBで同期済みマークを付ける
  console.log('[SW] Marked as synced:', id)
}

console.log('[SW] Service Worker loaded')