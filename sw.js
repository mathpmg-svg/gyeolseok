/* 오프라인에서도 열리도록 앱 파일을 캐시한다.
   파일을 수정했다면 아래 CACHE 값을 v5, v6... 으로 올려야 새 버전이 반영된다. */

const CACHE = 'attendance-v11';

/* 없으면 앱이 안 뜨는 필수 파일 */
const CORE = [
  './index.html',
  './app.css',
  './app.js'
];

/* 있으면 좋지만 없어도 앱은 도는 파일 */
const EXTRA = [
  './',
  './manifest.webmanifest',
  './favicon.ico',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon-32.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);

    // 필수 파일은 하나라도 실패하면 설치를 중단한다
    await c.addAll(CORE);

    // 부가 파일은 개별로 담아, 하나가 없어도 설치가 깨지지 않게 한다
    await Promise.all(EXTRA.map(u =>
      c.add(u).catch(() => { /* 이 파일만 건너뛴다 */ })
    ));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // 같은 사이트의 파일만 다룬다 (외부 폰트 등은 브라우저에 맡긴다)
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 캐시 우선, 네트워크로 조용히 갱신
  e.respondWith((async () => {
    const hit = await caches.match(req);

    const net = fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => null);

    if (hit) return hit;

    const res = await net;
    if (res) return res;

    // 오프라인이고 캐시에도 없으면 첫 화면이라도 돌려준다
    if (req.mode === 'navigate') {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    return Response.error();
  })());
});
