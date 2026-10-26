/* Minecore portal · service worker b496: badge + notificación de avisos. No cachea nada.
   b480 EFCH t1065: la página (navegación) se pide SIEMPRE a la red sin caché HTTP, para que cada build nuevo llegue al iPhone; sin red ⇒ intento normal.
   b474 REGLA GLOBAL: cada push de aviso lleva tag estable = clave del aviso («av:tipo:ref»); tocarla abre el registro exacto (#/doc/<número>);
   al cerrar/leer el aviso (en este u otro equipo) el banner lo quita la APP (mensaje «mc-sync»/«mc-close»); nunca hay push de cierre. */
var SWV='b518';
self.addEventListener('fetch',function(e){var r=e.request;if(r.mode!=='navigate'||r.method!=='GET')return;
  e.respondWith(fetch(r.url,{cache:'no-store',credentials:'same-origin'}).catch(function(){return fetch(r);}));});
self.addEventListener('install',function(e){self.skipWaiting();});
self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim());});
function mcNum(t){var m=String(t||'').match(/MCOR-(?:SO|SQ|PO|PQ|MO|ST|SA|SC|TR)-\d+(?:-\d+)?/i);return m?m[0].toUpperCase():'';}
function mcLink(a){var n=mcNum((a&&a.ref)||'')||mcNum((a&&a.texto)||'');if(n)return './#/doc/'+encodeURIComponent(n);if(a&&a.destino)return './#/'+encodeURIComponent(a.destino);return './';}
function mcCerrar(fn){return self.registration.getNotifications().then(function(L){L.forEach(function(x){if(fn(x))x.close();});});}
self.addEventListener('push',function(e){
  /* REGLA iOS (userVisibleOnly): TODO push muestra una notificación, pase lo que pase (si algo falla, igual se muestra la genérica). */
  var d={},n=0,av=null,opt;
  try{try{d=e.data?e.data.json():{};}catch(x){d={body:e.data?e.data.text():''};}d=d||{};n=Number(d.n)||0;av=d.aviso||null;}catch(x){d={};}
  try{opt={body:d.body||(n?n+' avisos pendientes':'Sin avisos pendientes'),tag:d.silent?'mc-badge':(d.tag||'mc-aviso-'+Date.now()),silent:!!d.silent,icon:'apple-touch-icon.png',badge:'favicon-32.png',
      data:{url:mcLink(av||{texto:d.body}),clave:(av&&av.clave)||d.tag||'',texto:d.body||''}};}catch(x){opt={body:'Minecore',data:{url:'./'}};}
  var badgeP=Promise.resolve();
  try{if(self.navigator&&self.navigator.setAppBadge)badgeP=(n>0?self.navigator.setAppBadge(n):self.navigator.clearAppBadge()).catch(function(){});}catch(x){}
  var show=self.registration.showNotification(d.title||'Minecore',opt).catch(function(){return self.registration.showNotification('Minecore',{body:'Tienes avisos en Minecore',data:{url:'./'}});});
  e.waitUntil(Promise.all([show,badgeP]));
});
self.addEventListener('message',function(e){var m=e.data||{};
  if(m.type==='mc-close'&&m.clave)e.waitUntil(mcCerrar(function(x){return x.tag===m.clave;}));
  if(m.type==='mc-sync'&&Array.isArray(m.abiertos))e.waitUntil(mcCerrar(function(x){return x.tag==='mc-badge'||(/^av:/.test(x.tag)&&m.abiertos.indexOf(x.tag)<0);}));});
self.addEventListener('notificationclick',function(e){e.notification.close();var dt=e.notification.data||{},url=dt.url||mcLink({texto:e.notification.body});
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(L){for(var i=0;i<L.length;i++){if('focus' in L[i]){L[i].postMessage({type:'mc-deep',url:url,clave:dt.clave||''});return L[i].focus();}}return self.clients.openWindow(url);}));});
