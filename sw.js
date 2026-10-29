const CACHE='two-team-php-v1';
const SHELL=['/assets/icons/two-manga-logo.svg','/team','/assets/app/offline.js','/assets/app/responsive.css','/assets/app/responsive.css?v=2','/assets/fonts/IRANSans-FaNum-Medium.ttf','/assets/icons/two-manga-192.png','/assets/icons/two-manga-512.png','/manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
// A new version waits for all old windows to close, preventing mixed code during an upload.
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('two-manga-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/api/')||url.pathname==='/healthz')return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put('/team',copy)));}return response;}).catch(()=>caches.match('/team')));
    return;
  }
  if(SHELL.includes(url.pathname))event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
