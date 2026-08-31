/**
 * TravelCanvas Service Worker
 * PWA機能、オフライン対応、キャッシュ管理、プッシュ通知
 */

const CACHE_NAME = 'travelcanvas-v1.0.0';
const OFFLINE_CACHE = 'travelcanvas-offline-v1';
const RUNTIME_CACHE = 'travelcanvas-runtime-v1';

// キャッシュするリソース
const STATIC_RESOURCES = [
  '/',
  '/manifest.json',
  '/offline.html',
  '/assets/css/app.css',
  '/assets/js/app.js',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// APIキャッシュ戦略
const API_CACHE_STRATEGIES = {
  // ユーザー情報: ネットワーク優先、キャッシュフォールバック
  '/api/v1/auth/me': 'networkFirst',
  '/api/v1/users/': 'networkFirst',
  
  // プラン情報: キャッシュ優先、ネットワーク更新
  '/api/v1/travel/plans': 'cacheFirst',
  
  // 検索結果: ネットワーク優先
  '/api/v1/travel/search': 'networkFirst',
  '/api/v1/ai/': 'networkOnly',
  
  // 静的データ: キャッシュ優先
  '/api/v1/spots/': 'cacheFirst'
};

// Service Worker インストール
self.addEventListener('install', event => {
  console.log('Service Worker installing...');
  
  event.waitUntil(
    Promise.all([
      // 静的リソースのキャッシュ
      caches.open(CACHE_NAME).then(cache => {
        console.log('Caching static resources');
        return cache.addAll(STATIC_RESOURCES);
      }),
      
      // オフラインページのキャッシュ
      caches.open(OFFLINE_CACHE).then(cache => {
        return cache.add('/offline.html');
      })
    ]).then(() => {
      console.log('Service Worker installed successfully');
      // 新しいService Workerを即座にアクティブ化
      self.skipWaiting();
    })
  );
});

// Service Worker アクティベート
self.addEventListener('activate', event => {
  console.log('Service Worker activating...');
  
  event.waitUntil(
    Promise.all([
      // 古いキャッシュの削除
      caches.keys().then(cacheNames => {
        const deletePromises = cacheNames
          .filter(name => name !== CACHE_NAME && name !== OFFLINE_CACHE && name !== RUNTIME_CACHE)
          .map(name => {
            console.log('Deleting old cache:', name);
            return caches.delete(name);
          });
        return Promise.all(deletePromises);
      }),
      
      // すべてのクライアントを制御
      self.clients.claim()
    ]).then(() => {
      console.log('Service Worker activated successfully');
    })
  );
});

// フェッチイベント（リクエストインターセプト）
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Chrome拡張機能のリクエストは無視
  if (url.protocol === 'chrome-extension:') {
    return;
  }
  
  // APIリクエストの処理
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(request));
    return;
  }
  
  // HTMLページのリクエスト処理
  if (request.destination === 'document') {
    event.respondWith(handleDocumentRequest(request));
    return;
  }
  
  // 静的リソースの処理
  event.respondWith(handleStaticRequest(request));
});

/**
 * APIリクエストの処理
 */
async function handleApiRequest(request) {
  const url = new URL(request.url);
  const strategy = getApiCacheStrategy(url.pathname);
  
  try {
    switch (strategy) {
      case 'networkFirst':
        return await networkFirst(request);
      case 'cacheFirst':
        return await cacheFirst(request);
      case 'networkOnly':
        return await fetch(request);
      default:
        return await networkFirst(request);
    }
  } catch (error) {
    console.error('API request failed:', error);
    
    // オフライン時のフォールバック
    if (request.method === 'GET') {
      const cachedResponse = await caches.match(request);
      if (cachedResponse) {
        return cachedResponse;
      }
    }
    
    // オフライン用のエラーレスポンス
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'OFFLINE_ERROR',
          message: 'オフラインのため、この操作は利用できません'
        },
        offline: true
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * ドキュメントリクエストの処理
 */
async function handleDocumentRequest(request) {
  try {
    // ネットワークから取得を試行
    const response = await fetch(request);
    
    // 成功した場合はレスポンスを返し、キャッシュに保存
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
      return response;
    }
    
    throw new Error(`HTTP ${response.status}`);
    
  } catch (error) {
    console.log('Document request failed, serving from cache or offline page');
    
    // キャッシュから取得を試行
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // オフラインページを返す
    const offlineResponse = await caches.match('/offline.html');
    return offlineResponse || new Response('Offline', { status: 503 });
  }
}

