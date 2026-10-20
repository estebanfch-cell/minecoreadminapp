/* Minecore portal · service worker b465 (r478): solo badge + notificación de avisos. No cachea nada (la app carga igual que antes). */
self.addEventListener('install',function(e){self.skipWaiting();});
self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim());});
self.addEventListener('push',function(e){
  var d={};try{d=e.data?e.data.json():{};}catch(x){d={body:e.data?e.data.text():''};}
  var n=Number(d.n)||0;
  var p=[];
  if(self.navigator&&self.navigator.setAppBadge){p.push(n>0?self.navigator.setAppBadge(n).catch(function(){}):self.navigator.clearAppBadge().catch(function(){}));}
  /* iOS exige mostrar una notificación por cada push; las de solo-contador usan la misma etiqueta y van en silencio */
  p.push(self.registration.showNotification(d.title||'Minecore',{body:d.body||(n?n+' avisos pendientes':'Sin avisos pendientes'),tag:d.silent?'mc-badge':'mc-aviso-'+Date.now(),silent:!!d.silent,icon:'apple-touch-icon.png',badge:'favicon-32.png',data:{url:'./'}}));
  e.waitUntil(Promise.all(p));
});
self.addEventListener('notificationclick',function(e){e.notification.close();
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(L){for(var i=0;i<L.length;i++){if('focus' in L[i])return L[i].focus();}return self.clients.openWindow('./');}));});
