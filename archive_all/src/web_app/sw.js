// Service Worker for AI Training Center
// Network-first strategy with fallback to cache

const CACHE_VERSION = 'v3';  // 버전 업데이트
const CACHE_NAME = `ai-training-${CACHE_VERSION}`;

// Only cache external resources (fonts, CDN scripts)
const EXTERNAL_RESOURCES = [
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
    'https://cdnjs.cloudflare.com'
];

// Install - skip waiting to activate immediately
self.addEventListener('install', event => {
    console.log('[SW] Installing new version:', CACHE_VERSION);
    self.skipWaiting();  // 즉시 활성화
});

// Activate - clean up old caches
self.addEventListener('activate', event => {
    console.log('[SW] Activating:', CACHE_VERSION);
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            // 즉시 클라이언트 제어 시작
            return self.clients.claim();
        })
    );
});

// Message handler - 캐시 클리어 요청 처리
self.addEventListener('message', event => {
    if (event.data === 'CLEAR_CACHE' || event.data?.type === 'CLEAR_CACHE') {
        console.log('[SW] Clearing all caches...');
        event.waitUntil(
            caches.keys().then(names => {
                return Promise.all(
                    names.map(name => {
                        console.log('[SW] Deleting cache:', name);
                        return caches.delete(name);
                    })
                );
            }).then(() => {
                console.log('[SW] All caches cleared');
                // 클라이언트에 완료 알림
                if (event.source) {
                    event.source.postMessage({ type: 'CACHE_CLEARED' });
                }
            })
        );
    }
});

// Fetch - Network first, cache fallback (for external resources only)
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // 로컬 파일은 항상 네트워크에서 가져옴 (캐시 사용 안 함)
    if (url.origin === self.location.origin) {
        // Local files: network only (no cache)
        event.respondWith(fetch(event.request));
        return;
    }

    // 외부 리소스 (CDN, 폰트): network first, cache fallback
    const isExternalResource = EXTERNAL_RESOURCES.some(r => url.href.startsWith(r));

    if (isExternalResource) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Cache the external resource
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseClone);
                    });
                    return response;
                })
                .catch(() => {
                    // Fallback to cache if network fails
                    return caches.match(event.request);
                })
        );
    } else {
        // Other external requests: just fetch
        event.respondWith(fetch(event.request));
    }
});