/**
 * 静的リソースの処理
 */
async function handleStaticRequest(request) {
  try {
    // キャッシュから検索
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // ネットワークから取得
    const response = await fetch(request);
    
    // 成功した場合はキャッシュに保存
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    
    return response;
    
  } catch (error) {
    console.error('Static request failed:', error);
    return new Response('Resource not available offline', { status: 503 });
  }
}

/**
 * ネットワーク優先戦略
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    
    if (response.ok && request.method === 'GET') {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw error;
  }
}

/**
 * キャッシュ優先戦略
 */
async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    // バックグラウンドでキャッシュを更新
    updateCacheInBackground(request);
    return cachedResponse;
  }
  
  const response = await fetch(request);
  if (response.ok && request.method === 'GET') {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
  }
  
  return response;
}

/**
 * バックグラウンドキャッシュ更新
 */
async function updateCacheInBackground(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(request, response);
    }
  } catch (error) {
    console.log('Background cache update failed:', error);
  }
}

/**
 * APIキャッシュ戦略の取得
 */
function getApiCacheStrategy(pathname) {
  for (const [pattern, strategy] of Object.entries(API_CACHE_STRATEGIES)) {
    if (pathname.includes(pattern)) {
      return strategy;
    }
  }
  return 'networkFirst';
}

// プッシュ通知の処理
self.addEventListener('push', event => {
  console.log('Push notification received:', event);
  
  if (!event.data) return;
  
  try {
    const data = event.data.json();
    const options = {
      body: data.body || 'TravelCanvasからの通知です',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      image: data.image,
      tag: data.tag || 'travelcanvas-notification',
      renotify: true,
      requireInteraction: data.requireInteraction || false,
      actions: data.actions || [],
      data: data.data || {}
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title || 'TravelCanvas', options)
    );
  } catch (error) {
    console.error('Failed to show notification:', error);
  }
});

// 通知クリックの処理
self.addEventListener('notificationclick', event => {
  console.log('Notification clicked:', event);
  
  event.notification.close();
  
  const data = event.notification.data || {};
  const action = event.action;
  
  let url = '/';
  
  if (action === 'view_plan' && data.planId) {
    url = `/planner/${data.planId}`;
  } else if (action === 'open_dashboard') {
    url = '/dashboard';
  } else if (data.url) {
    url = data.url;
  }
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // 既に開いているウィンドウがあるかチェック
        for (const client of clientList) {
          if (client.url.includes(new URL(url, self.location.origin).pathname) && 'focus' in client) {
            return client.focus();
          }
        }
        
        // 新しいウィンドウを開く
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

// バックグラウンド同期
self.addEventListener('sync', event => {
  console.log('Background sync triggered:', event.tag);
  
  if (event.tag === 'plan-sync') {
    event.waitUntil(syncPlans());
  } else if (event.tag === 'upload-images') {
    event.waitUntil(uploadPendingImages());
  }
});

/**
 * プラン同期
 */
async function syncPlans() {
  try {
    // IndexedDBから同期待ちのプランを取得
    const pendingPlans = await getPendingPlans();
    
    for (const plan of pendingPlans) {
      try {
        await fetch('/api/v1/travel/plans', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${plan.token}`
          },
          body: JSON.stringify(plan.data)
        });
        
        // 同期成功したプランを削除
        await removePendingPlan(plan.id);
        
      } catch (error) {
        console.error('Failed to sync plan:', plan.id, error);
      }
    }
  } catch (error) {
    console.error('Plan sync failed:', error);
  }
}

/**
 * 画像アップロード
 */
async function uploadPendingImages() {
  try {
    const pendingImages = await getPendingImages();
    
    for (const image of pendingImages) {
      try {
        const formData = new FormData();
        formData.append('image', image.blob);
        formData.append('planId', image.planId);
        
        await fetch('/api/v1/upload/image', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${image.token}`
          },
          body: formData
        });
        
        await removePendingImage(image.id);
        
      } catch (error) {
        console.error('Failed to upload image:', image.id, error);
      }
    }
  } catch (error) {
    console.error('Image upload failed:', error);
  }
}

// IndexedDB操作用の仮関数（実装は別途必要）
async function getPendingPlans() {
  // IndexedDBから同期待ちプランを取得
  return [];
}

async function removePendingPlan(id) {
  // IndexedDBから同期済みプランを削除
}

async function getPendingImages() {
  // IndexedDBから同期待ち画像を取得
  return [];
}

async function removePendingImage(id) {
  // IndexedDBから同期済み画像を削除
}