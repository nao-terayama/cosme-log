/* Cosme log — オフライン対応(Service Worker)
   注意: アプリのファイルを更新したら、下のバージョン番号を必ず1つ上げること。 */
'use strict';

const CACHE = 'cosmelog-v2';

const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/db.js',
  'js/app.js',
  'js/vendor/zxing.min.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

// インストール時: アプリ一式をキャッシュに保存
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// 有効化時: 古いバージョンのキャッシュを削除
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 楽天APIや画像中継サービスなど外部への通信はそのまま通す
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate') {
    // ページ本体: まずネットワーク(最新を取りに行く)、つながらなければキャッシュ
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('index.html', copy));
          return res;
        })
        .catch(() => caches.match('index.html'))
    );
    return;
  }

  // その他のファイル: キャッシュ優先で即表示し、裏で新しいものを取りに行く
  e.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
