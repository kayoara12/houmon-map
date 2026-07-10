// 訪問マップ Service Worker — オフライン対応（地図タイル・アプリ本体のキャッシュ）
var VERSION = 'v1';
var APP_CACHE = 'app-' + VERSION;
var TILE_CACHE = 'tiles-' + VERSION;
var MAX_TILES = 4000; // タイルキャッシュの上限（超えたら古いものから削除）

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== APP_CACHE && k !== TILE_CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function trimTiles() {
  return caches.open(TILE_CACHE).then(function (cache) {
    return cache.keys().then(function (keys) {
      if (keys.length <= MAX_TILES) return;
      return Promise.all(keys.slice(0, keys.length - MAX_TILES).map(function (req) {
        return cache.delete(req);
      }));
    });
  });
}

// キャッシュ優先（ヒットしたら即返し、なければ取得して保存）
function cacheFirst(cacheName, request, trim) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        if (res && res.ok) {
          cache.put(request, res.clone());
          if (trim) trimTiles();
        }
        return res;
      });
    });
  });
}

// ネットワーク優先（オフライン時のみキャッシュへフォールバック）
function networkFirst(cacheName, request) {
  return caches.open(cacheName).then(function (cache) {
    return fetch(request).then(function (res) {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    }).catch(function () {
      return cache.match(request).then(function (hit) {
        if (hit) return hit;
        throw new Error('offline and not cached');
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return; // Supabase等の書き込みは触らない
  var url = new URL(req.url);

  // 地図タイル（地理院）: キャッシュ優先。オフラインでも表示できる
  if (url.hostname === 'cyberjapandata.gsi.go.jp') {
    e.respondWith(cacheFirst(TILE_CACHE, req, true));
    return;
  }
  // CDNライブラリ（バージョン固定なのでキャッシュ優先）
  if (url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(cacheFirst(APP_CACHE, req, false));
    return;
  }
  // アプリ本体・設定（同一オリジン）: ネットワーク優先（更新を優先し、オフライン時はキャッシュ）
  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(APP_CACHE, req));
    return;
  }
  // それ以外（住所検索API・SupabaseのGET等）は素通し
});
