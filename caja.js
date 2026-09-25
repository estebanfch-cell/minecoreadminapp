/* Native Caja + Rutas for Minecore Admin (index v201). Data via minecore SCRIPT_URL.
   Maps: Google Maps JS (Minecore Portal Maps / minecore.ec org) — places+geometry, shortest route.
   OSM/Leaflet only if Google fails (RefererNotAllowed). No Caja PIN. */
(function (global) {
  'use strict';

  const CAJA_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwey092-gmFNWsJQmJVSZ9aiSVNxMCFUhfcu_3hyotGNtc6219atTs-y3dApG3JtWw/exec';
  const MINECORE_LL = {lat:-0.1940519, lng:-78.4841933};
  const MINECORE_ADDR = 'Minecore S.A.S \u2014 Alpallana E7-212, Quito';
  const MAPS_KEY = 'AIzaSyBV61oL-BrmLYIm5aof56ql-C8aLBNcx8A';
  const MAPS_SRC = 'https://maps.googleapis.com/maps/api/js?key='+MAPS_KEY+'&libraries=places,geometry&callback=mapsReady';
  const MAPS_EMBED_ORIGIN = 'https://estebanfch-cell.github.io';
  const MAPS_EMBED_URL = MAPS_EMBED_ORIGIN + '/minecore/maps-embed.html?v=1';
  const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
  const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
  const CAJA_USER_ALIASES = {
    esteban:'EFCH','esteban ferlito':'EFCH',efch:'EFCH',
    osvaldo:'OPM','oswaldo pena':'OPM','oswaldo peña':'OPM',opm:'OPM',
    secre:'SECRE','secre conta':'SECRE',secreconta:'SECRE'
  };
  const VEH_OWNER = {
    'Camioneta Nissan': 'EFCH',
    'Moto Minecore': 'EFCH',
    'Camioneta Mazda': 'MPL',
    'Camioneta Poer': 'OPM'
  };
  const VEH_RATE = {'Moto Minecore': 0.15};
  const AV_COLORS = {
    E:{bg:'#185FA5',tx:'#fff'}, M:{bg:'#085041',tx:'#fff'},
    O:{bg:'#854F0B',tx:'#fff'}, A:{bg:'#993556',tx:'#fff'},
    S:{bg:'#444441',tx:'#fff'}, _:{bg:'#444441',tx:'#fff'}
  };
  const NAME_HINTS = {
    EFCH:'Esteban Ferlito', MPL:'Martin Pinto', OPM:'Oswaldo Pena',
    AG:'Angel Guachamin', SECRE:'SECRE Conta',
    Osvaldo:'Oswaldo Pena', Secre:'SECRE Conta'
  };

  const COLAB_SEED=[
    {usuario:'EFCH',nombre:'Esteban Ferlito',rol:'admin',activo:'SI'},
    {usuario:'OPM',nombre:'Oswaldo Pena',rol:'chofer',activo:'SI'},
    {usuario:'MPL',nombre:'Martin Pinto',rol:'chofer',activo:'SI'},
    {usuario:'AG',nombre:'Angel Guachamin',rol:'chofer',activo:'SI'}
  ];
  let session=null, cfg={precio_km:0.40, corte_dia_inicio:26, corte_dia_fin:25}, allUsers=COLAB_SEED.slice();
  let currentMod='', activeView='';
  let mReady=false, gmap, dirSvc, dirRen, geocoder;
  let originLL=null, paradas=[], routeKm=0, markers=[], routeDur='';
  let mapsMode='none';
  let mapsEmbedWin=null, mapsEmbedReady=false, lmap=null, lRoute=null, lOrigin=null;
  let favs=[];
  try{ favs=JSON.parse(localStorage.getItem('mc_favs')||'[]'); }catch(e){}

  function avc(id){ const k=String(id||'?')[0].toUpperCase(); return AV_COLORS[k]||AV_COLORS._; }
  function col(id){ return avc(id); }

  function getMods(){
    try{ return (getProfile()||{}).modulos||[]; }catch(e){ return []; }
  }
  function getRol(){
    try{ return String((getProfile()||{}).rol||'').toLowerCase(); }catch(e){ return ''; }
  }
  function puedeVer(){
    var ms=getMods();
    return getRol()==='admin' || ms.indexOf('caja')>=0 || ms.indexOf('caja+')>=0;
  }
  function puedeInteractuar(){
    var ms=getMods();
    return getRol()==='admin' || ms.indexOf('caja+')>=0;
  }
  function esAdminCaja(){
    return getRol()==='admin';
  }
  function roMsg(accion){
    return '<div class="page-title">Solo lectura</div><div class="page-sub">Tu permiso de Caja es «Ver». Pedí <b>caja+</b> para '+accion+'.</div>';
  }

  function cajaUsuarioFromAdmin(name){
    var raw=String(name||'').trim();
    if(!raw) return raw;
    var key=raw;
    try{ key=raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim(); }catch(e){ key=raw.toLowerCase(); }
    return CAJA_USER_ALIASES[key] || raw;
  }

  function buildSession(){
    var p={}; try{ p=getProfile()||{}; }catch(e){}
    var user='';
    try{ user=getUserName()||''; }catch(e){}
    if(!user) user=p.nombre||'';
    session={
      usuario:cajaUsuarioFromAdmin(user),
      nombre:p.nombre||user,
      rol: esAdminCaja() ? 'admin' : 'chofer'
    };
    if(!allUsers.length){
      allUsers=[{usuario:session.usuario,nombre:session.nombre,rol:session.rol,activo:'SI'}];
    }
  }

  function cajaParse(txt){
    try{ return JSON.parse(txt); }catch(e){ return null; }
  }
  /* Google a veces responde HTML 404 ("unable to open the file") ANTES de correr el script. */
  function cajaIsGooglePage(txt, status){
    var s=String(txt||'');
    if((status===404||status===500||status===502||status===503) && /<!doctype html|<html/i.test(s)) return true;
    return /unable to open the file|no se pudo abrir el archivo|Page Not Found|Google Drive/i.test(s);
  }
  function cajaFetchOnce(data){
    var isPhoto=data&&data.action==='savePhoto';
    var url=CAJA_SCRIPT_URL;
    var opts;
    if(isPhoto){
      opts={method:'POST',body:JSON.stringify(data),redirect:'follow',credentials:'omit'};
    } else {
      var p=new URLSearchParams();
      Object.keys(data||{}).forEach(function(k){
        var v=data[k];
        if(v===undefined||v===null) return;
        p.append(k, typeof v==='object' ? JSON.stringify(v) : String(v));
      });
      url=CAJA_SCRIPT_URL+'?'+p.toString();
      opts={redirect:'follow',credentials:'omit'};
    }
    return fetch(url, opts).then(function(r){
      return r.text().then(function(txt){
        if(cajaIsGooglePage(txt, r.status)){
          var err=new Error('google-page');
          err.googlePage=true;
          throw err;
        }
        var parsed=cajaParse(txt);
        if(!parsed){
          var err2=new Error('non-json');
          err2.googlePage=true;
          throw err2;
        }
        return parsed;
      });
    });
  }

  /* Same payloads as minecore app.js. Lecturas reintentan el HTML transitorio de Apps Script
     para no pintar $0 cuando el script sí tiene saldo. */
  function cajaCallScript(data){
    var action=String((data&&data.action)||'');
    var lectura=/^(get|list|mi)/.test(action);
    var max=lectura?5:2;
    function intento(n){
      return cajaFetchOnce(data).catch(function(e){
        var google=!!(e&&e.googlePage);
        if(n>=max){
          return {ok:false,error:'Caja API no disponible',_transport:true};
        }
        if(!lectura && !google) throw e;
        var espera=[350,800,1500,2500,4000][n]||4000;
        return new Promise(function(res){ setTimeout(res, espera); }).then(function(){ return intento(n+1); });
      });
    }
    return intento(0);
  }

  function api(data){
    var payload={};
    Object.keys(data||{}).forEach(function(k){ payload[k]=data[k]; });
    if(session){
      if(!payload.admin) payload.admin=session.usuario;
      if(payload.action==='crearRuta' && !payload.usuario) payload.usuario=session.usuario;
      if(payload.action==='crearGasto' && !payload.usuario) payload.usuario=session.usuario;
    }
    return cajaCallScript(payload).catch(function(){
      if(typeof MCpost!=='function') return {ok:false,error:'Error de conexión'};
      var fb={};
      Object.keys(payload).forEach(function(k){ fb[k]=payload[k]; });
      try{ fb.user=getUserName(); fb.pin=getPin(); }catch(e2){}
      return MCpost(fb);
    });
  }

  function mapsReady(){ mReady=true; try{ global._mcMapsReady=true; }catch(e){} }
  function cajaMapsReady(){ mapsReady(); }
  if(global._mcMapsReady) mReady=true;

  function googleMapsOk(){
    return !global._mcMapsAuthFail && !!(global.google && google.maps && google.maps.Map && google.maps.places && google.maps.DirectionsService);
  }

  function mapsReferrerHintHtml(){
    return 'Google Maps no autorizó este dominio (<b>RefererNotAllowed</b>). Los referrers HTTP ya están configurados en la key del portal (portal.minecore.ec y github.io adminapp). Si el Oops persiste, contactá a DevOps.';
  }
  function showMapsReferrerHint(){
    var el=document.getElementById('maps-referrer-hint');
    if(!el) return;
    el.innerHTML=mapsReferrerHintHtml();
    el.classList.add('on');
  }

  function installAuthHook(){
    var prev=global.gm_authFailure;
    global.gm_authFailure=function(){
      global._mcMapsAuthFail=true;
      try{ if(typeof prev==='function' && prev!==global.gm_authFailure) prev(); }catch(e){}
      if(document.getElementById('map') && mapsMode!=='leaflet'){
        fallbackOsmSilent();
      } else {
        showMapsReferrerHint();
      }
    };
  }
  installAuthHook();

  function settleGoogleOk(cb){
    /* RefererNotAllowed often arrives a beat after google.maps exists. */
    setTimeout(function(){
      if(global._mcMapsAuthFail || !googleMapsOk()){ if(cb) cb(false); return; }
      mReady=true;
      if(cb) cb(true);
    }, 900);
  }

  function loadGoogleMaps(cb){
    if(global._mcMapsAuthFail){ if(cb) cb(false); return; }
    if(googleMapsOk()){ settleGoogleOk(cb); return; }
    function waitReady(){
      var n=0;
      var t=setInterval(function(){
        n++;
        if(global._mcMapsAuthFail){ clearInterval(t); if(cb) cb(false); return; }
        if(googleMapsOk()){ clearInterval(t); settleGoogleOk(cb); return; }
        if(n>=30){ clearInterval(t); if(cb) cb(false); }
      },200);
    }
    if(document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]')){
      waitReady();
      return;
    }
    if(global._cajaMapsLoading){ waitReady(); return; }
    global._cajaMapsLoading=true;
    var prevReady=global.mapsReady;
    global.mapsReady=function(){
      mapsReady();
      try{ if(typeof prevReady==='function') prevReady(); }catch(e){}
    };
    global.cajaMapsReady=global.mapsReady;
    var s=document.createElement('script');
    s.id='mc-gmaps-js';
    s.src=MAPS_SRC;
    s.async=true; s.defer=true;
    s.onerror=function(){ global._mcMapsAuthFail=true; if(cb) cb(false); };
    document.head.appendChild(s);
    waitReady();
  }

  function resetPlaceBinds(){
    var ids=['inp-origen'];
    paradas.forEach(function(_,i){ ids.push('pi-'+i); });
    ids.forEach(function(id){
      var inp=document.getElementById(id);
      if(inp){ inp._gac=false; inp._acSetup=false; }
    });
  }

  function fallbackOsmSilent(){
    if(mapsMode==='leaflet') return;
    mapsMode='leaflet';
    showMapsReferrerHint();
    try{ if(gmap) gmap=null; }catch(e){}
    dirSvc=null; dirRen=null; geocoder=null;
    window._originMarker=null;
    resetPlaceBinds();
    var el=document.getElementById('map');
    if(el) el.innerHTML='';
    loadLeaflet(initLeafletMap);
  }

  function loadLeaflet(cb){
    if(global.L){ mReady=true; if(cb)cb(); return; }
    if(global._cajaLeafletLoading){
      var t=setInterval(function(){ if(global.L){ clearInterval(t); mReady=true; if(cb)cb(); } },150);
      return;
    }
    global._cajaLeafletLoading=true;
    if(!document.getElementById('cj-leaflet-css')){
      var lk=document.createElement('link');
      lk.id='cj-leaflet-css'; lk.rel='stylesheet'; lk.href=LEAFLET_CSS;
      document.head.appendChild(lk);
    }
    var s=document.createElement('script');
    s.src=LEAFLET_JS; s.async=true;
    s.onload=function(){ mReady=true; if(cb)cb(); };
    s.onerror=function(){ toast('No se pudo cargar el mapa'); };
    document.head.appendChild(s);
  }
  function probeMapsEmbed(cb){
    var done=false;
    function fin(ok){ if(done) return; done=true; cb(!!ok); }
    var t=setTimeout(function(){ fin(false); }, 2500);
    fetch(MAPS_EMBED_URL, {method:'GET', mode:'cors', cache:'no-store'})
      .then(function(r){ clearTimeout(t); fin(r.ok); })
      .catch(function(){ clearTimeout(t); fin(false); });
  }

  function ensureDom(){
    var root=document.getElementById('caja-screen');
    if(!root) return;
    if(root.getAttribute('data-native')==='1') return;
    root.setAttribute('data-native','1');
    root.innerHTML=
      '<div id="scr-home">'+
        '<div class="cj-home-head">'+
          '<div class="cj-brand">'+
            '<img class="cj-brand-logo" src="apple-touch-icon.png" alt="Minecore" width="28" height="28">'+
            '<span class="cj-brand-txt">MINECORE</span>'+
          '</div>'+
          '<div id="home-av" class="cj-home-av"></div>'+
        '</div>'+
        '<div class="cj-home-greet">'+
          '<div id="greet-name" class="cj-greet-name"></div>'+
          '<div id="home-uname" class="cj-greet-sub"></div>'+
        '</div>'+
        '<div class="cj-home-body">'+
          '<div id="home-attn"></div>'+
          '<div class="home-label">Este período</div>'+
          '<div id="home-metrics" class="hm-grid"></div>'+
          '<div class="home-label">Ver y gestionar</div>'+
          '<div id="home-grid" class="hg-grid"></div>'+
          '<div class="home-label" style="margin-top:18px" id="home-act-label">Actividad reciente</div>'+
          '<div id="home-activity" class="act-list"></div>'+
          '<button type="button" class="cj-admin-back" onclick="cajaLeaveToAdmin()">← Menú Admin</button>'+
        '</div>'+
      '</div>'+
      '<div id="app">'+
        '<div class="topbar">'+
          '<button class="topbar-back" type="button" onclick="cajaGoHome()">‹</button>'+
          '<div class="topbar-dot" id="topbar-dot"></div>'+
          '<div class="topbar-title" id="topbar-title">—</div>'+
          '<div class="topbar-av" id="topbar-av"></div>'+
        '</div>'+
        '<nav class="bottom-nav" id="bottom-nav"></nav>'+
        '<div class="content" id="content"></div>'+
      '</div>'+
      '<nav class="hnav" id="home-nav">'+
        '<button class="hnav-item on" type="button" data-tab="inicio" onclick="cajaGoHome()">'+
          '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z"/></svg>'+
          '<div class="hnav-lbl">Inicio</div>'+
        '</button>'+
        '<button class="hnav-item" type="button" data-tab="rutas" onclick="cajaOpenMod(\'rutas\')">'+
          '<svg viewBox="0 0 24 24"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16"/></svg>'+
          '<div class="hnav-lbl">Rutas</div>'+
        '</button>'+
        '<button class="hnav-item" type="button" data-tab="caja" onclick="cajaOpenMod(\'caja\')">'+
          '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="13" rx="2"/><path d="M16 12h.01M2 10h20"/></svg>'+
          '<div class="hnav-lbl">Caja</div>'+
        '</button>'+
        '<button class="hnav-item" type="button" data-tab="config" id="hnav-config" onclick="cajaOpenMod(\'rutas\',\'config\')">'+
          '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'+
          '<div class="hnav-lbl">Config</div>'+
        '</button>'+
      '</nav>'+
      '<div id="fab-menu" class="fab-menu" style="display:none" onclick="toggleFab(false)">'+
        '<div class="fab-actions">'+
          '<button class="fab-item" id="fab-dinero" onclick="event.stopPropagation();fabGo(\'caja\',\'nueva-entrega\')"><span class="fab-lbl">Entregar dinero</span></button>'+
          '<button class="fab-item" onclick="event.stopPropagation();fabGo(\'rutas\',\'nueva\')"><span class="fab-lbl">Nueva ruta</span></button>'+
          '<button class="fab-item fab-hi" onclick="event.stopPropagation();fabGo(\'caja\',\'nuevo-gasto\')"><span class="fab-lbl">Registrar gasto</span></button>'+
        '</div>'+
      '</div>'+
      '<button id="fab-btn" class="fab" type="button" onclick="toggleFab()">+</button>'+
      '<div class="toast" id="toast"></div>';
  }

  function syncFab(onHome){
    var fab=document.getElementById('fab-btn');
    var menu=document.getElementById('fab-menu');
    var show=!!onHome && puedeInteractuar();
    if(fab) fab.style.display=show?'flex':'none';
    if(menu && !show) menu.style.display='none';
    if(fab && !show) fab.textContent='+';
  }

  function hide(id){ var e=document.getElementById(id); if(e) e.style.display='none'; }
  function show(id){
    var e=document.getElementById(id); if(!e) return;
    e.style.display = (id==='scr-home'||id==='app') ? 'flex' : 'block';
  }
  function hideAll(){ ['scr-home','app'].forEach(hide); }

  function bootHome(){
    api({action:'getConfig'}).then(function(r){ if(r.ok&&r.config) cfg=r.config; }).catch(function(){});
    refreshColaboradores();
    var c=avc(session.usuario);
    var ha=document.getElementById('home-av');
    if(ha){ ha.style.background=c.bg; ha.style.color=c.tx; ha.textContent=session.usuario; }
    try{
      var _pd=getPeriodoDates(0);
      var _M=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
      var _d1=new Date(_pd.fi+'T12:00:00'),_d2=new Date(_pd.ff+'T12:00:00');
      var un=document.getElementById('home-uname');
      if(un) un.textContent='Período '+_d1.getDate()+' '+_M[_d1.getMonth()]+' \u2192 '+_d2.getDate()+' '+_M[_d2.getMonth()];
    }catch(e){ var u2=document.getElementById('home-uname'); if(u2) u2.textContent=''; }
    var gn=document.getElementById('greet-name');
    if(gn) gn.textContent='Hola, '+(session.nombre||session.usuario).split(' ')[0]+'!';
    hideAll(); show('scr-home');
    markHomeTab('inicio');
    syncFab(true);
    setTimeout(renderHomeActions,50);
  }

  function markHomeTab(tab){
    var nav=document.getElementById('home-nav');
    if(!nav) return;
    var items=nav.querySelectorAll('.hnav-item');
    for(var i=0;i<items.length;i++){
      items[i].classList.toggle('on', items[i].getAttribute('data-tab')===tab);
    }
  }
  function tabForView(mod, view){
    if(view==='config'||view==='usuarios') return 'config';
    return mod==='caja'?'caja':(mod==='rutas'?'rutas':'inicio');
  }
  function cajaLeaveToAdmin(){
    try{ if(typeof global.goHome==='function'){ global.goHome(); return; } }catch(e){}
    cajaGoHome();
  }

  function refreshColaboradores(){
    api({action:'getUsuarios'}).then(function(r){
      if(!r||!r.ok||!r.usuarios||!r.usuarios.length) return;
      allUsers=r.usuarios.map(function(u){
        return {usuario:u.usuario,nombre:u.nombre,rol:u.rol,activo:u.activo};
      }).filter(function(u){ return u.activo==='SI'||u.activo===undefined||u.activo===true||u.activo===''; });
    }).catch(function(){});
    api({action:'getBalanceCaja'}).then(function(r){
      if(!r.ok) return;
      var seen={};
      var list=(r.balances||[]).map(function(b){
        seen[b.usuario]=1;
        return {usuario:b.usuario,nombre:b.nombre||NAME_HINTS[b.usuario]||b.usuario,rol:'chofer',activo:'SI'};
      });
      if(session && !seen[session.usuario]){
        list.unshift({usuario:session.usuario,nombre:session.nombre,rol:session.rol,activo:'SI'});
      }
      if(list.length) allUsers=list;
    }).catch(function(){});
  }

  function cajaInit(){
    var root=document.getElementById('caja-screen');
    if(!root) return;
    if(!puedeVer()){
      root.innerHTML='<div class="cbz-error" style="padding:20px">No tienes permiso del módulo Caja.</div>';
      return;
    }
    ensureDom();
    buildSession();
    if(!puedeInteractuar()) root.classList.add('caja-ro'); else root.classList.remove('caja-ro');
    try{ if(typeof mcHideNotifBar==='function') mcHideNotifBar(); }catch(e){}
    bootHome();
  }


  function cajaOpenMod(mod, targetView){
    try{ if(typeof mcHideNotifBar==='function') mcHideNotifBar(); }catch(e){}
    currentMod=mod; hideAll(); show('app');
    var td=document.getElementById('topbar-dot');
    if(td) td.className='topbar-dot '+mod;
    var tt=document.getElementById('topbar-title');
    if(tt){
      if(targetView==='config'||targetView==='usuarios') tt.textContent='Config';
      else tt.textContent=mod==='rutas'?'Rutas':'Caja Chica';
    }
    var c=avc(session.usuario);
    var av=document.getElementById('topbar-av');
    if(av){ av.style.background=c.bg; av.style.color=c.tx; av.textContent=session.usuario; }
    renderNav();
    var def=mod==='rutas'?(session.rol==='chofer'?'mis-rutas':'aprobar'):'balance';
    if(targetView==='config' && !esAdminCaja()){ cajaGoHome(); toast('Solo admin'); return; }
    if((targetView==='nueva'||targetView==='nuevo-gasto'||targetView==='nueva-entrega') && !puedeInteractuar()){
      toast('Permiso de solo lectura'); return;
    }
    syncFab(false);
    markHomeTab(tabForView(mod, targetView||def));
    setView(targetView||def);
  }
  function cajaGoHome(){
    hideAll(); show('scr-home');
    markHomeTab('inicio');
    syncFab(true);
    setTimeout(renderHomeActions,40);
  }

const NAV={
  rutas:{
    chofer:[
      {id:'nueva',   label:'Nueva',    icon:'M12 5v14M5 12h14'},
      {id:'mis-rutas',label:'Mis rutas',icon:'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2'},
      {id:'cuenta',  label:'Mi cuenta',icon:'M12 2a10 10 0 110 20 10 10 0 010-20zm0 6v4l3 3'}
    ],
    admin:[
      {id:'nueva',    label:'Nueva',    icon:'M12 5v14M5 12h14'},
      {id:'aprobar',  label:'Aprobar',  icon:'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11'},
      {id:'historial',label:'Historial',icon:'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2'},
      {id:'corte',    label:'Corte',    icon:'M8 7V3m8 4V3M3 11h18M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'},
      {id:'config',   label:'Config',   icon:'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z'}
    ]
  },
  caja:{
    chofer:[
      {id:'balance',       label:'Balance',  icon:'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z'},
      {id:'nuevo-gasto',   label:'Nuevo',    icon:'M12 5v14M5 12h14'},
      {id:'historial-caja',label:'Historial',icon:'M4 6h16M4 10h16M4 14h16M4 18h16'}
    ],
    admin:[
      {id:'balance',      label:'Balance',  icon:'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z'},
      {id:'nueva-entrega',label:'Entregar', icon:'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2z'},
      {id:'aprobar-gastos',label:'Gastos', icon:'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11'},
      {id:'historial-caja',label:'Historial',icon:'M4 6h16M4 10h16M4 14h16M4 18h16'}
    ]
  }
};

function renderNav(){
  const el=document.getElementById('bottom-nav');
  if(!el)return;
  const CHIPS={
    rutas:{
      admin:[{id:'aprobar',label:'Aprobar'},{id:'historial',label:'Historial'},{id:'corte',label:'Corte'}],
      chofer:[{id:'mis-rutas',label:'Mis rutas'},{id:'historial',label:'Historial'},{id:'cuenta',label:'Mi cuenta'}]
    },
    caja:{
      admin:[{id:'aprobar-gastos',label:'Aprobar'},{id:'historial-caja',label:'Historial'},{id:'balance',label:'Balance'}],
      chofer:[{id:'mis-gastos',label:'Mis gastos'},{id:'historial-caja',label:'Historial'},{id:'balance',label:'Mi caja'}]
    },
    ajustes:{
      admin:[{id:'config',label:'Config'},{id:'usuarios',label:'Usuarios'}],
      chofer:[]
    }
  };
  const isAjustes=(activeView==='config'||activeView==='usuarios');
  const group=isAjustes?'ajustes':currentMod;
  let list=(CHIPS[group]&&CHIPS[group][session.rol])||[];
  // Vistas de creación: mostrar chips del módulo, ninguna activa
  el.innerHTML='<div class="chips">'+list.map(n=>
    '<button class="chip'+(activeView===n.id?' on':'')+'" onclick="setView(\''+n.id+'\')">'+n.label+'</button>'
  ).join('')+'</div>';
}

function setView(v){
  activeView=v; renderNav();
  markHomeTab(tabForView(currentMod, v));
  var tt=document.getElementById('topbar-title');
  if(tt){
    if(v==='config'||v==='usuarios') tt.textContent='Config';
    else if(currentMod==='caja') tt.textContent='Caja Chica';
    else if(currentMod==='rutas') tt.textContent='Rutas';
  }
  const c=document.getElementById('content');
  const views={
    'nueva':vNueva,'mis-rutas':vMisRutas,'cuenta':vCuenta,
    'aprobar':vAprobar,'historial':vHistorial,'corte':vCorte,
    'usuarios':vUsuarios,'config':vConfig,
    'balance':vBalance,'nueva-entrega':vNuevaEntrega,
    'aprobar-gastos':vAprobarGastos,'historial-caja':vHistorialCaja,
    'mis-gastos':vMisGastos,'nuevo-gasto':vNuevoGasto,'mis-entregas':vMisEntregas
  };
  if(views[v]) views[v](c);
  window.scrollTo(0,0);
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function spin(){ return '<div class="loading"><div class="spinner"></div>Cargando...</div>'; }
function empty(msg){ return `<div class="empty">${msg}</div>`; }
function errMsg(){ return `<div class="empty" style="color:var(--err-tx)">⚠️ Error de conexión<br><small>Verifica tu conexión e intenta de nuevo</small></div>`; }
function toast(msg){ const t=document.getElementById('toast'); if(!t) return; t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800); }
function today(){ return new Date().toISOString().split('T')[0]; }
function fd(s){
  if(!s||s==='undefined'||s==='0')return'—';
  const str=String(s).split(' ')[0];
  if(!str.includes('-')&&!isNaN(parseFloat(str))){
    const d=new Date((parseFloat(str)-25569)*86400000);
    const m=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    return d.getDate()+' '+m[d.getMonth()]+' '+d.getFullYear();
  }
  const p=str.split('-'); if(p.length<3)return str;
  const m=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return parseInt(p[2])+' '+m[parseInt(p[1])-1]+' '+p[0];
}
function placeName(dest){
  if(!dest)return'—';
  return dest.split(' → ').map(part=>{
    const dash=part.indexOf(' — ');
    return dash>0?part.substring(0,dash):part.split(',')[0];
  }).join(' → ');
}
function placeAddr(dest){
  if(!dest)return'';
  const last=dest.split(' → ').pop();
  const dash=last.indexOf(' — ');
  return dash>0?last.substring(dash+3):'';
}
function ymdLocal(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function getPeriodoDates(offset){
  const hoy=new Date();
  const dia=hoy.getDate();
  const ini=parseInt(cfg.corte_dia_inicio||26,10)||26;
  let fi,ff;
  if(dia>=ini){
    fi=new Date(hoy.getFullYear(),hoy.getMonth()+offset,ini);
    ff=new Date(hoy.getFullYear(),hoy.getMonth()+offset+1,ini-1);
  } else {
    fi=new Date(hoy.getFullYear(),hoy.getMonth()-1+offset,ini);
    ff=new Date(hoy.getFullYear(),hoy.getMonth()+offset,ini-1);
  }
  /* Fecha local. toISOString() corre el corte un día en zonas UTC+. */
  return{fi:ymdLocal(fi), ff:ymdLocal(ff)};
}
/** Previous Mon–Sun in local calendar (Mon=1). Used by filtro 'semana'. */
function getSemanaAnteriorDates(){
  const hoy=new Date();
  const dow=hoy.getDay(); // 0=Sun … 6=Sat; Mon=1
  const daysSinceMon=dow===0?6:dow-1;
  const thisMon=new Date(hoy.getFullYear(),hoy.getMonth(),hoy.getDate()-daysSinceMon);
  const prevMon=new Date(thisMon.getFullYear(),thisMon.getMonth(),thisMon.getDate()-7);
  const prevSun=new Date(prevMon.getFullYear(),prevMon.getMonth(),prevMon.getDate()+6);
  const ymd=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  return{fi:ymd(prevMon),ff:ymd(prevSun)};
}
function periodLabel(offset){
  const d=getPeriodoDates(offset);
  const m=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const fi=new Date(d.fi+'T12:00:00'), ff=new Date(d.ff+'T12:00:00');
  return `26 ${m[fi.getMonth()]} → 25 ${m[ff.getMonth()]}`;
}
function parseDateStr(s){
  if(!s||s==='undefined')return null;
  const str=String(s).split(' ')[0];
  if(!str.includes('-')&&!isNaN(parseFloat(str))){
    return new Date((parseFloat(str)-25569)*86400000);
  }
  const p=str.split('-'); if(p.length<3)return null;
  return new Date(parseInt(p[0]),parseInt(p[1])-1,parseInt(p[2]),12,0,0);
}
function hide(id){ const e=document.getElementById(id); if(e)e.style.display='none'; }
function show(id){ const e=document.getElementById(id); if(e) e.style.display=(id==='scr-home'||id==='app')?'flex':'block'; }
function hideAll(){ ['scr-home','app'].forEach(hide); }

// ─── BADGE & STATUS ──────────────────────────────────────────────────────────
function badgeClass(est){ return est==='Aprobada'?'approved':est==='Rechazada'?'rejected':'pending'; }

// ─── RUTAS HTML ──────────────────────────────────────────────────────────────
function rutaTicket(r, isAdmin){
  const km=parseFloat(r['KM']||0), val=parseFloat(r['Valor ($)']||0);
  const est=r['Estado']||'Pendiente', bc=badgeClass(est);
  const veh=r['Vehiculo']||'', usr=r['Usuario']||'';
  const destName=placeName(r['Destino']||'—');
  const destAddr=placeAddr(r['Destino']||'');
  const origenShort=(r['Origen']||'Minecore').split(' — ')[0].split(',')[0].trim();
  const titulo=origenShort+' → '+destName;
  const actions=isAdmin&&est==='Pendiente'?`
    <input class="reject-input" id="ri-${r['ID']}" placeholder="Motivo de rechazo">
    <div class="action-row">
      <button class="btn-reject" onclick="doReject('${r['ID']}',this)">Rechazar</button>
      <button class="btn-approve" onclick="doApprove('${r['ID']}')">✓ Aprobar</button>
    </div>`:'';
  const editBtn=isAdmin?`<button onclick="editRuta('${r['ID']}')" style="padding:6px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);font-size:12px;cursor:pointer;color:var(--text)">✏️ Editar</button>`:'';
  return `<div class="rticket">
    <div class="rt-top">
      <div class="rt-dest">${titulo}</div>
      <span class="badge ${bc}">${est}</span>
    </div>
    ${destAddr?`<div class="rt-addr">${destAddr}</div>`:''}
    <div class="rt-badges">
      <span style="font-size:11px;color:var(--brand);font-weight:600">👤 ${usr}</span>
      ${veh?`<span style="font-size:11px;color:var(--text3)">🚗 ${veh}</span>`:''}
    </div>
    <div class="rt-meta">${r['Motivo']||''}</div>
    <div class="rt-bottom">
      <div>
        <div class="rt-val">$${val.toFixed(2)}</div>
        <div class="rt-info">${r['Tipo']||''} · ${km} km · ${fd(r['Fecha Servicio']||'')}</div>
      </div>
      ${editBtn}
    </div>
    ${actions}
  </div>`;
}

async function doApprove(id){
  try{ const r=await api({action:'aprobarRuta',id,admin:session.usuario}); if(r.ok){toast('✓ Aprobada');setView('aprobar');}else toast('Error'); }catch(e){toast('Error de conexión');}
}
async function doReject(id,btn){
  const inp=document.getElementById('ri-'+id);
  if(inp.style.display!=='block'){ inp.style.display='block'; inp.focus(); btn.textContent='Confirmar rechazo'; return; }
  try{ const r=await api({action:'rechazarRuta',id,admin:session.usuario,notas:inp.value||''}); if(r.ok){toast('Rechazada');setView('aprobar');}else toast('Error'); }catch(e){toast('Error de conexión');}
}

function editRuta(id){
  const rutas=window._allRutas||[];
  const r=rutas.find(x=>x['ID']===id); if(!r)return;
  const overlay=document.createElement('div');
  overlay.id='edit-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:400;display:flex;align-items:center;justify-content:center;padding:20px';
  const vehOpts=['Camioneta Nissan','Camioneta Mazda','Camioneta Poer','Moto Minecore'].map(v=>`<option value="${v}"${r['Vehiculo']===v?' selected':''}>${v}</option>`).join('');
  const estOpts=['Pendiente','Aprobada','Rechazada'].map(v=>`<option value="${v}"${r['Estado']===v?' selected':''}>${v}</option>`).join('');
  overlay.innerHTML=`<div style="background:var(--surface);border-radius:var(--radius-lg);padding:20px;width:100%;max-width:420px;max-height:90vh;overflow-y:auto">
    <div style="font-size:16px;font-weight:700;margin-bottom:16px">✏️ Editar ruta</div>
    <div class="field-group"><label class="field-label">Estado</label><select class="field-sel" id="e-estado">${estOpts}</select></div>
    <div class="field-group"><label class="field-label">Vehículo</label><select class="field-sel" id="e-veh">${vehOpts}</select></div>
    <div class="field-group"><label class="field-label">KM</label><input class="field-input" type="number" id="e-km" value="${r['KM']||0}" step="0.1"></div>
    <div class="field-group"><label class="field-label">Origen</label><input class="field-input" id="e-origen" value="${r['Origen']||''}"></div>
    <div class="field-group"><label class="field-label">Destino</label><input class="field-input" id="e-destino" value="${r['Destino']||''}"></div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button onclick="document.getElementById('edit-overlay').remove()" style="flex:1;padding:12px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;font-size:14px">Cancelar</button>
      <button onclick="saveEditRuta('${id}')" style="flex:1;padding:12px;background:var(--brand);color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-size:14px;font-weight:700">Guardar</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
}

async function saveEditRuta(id){
  const veh=document.getElementById('e-veh').value;
  const km=parseFloat(document.getElementById('e-km').value)||0;
  const rate=VEH_RATE[veh]||parseFloat(cfg.precio_km||0.40);
  const valor=(km*rate).toFixed(2);
  try{
    const r=await api({action:'editarRuta',id,
      estado:document.getElementById('e-estado').value,
      vehiculo:veh, km, valor,
      origen:document.getElementById('e-origen').value,
      destino:document.getElementById('e-destino').value,
      admin:session.usuario});
    document.getElementById('edit-overlay').remove();
    if(r.ok){ toast('✓ Ruta actualizada'); setView(activeView); } else toast('Error: '+(r.error||''));
  }catch(e){toast('Error de conexión');}
}

// ─── FILTER HELPERS ──────────────────────────────────────────────────────────
function filtDateBtns(prefix, current){
  const m=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const pd=getPeriodoDates(0), pa=getPeriodoDates(-1);
  const fi0=new Date(pd.fi+'T12:00:00'), ff0=new Date(pd.ff+'T12:00:00');
  const fi1=new Date(pa.fi+'T12:00:00'), ff1=new Date(pa.ff+'T12:00:00');
  const pLabel=`26 ${m[fi0.getMonth()]} → 25 ${m[ff0.getMonth()]}`;
  const aLabel=`26 ${m[fi1.getMonth()]} → 25 ${m[ff1.getMonth()]}`;
  const btns=[
    {id:'hoy',label:'Hoy'},{id:'ayer',label:'Ayer'},{id:'7dias',label:'7 días'},
    {id:'periodo',label:`Período (${pLabel})`},{id:'anterior',label:`← Anterior (${aLabel})`},
    {id:'todo',label:'Todo'}
  ];
  return btns.map(b=>`<button class="filt-btn${current===b.id?' active':''}" id="${prefix}-btn-${b.id}" onclick="${prefix}SetFiltro('${b.id}')">${b.label}</button>`).join('');
}

function applyDateFiltro(filtro, prefix){
  const hoy=new Date(), hs=hoy.toISOString().split('T')[0];
  let fi,ff;
  if(filtro==='hoy'){fi=hs;ff=hs;}
  else if(filtro==='ayer'){const a=new Date(hoy);a.setDate(hoy.getDate()-1);const as=a.toISOString().split('T')[0];fi=as;ff=as;}
  else if(filtro==='7dias'){const s=new Date(hoy);s.setDate(hoy.getDate()-6);fi=s.toISOString().split('T')[0];ff=hs;}
  else if(filtro==='semana'){const d=getSemanaAnteriorDates();fi=d.fi;ff=d.ff;}
  else if(filtro==='periodo'){const d=getPeriodoDates(0);fi=d.fi;ff=d.ff;}
  else if(filtro==='anterior'){const d=getPeriodoDates(-1);fi=d.fi;ff=d.ff;}
  else{fi='2020-01-01';ff='2099-12-31';}
  const fiEl=document.getElementById(prefix+'-fi');
  const ffEl=document.getElementById(prefix+'-ff');
  if(fiEl)fiEl.value=fi;
  if(ffEl)ffEl.value=ff;
  document.querySelectorAll(`[id^="${prefix}-btn-"]`).forEach(b=>b.classList.remove('active'));
  const btn=document.getElementById(`${prefix}-btn-${filtro}`);
  if(btn)btn.classList.add('active');
  return{fi,ff};
}

function filterByDate(rutas, fi, ff){
  const d1=new Date(fi+'T00:00:00'), d2=new Date(ff+'T23:59:59');
  return rutas.filter(r=>{
    const d=parseDateStr(r['Fecha Servicio']||r['Fecha Solicitud']||'');
    return d&&d>=d1&&d<=d2;
  });
}

// ─── VIEW: NUEVA RUTA ────────────────────────────────────────────────────────
function vNueva(c){
  if(!puedeInteractuar()){ c.innerHTML=roMsg('crear rutas'); return; }
  originLL=null; paradas=[]; routeKm=0; routeDur='';
  mapsMode='none'; mapsEmbedWin=null; mapsEmbedReady=false;
  markers.forEach(m=>{ try{ if(m&&m.setMap) m.setMap(null); if(lmap&&m.remove) m.remove(); }catch(e){} }); markers=[];
  if(lmap){ try{ lmap.remove(); }catch(e){} lmap=null; lRoute=null; lOrigin=null; }
  const userFavs=favs.filter(f=>f.usuario===session.usuario);
  c.innerHTML=`
  <div class="page-title">Nueva ruta</div>
  <div id="maps-referrer-hint" class="maps-referrer-hint"></div>
  <div class="card" style="padding:12px">
    ${userFavs.length?`<div style="font-size:11px;color:var(--text2);margin-bottom:6px">★ Favoritos:</div><div style="margin-bottom:8px">${userFavs.map((f,i)=>`<span class="fav-chip" onclick="usarFav(${i})">${f.nombre} <span onclick="event.stopPropagation();delFav(${i})" style="color:var(--text3)">×</span></span>`).join('')}</div>`:''}
    <div id="cj-maps-native">
    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Origen</div>
    <button class="btn-gps" onclick="usarGPS()">
      <svg viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linecap="round" width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
      Usar mi ubicación actual
    </button>
    <div class="field-group" style="margin-bottom:10px;position:relative">
      <input class="field-input" id="inp-origen" value="${MINECORE_ADDR}" style="font-size:13px;padding:9px 12px" autocomplete="off">
      <div class="cj-ac" id="ac-origen"></div>
    </div>
    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Destinos / Paradas</div>
    <div id="paradas-cont"></div>
    <button class="btn-add-parada" onclick="addParada()">+ Agregar parada</button>
    <div class="map-wrap"><div id="map"></div><div class="map-hint" id="map-hint">Toca el mapa para marcar destino</div></div>
    </div>
    <iframe id="mc-maps-embed" class="mc-maps-embed" title="Mapa de ruta" allow="geolocation" style="display:none"></iframe>
    <div class="km-box" id="km-box">
      <div class="km-row"><div class="km-lbl">Total a cobrar</div><div class="km-val" id="km-val">$0.00</div></div>
      <div class="km-sub" id="km-sub"></div>
    </div>
    <button class="btn-gps" style="margin-top:4px" onclick="guardarFav()">★ Guardar último destino como favorito</button>
  </div>
  <div class="card">
    <div class="field-group"><label class="field-label">Vehículo</label>
      <select class="field-sel" id="f-veh" onchange="updVehPrice()">
        <option value="Camioneta Nissan">🚙 Camioneta Nissan</option>
        <option value="Camioneta Mazda">🚙 Camioneta Mazda</option>
        <option value="Camioneta Poer">🚙 Camioneta Poer</option>
        <option value="Moto Minecore">🏍 Moto Minecore</option>
      </select>
    </div>
    <div class="field-group"><label class="field-label">Tipo de servicio</label>
      <select class="field-sel" id="f-tipo">
        <option value="Entrega">📦 Entrega</option>
        <option value="Despacho">🔄 Despacho / Retiro</option>
        <option value="Diligencia">📋 Diligencia</option>
      </select>
    </div>
    <div class="field-group"><label class="field-label">Fecha del servicio</label>
      <input class="field-input" type="date" id="f-fecha" value="${today()}">
    </div>
    ${session.rol==='admin'?`<div class="field-group"><label class="field-label">Para usuario</label>
      <select class="field-sel" id="f-usuario">
        ${allUsers.filter(u=>u.activo==='SI'||(u.activo===undefined)).map(u=>'<option value="'+u.usuario+'">'+u.usuario+' — '+u.nombre+'</option>').join('')}
      </select></div>`:''}
    <div class="field-group"><label class="field-label">Motivo</label>
      <input class="field-input" id="f-motivo" placeholder="Ej: Entrega de brocas de perforación">
    </div>
    <button class="btn-submit" onclick="enviarRuta()" id="btn-enviar">Enviar solicitud</button>
  </div>`;
  // Set default vehicle based on user
  const vehPorUsuario={'MPL':'Camioneta Mazda','OPM':'Camioneta Poer'};
  const defVeh=vehPorUsuario[session.usuario]||'Camioneta Nissan';
  document.getElementById('f-veh').value=defVeh;
  originLL=MINECORE_LL;
  addParada();
  startNuevaMap();
}

function updVehPrice(){
  const veh=document.getElementById('f-veh')?.value||'';
  const rate=VEH_RATE[veh]||parseFloat(cfg.precio_km||0.40);
  if(routeKm>0){
    document.getElementById('km-val').textContent='$'+(routeKm*rate).toFixed(2);
    document.getElementById('km-sub').textContent=`${routeKm} km × $${rate.toFixed(2)}/km`;
  }
}

function bindGoogleAutocomplete(inp, onPlace, withName){
  if(!inp || inp._gac || !window.google || !google.maps || !google.maps.places) return;
  inp._gac=true;
  const fields=withName?['geometry','formatted_address','name']:['geometry','formatted_address'];
  const ac=new google.maps.places.Autocomplete(inp,{componentRestrictions:{country:'ec'},fields:fields});
  ac.addListener('place_changed',()=>{
    const p=ac.getPlace(); if(!p||!p.geometry)return;
    onPlace(p);
  });
}

function attachParadaInput(idx){
  const inp=document.getElementById('pi-'+idx);
  if(!inp) return;
  if(mapsMode==='google' && googleMapsOk()){
    bindGoogleAutocomplete(inp, function(p){
      const name=p.name||p.formatted_address;
      const addr=p.formatted_address;
      paradas[idx]={addr:`${name} — ${addr}`,ll:{lat:p.geometry.location.lat(),lng:p.geometry.location.lng()}};
      calcRoute();
    }, true);
    return;
  }
  if(mapsMode==='leaflet'){
    bindPlaceInput(inp, document.getElementById('ac-pi-'+idx), function(hit){
      paradas[idx]={addr:hit.addr,ll:hit.ll};
      calcRoute();
    });
  }
}

function addParada(){
  if(mapsMode==='iframe'){ mapsEmbedPost({type:'addStop'}); return; }
  const cont=document.getElementById('paradas-cont'); if(!cont)return;
  const idx=paradas.length;
  paradas.push({addr:'',ll:null});
  const div=document.createElement('div'); div.className='parada-row'; div.id='pr-'+idx;
  div.innerHTML=`<div class="parada-num">${idx+1}</div><div class="parada-grow"><input class="parada-inp" id="pi-${idx}" placeholder="Buscar dirección..." autocomplete="off"><div class="cj-ac" id="ac-pi-${idx}"></div></div><button class="btn-del" onclick="delParada(${idx})">×</button>`;
  cont.appendChild(div);
  attachParadaInput(idx);
}

function delParada(idx){
  if(mapsMode==='iframe'){ mapsEmbedPost({type:'removeStop', index:idx}); return; }
  paradas.splice(idx,1);
  const cont=document.getElementById('paradas-cont'); if(!cont)return;
  cont.innerHTML='';
  const saved=[...paradas]; paradas=[];
  saved.forEach(p=>{
    const i=paradas.length;
    paradas.push(p);
    const div=document.createElement('div'); div.className='parada-row'; div.id='pr-'+i;
    div.innerHTML=`<div class="parada-num">${i+1}</div><div class="parada-grow"><input class="parada-inp" id="pi-${i}" placeholder="Buscar dirección..." autocomplete="off"><div class="cj-ac" id="ac-pi-${i}"></div></div><button class="btn-del" onclick="delParada(${i})">×</button>`;
    cont.appendChild(div);
    const inp=document.getElementById('pi-'+i);
    if(inp) inp.value=p.addr.split(' — ')[0]||p.addr||'';
    attachParadaInput(i);
  });
  calcRoute();
}

function usarFav(idx){
  const userFavs=favs.filter(f=>f.usuario===session.usuario);
  const fav=userFavs[idx]; if(!fav)return;
  if(mapsMode==='iframe'){
    mapsEmbedPost({type:'addStop', addr:fav.addr, ll:fav.ll});
    return;
  }
  const empty=paradas.findIndex(p=>!p.ll);
  if(empty>=0){
    paradas[empty]={addr:fav.addr,ll:fav.ll};
    const inp=document.getElementById('pi-'+empty);
    if(inp) inp.value=fav.addr.split(' — ')[0]||fav.addr;
    calcRoute();
    return;
  }
  const i=paradas.length; addParada();
  setTimeout(()=>{
    paradas[i]={addr:fav.addr,ll:fav.ll};
    const inp=document.getElementById('pi-'+i);
    if(inp) inp.value=fav.addr.split(' — ')[0]||fav.addr;
    calcRoute();
  },100);
}

function delFav(idx){
  const userFavs=favs.filter(f=>f.usuario===session.usuario);
  const fav=userFavs[idx];
  favs=favs.filter(f=>!(f.usuario===session.usuario&&f.nombre===fav.nombre));
  try{localStorage.setItem('mc_favs',JSON.stringify(favs));}catch(e){}
  setView('nueva');
}

function guardarFav(){
  const valid=paradas.filter(p=>p.ll);
  if(!valid.length){toast('Agrega al menos un destino');return;}
  const last=valid[valid.length-1];
  const nombre=prompt('Nombre para el favorito:',last.addr.split(' — ')[0]||last.addr);
  if(!nombre)return;
  const userFavs=favs.filter(f=>f.usuario===session.usuario);
  if(userFavs.length>=10){toast('Máximo 10 favoritos');return;}
  favs.push({usuario:session.usuario,nombre,addr:last.addr,ll:last.ll});
  try{localStorage.setItem('mc_favs',JSON.stringify(favs));}catch(e){}
  toast('★ Favorito guardado');
}

function usarGPS(){
  if(mapsMode==='iframe'){ mapsEmbedPost({type:'useGPS'}); return; }
  if(!navigator.geolocation){toast('GPS no disponible');return;}
  toast('Obteniendo ubicación...');
  navigator.geolocation.getCurrentPosition(pos=>{
    originLL={lat:pos.coords.latitude,lng:pos.coords.longitude};
    if(mapsMode==='google' && geocoder){
      geocoder.geocode({location:originLL},(res,st)=>{
        if(st==='OK'&&res[0]){
          const inp=document.getElementById('inp-origen');
          if(inp) inp.value=res[0].formatted_address;
        }
      });
      if(window._originMarker) window._originMarker.setPosition(originLL);
      if(gmap) gmap.panTo(originLL);
    } else {
      reverseGeocode(originLL, function(addr){
        const inp=document.getElementById('inp-origen');
        if(inp&&addr) inp.value=addr;
      });
      if(lOrigin&&lmap){ lOrigin.setLatLng(originLL); lmap.panTo(originLL); }
    }
    toast('✓ Ubicación obtenida');
    calcRoute();
  },()=>toast('No se pudo obtener ubicación'));
}

function startNuevaMap(){
  mapsMode='google';
  var fr=document.getElementById('mc-maps-embed');
  if(fr){ fr.style.display='none'; fr.removeAttribute('src'); }
  var native=document.getElementById('cj-maps-native');
  if(native) native.style.display='block';
  loadGoogleMaps(function(ok){
    if(!document.getElementById('map')) return;
    if(ok && !global._mcMapsAuthFail){
      mapsMode='google';
      initGoogleMap();
      return;
    }
    fallbackOsmSilent();
  });
}

function mapsEmbedPost(msg){
  var fr=document.getElementById('mc-maps-embed');
  if(!fr||!fr.contentWindow) return;
  var payload={};
  Object.keys(msg||{}).forEach(function(k){ payload[k]=msg[k]; });
  payload.source='mc-maps-parent';
  try{ fr.contentWindow.postMessage(payload, MAPS_EMBED_ORIGIN); }catch(e){}
}

function applyEmbedState(s){
  if(!s) return;
  if(s.origin){
    originLL=s.origin.ll||originLL;
    var inp=document.getElementById('inp-origen');
    if(inp&&s.origin.addr) inp.value=s.origin.addr;
  }
  if(Array.isArray(s.stops)) paradas=s.stops.map(function(p){ return {addr:p.addr||'',ll:p.ll||null}; });
  if(typeof s.km==='number'&&s.km>0){
    routeKm=s.km;
    routeDur=s.durationLabel||'';
    showKmBox(s.km, s.durationLabel||'');
  }
}

function onMapsEmbedMessage(e){
  if(!e||e.origin!==MAPS_EMBED_ORIGIN) return;
  var d=e.data||{};
  if(d.source!=='mc-maps-embed') return;
  if(d.type==='ready'){
    mapsEmbedReady=true;
    mapsEmbedPost({type:'init', origin:{addr:MINECORE_ADDR,ll:MINECORE_LL}, theme:(window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches)?'dark':''});
    if(d.state) applyEmbedState(d.state);
    return;
  }
  if(d.type==='state'&&d.state) applyEmbedState(d.state);
  if(d.type==='route'){
    routeKm=d.km||0; routeDur=d.durationLabel||'';
    if(d.origin){ originLL=d.origin.ll||originLL; var o=document.getElementById('inp-origen'); if(o&&d.origin.addr) o.value=d.origin.addr; }
    if(Array.isArray(d.stops)) paradas=d.stops.map(function(p){ return {addr:p.addr||'',ll:p.ll||null}; });
    if(routeKm) showKmBox(routeKm, routeDur);
  }
  if(d.type==='height'&&d.px){
    var fr=document.getElementById('mc-maps-embed');
    if(fr) fr.style.height=Math.max(360, Number(d.px)||360)+'px';
  }
  if(d.type==='error'&&d.message) toast(d.message);
}

function mountMapsIframe(){
  mapsMode='iframe';
  var native=document.getElementById('cj-maps-native');
  if(native) native.style.display='none';
  var fr=document.getElementById('mc-maps-embed');
  if(!fr) return;
  fr.style.display='block';
  fr.src=MAPS_EMBED_URL;
  mapsEmbedWin=fr.contentWindow;
  window.removeEventListener('message', onMapsEmbedMessage);
  window.addEventListener('message', onMapsEmbedMessage);
}

function showKmBox(km, dur){
  const veh=document.getElementById('f-veh')?.value||'Camioneta Nissan';
  const rate=VEH_RATE[veh]||parseFloat(cfg.precio_km||0.40);
  const val=(km*rate).toFixed(2);
  const box=document.getElementById('km-box');
  if(box){
    box.style.display='block';
    document.getElementById('km-val').textContent='$'+val;
    document.getElementById('km-sub').textContent=km+' km'+(dur?' · '+dur:'')+' · $'+rate.toFixed(2)+'/km';
  }
  const hint=document.getElementById('map-hint'); if(hint) hint.style.opacity='0';
}

function bindPlaceInput(inp, box, onPick){
  if(!inp||!box||inp._acSetup) return;
  inp._acSetup=true;
  var timer=null;
  function kick(){
    clearTimeout(timer);
    var q=inp.value.trim();
    if(q.length<3){ box.innerHTML=''; box.style.display='none'; return; }
    timer=setTimeout(function(){ searchPlaces(q, box, onPick, inp); }, 320);
  }
  inp.addEventListener('input', kick);
  inp.addEventListener('keyup', kick);
  inp.addEventListener('change', kick);
  inp.addEventListener('focus', function(){
    if(box.innerHTML) box.style.display='block';
  });
  inp.addEventListener('blur', function(){ setTimeout(function(){ box.style.display='none'; }, 180); });
}

function renderPlaceHits(hits, box, onPick, inp){
  box.innerHTML='';
  if(!hits||!hits.length){
    box.innerHTML='<div class="cj-ac-item mute">Sin resultados</div>';
    box.style.display='block';
    return;
  }
  hits.forEach(function(hit){
    var item=document.createElement('div');
    item.className='cj-ac-item';
    item.textContent=hit.label;
    item.onmousedown=function(ev){
      ev.preventDefault();
      if(inp) inp.value=hit.name;
      box.style.display='none';
      onPick({addr:hit.addr, ll:hit.ll});
    };
    box.appendChild(item);
  });
  box.style.display='block';
}

function searchPlaces(q, box, onPick, inp){
  var photon='https://photon.komoot.io/api/?lang=es&limit=6&lat='+MINECORE_LL.lat+'&lon='+MINECORE_LL.lng+'&q='+encodeURIComponent(q);
  fetch(photon, {headers:{'Accept':'application/json'}}).then(function(r){ return r.json(); }).then(function(data){
    var feats=(data&&data.features)||[];
    var hits=feats.map(function(f){
      var p=f.properties||{};
      var g=(f.geometry&&f.geometry.coordinates)||[];
      var name=p.name||p.street||p.city||'Lugar';
      var parts=[p.name,p.street,p.city,p.state,p.country].filter(Boolean);
      var label=parts.join(', ');
      return {name:name, label:label, addr:name+' — '+label, ll:{lat:g[1],lng:g[0]}};
    }).filter(function(h){ return h.ll.lat&&h.ll.lng; });
    if(hits.length){ renderPlaceHits(hits, box, onPick, inp); return; }
    return fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=ec&q='+encodeURIComponent(q), {headers:{'Accept':'application/json'}})
      .then(function(r){ return r.json(); })
      .then(function(rows){
        var alt=(rows||[]).map(function(row){
          var name=(row.display_name||'').split(',')[0];
          return {name:name, label:row.display_name, addr:name+' — '+row.display_name, ll:{lat:parseFloat(row.lat),lng:parseFloat(row.lon)}};
        });
        renderPlaceHits(alt, box, onPick, inp);
      });
  }).catch(function(){
    box.innerHTML='<div class="cj-ac-item mute">Error de búsqueda</div>';
    box.style.display='block';
  });
}

function reverseGeocode(ll, cb){
  var url='https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat='+ll.lat+'&lon='+ll.lng;
  fetch(url, {headers:{'Accept':'application/json'}}).then(function(r){ return r.json(); }).then(function(row){
    cb(row&&row.display_name?row.display_name:'');
  }).catch(function(){ cb(''); });
}

function initMap(){
  if(mapsMode==='leaflet'){ initLeafletMap(); return; }
  if(global._mcMapsAuthFail){ fallbackOsmSilent(); return; }
  if(!mReady||!window.google||!google.maps){ setTimeout(initMap,300); return; }
  initGoogleMap();
}

function initGoogleMap(){
  if(!document.getElementById('map')) return;
  if(global._mcMapsAuthFail){ fallbackOsmSilent(); return; }
  if(!mReady||!window.google||!google.maps){ setTimeout(initGoogleMap,300); return; }
  if(lmap){ try{ lmap.remove(); }catch(e){} lmap=null; lRoute=null; lOrigin=null; }
  mapsMode='google';
  gmap=new google.maps.Map(document.getElementById('map'),{
    center:MINECORE_LL,zoom:13,disableDefaultUI:true,zoomControl:true,
    styles:[{featureType:'poi',elementType:'labels',stylers:[{visibility:'off'}]}]
  });
  dirSvc=new google.maps.DirectionsService();
  dirRen=new google.maps.DirectionsRenderer({suppressMarkers:true,polylineOptions:{strokeColor:'#E8FF00',strokeWeight:4,strokeOpacity:.9}});
  dirRen.setMap(gmap);
  geocoder=new google.maps.Geocoder();
  originLL=originLL||MINECORE_LL;
  window._originMarker=new google.maps.Marker({position:originLL,map:gmap,icon:{path:google.maps.SymbolPath.CIRCLE,scale:9,fillColor:'#1D9E75',fillOpacity:1,strokeColor:'#fff',strokeWeight:2}});
  const inpOrigen=document.getElementById('inp-origen');
  if(inpOrigen){
    bindGoogleAutocomplete(inpOrigen, function(p){
      originLL={lat:p.geometry.location.lat(),lng:p.geometry.location.lng()};
      if(window._originMarker) window._originMarker.setPosition(originLL);
      if(gmap) gmap.panTo(originLL);
      calcRoute();
    }, false);
  }
  paradas.forEach(function(_,i){ attachParadaInput(i); });
  gmap.addListener('click',e=>{
    const ll=e.latLng;
    const free=paradas.findIndex(p=>!p.ll);
    const idx=free>=0?free:Math.max(0,paradas.length-1);
    if(!paradas.length){ addParada(); }
    paradas[idx]={addr:'',ll:{lat:ll.lat(),lng:ll.lng()}};
    geocoder.geocode({location:ll},(res,st)=>{
      if(st==='OK'&&res[0]){
        const name=res[0].address_components?.[1]?.short_name||res[0].formatted_address.split(',')[0];
        paradas[idx].addr=`${name} — ${res[0].formatted_address}`;
        const inp=document.getElementById('pi-'+idx);
        if(inp) inp.value=name;
      }
    });
    calcRoute();
  });
}

function initLeafletMap(){
  if(!global.L){ loadLeaflet(initLeafletMap); return; }
  var el=document.getElementById('map');
  if(!el) return;
  if(lmap){ try{ lmap.remove(); }catch(e){} lmap=null; }
  lmap=L.map(el, {zoomControl:true, attributionControl:true}).setView([MINECORE_LL.lat,MINECORE_LL.lng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom:19,
    attribution:'&copy; OpenStreetMap'
  }).addTo(lmap);
  originLL=originLL||MINECORE_LL;
  lOrigin=L.circleMarker([originLL.lat,originLL.lng], {
    radius:8, color:'#fff', weight:2, fillColor:'#1D9E75', fillOpacity:1
  }).addTo(lmap);
  const inpOrigen=document.getElementById('inp-origen');
  if(inpOrigen){
    bindPlaceInput(inpOrigen, document.getElementById('ac-origen'), function(hit){
      originLL=hit.ll;
      if(inpOrigen) inpOrigen.value=hit.addr;
      if(lOrigin) lOrigin.setLatLng(originLL);
      if(lmap) lmap.panTo(originLL);
      calcRoute();
    });
  }
  paradas.forEach(function(_,i){
    const inp=document.getElementById('pi-'+i);
    if(inp) bindPlaceInput(inp, document.getElementById('ac-pi-'+i), function(hit){
      paradas[i]={addr:hit.addr,ll:hit.ll};
      calcRoute();
    });
  });
  lmap.on('click', function(e){
    var ll={lat:e.latlng.lat,lng:e.latlng.lng};
    var free=paradas.findIndex(p=>!p.ll);
    var idx=free>=0?free:Math.max(0,paradas.length-1);
    if(!paradas.length){ addParada(); idx=0; }
    paradas[idx]={addr:'',ll:ll};
    reverseGeocode(ll, function(addr){
      if(addr){
        var name=addr.split(',')[0];
        paradas[idx].addr=name+' — '+addr;
        var inp=document.getElementById('pi-'+idx);
        if(inp) inp.value=name;
      }
    });
    calcRoute();
  });
  setTimeout(function(){ try{ lmap.invalidateSize(); }catch(e){} }, 250);
}

function clearRouteMarkers(){
  markers.forEach(function(m){
    try{ if(m&&m.setMap) m.setMap(null); if(m&&m.remove) m.remove(); }catch(e){}
  });
  markers=[];
}

function calcRouteGoogle(valid){
  if(!dirSvc||!window.google) return;
  clearRouteMarkers();
  dirSvc.route({
    origin:originLL,
    destination:valid[valid.length-1].ll,
    waypoints:valid.slice(0,-1).map(p=>({location:p.ll,stopover:true})),
    travelMode:google.maps.TravelMode.DRIVING,
    provideRouteAlternatives:true
  },(result,status)=>{
    if(status!=='OK')return;
    const sorted=[...result.routes].sort((a,b)=>{
      const da=a.legs.reduce((s,l)=>s+l.distance.value,0);
      const db=b.legs.reduce((s,l)=>s+l.distance.value,0);
      return da-db;
    });
    const best=sorted[0];
    dirRen.setDirections({...result,routes:[best]});
    let totalM=0,totalS=0;
    best.legs.forEach(l=>{totalM+=l.distance.value;totalS+=l.duration.value;});
    routeKm=Math.round(totalM/100)/10;
    const hrs=Math.floor(totalS/3600),mins=Math.floor((totalS%3600)/60);
    routeDur=hrs>0?`${hrs}h ${mins}min`:`${mins} min`;
    showKmBox(routeKm, routeDur);
    valid.forEach((p,i)=>{
      const m=new google.maps.Marker({position:p.ll,map:gmap,
        label:{text:String(i+1),color:'#2D3142',fontWeight:'bold',fontSize:'12px'},
        icon:{path:google.maps.SymbolPath.CIRCLE,scale:10,fillColor:'#E8FF00',fillOpacity:1,strokeColor:'#2D3142',strokeWeight:2}
      });
      markers.push(m);
    });
    const bounds=new google.maps.LatLngBounds();
    best.legs.forEach(l=>{bounds.extend(l.start_location);bounds.extend(l.end_location);});
    if(gmap) gmap.fitBounds(bounds,{top:20,right:20,bottom:20,left:20});
  });
}

function calcRouteOsm(valid){
  clearRouteMarkers();
  if(lRoute&&lmap){ try{ lmap.removeLayer(lRoute); }catch(e){} lRoute=null; }
  var coords=[[originLL.lng,originLL.lat]].concat(valid.map(function(p){ return [p.ll.lng,p.ll.lat]; }));
  var url='https://router.project-osrm.org/route/v1/driving/'+coords.map(function(c){ return c[0]+','+c[1]; }).join(';')+'?overview=full&geometries=geojson&alternatives=true';
  fetch(url).then(function(r){ return r.json(); }).then(function(data){
    if(!data||data.code!=='Ok'||!data.routes||!data.routes.length){ toast('No se pudo calcular la ruta'); return; }
    var sorted=data.routes.slice().sort(function(a,b){ return a.distance-b.distance; });
    var best=sorted[0];
    routeKm=Math.round(best.distance/100)/10;
    var totalS=Math.round(best.duration||0);
    var hrs=Math.floor(totalS/3600), mins=Math.floor((totalS%3600)/60);
    routeDur=hrs>0?(hrs+'h '+mins+'min'):(mins+' min');
    showKmBox(routeKm, routeDur);
    if(lmap){
      valid.forEach(function(p,i){
        var m=L.circleMarker([p.ll.lat,p.ll.lng], {
          radius:9, color:'#2D3142', weight:2, fillColor:'#E8FF00', fillOpacity:1
        }).bindTooltip(String(i+1), {permanent:true, direction:'center', className:'cj-map-lbl'}).addTo(lmap);
        markers.push(m);
      });
      if(best.geometry&&best.geometry.coordinates){
        var latlngs=best.geometry.coordinates.map(function(c){ return [c[1],c[0]]; });
        lRoute=L.polyline(latlngs, {color:'#E8FF00', weight:4, opacity:.9}).addTo(lmap);
        var b=L.latLngBounds(latlngs);
        lmap.fitBounds(b, {padding:[20,20]});
      }
    }
  }).catch(function(){ toast('No se pudo calcular la ruta'); });
}

function calcRoute(){
  const valid=paradas.filter(p=>p.ll);
  if(!originLL||!valid.length)return;
  if(mapsMode==='iframe'){ mapsEmbedPost({type:'getRoute'}); return; }
  if(mapsMode==='google'){ calcRouteGoogle(valid); return; }
  calcRouteOsm(valid);
}

async function enviarRuta(){
  const valid=paradas.filter(p=>p.ll);
  if(!valid.length){toast('Agrega al menos un destino');return;}
  if(!routeKm){toast('Calcula la ruta primero');return;}
  const veh=document.getElementById('f-veh').value;
  const rate=VEH_RATE[veh]||parseFloat(cfg.precio_km||0.40);
  const btn=document.getElementById('btn-enviar');btn.textContent='Enviando...';btn.disabled=true;
  const origen=document.getElementById('inp-origen').value||MINECORE_ADDR;
  const destino=valid.map(p=>p.addr).join(' → ');
  try{
    const r=await api({action:'crearRuta',usuario:(session.rol==='admin'&&document.getElementById('f-usuario')?document.getElementById('f-usuario').value:session.usuario),origen,destino,km:routeKm,
      vehiculo:veh,precioKm:rate,tipo:document.getElementById('f-tipo').value,
      fechaServicio:document.getElementById('f-fecha').value,
      motivo:document.getElementById('f-motivo').value||'Sin descripción'});
    if(r.ok){toast('✓ Solicitud enviada');setView('mis-rutas');}
    else toast('Error: '+(r.error||''));
  }catch(e){toast('Error de conexión');}
  btn.textContent='Enviar solicitud';btn.disabled=false;
}

// ─── VIEW: MIS RUTAS (CHOFER) ────────────────────────────────────────────────
async function vMisRutas(c){
  c.innerHTML=spin();
  try{
    const r=await api({action:'getRutas',rol:session.rol,usuario:session.usuario});
    const rutas=r.rutas||[];
    window._allRutas=rutas;
    c.innerHTML=`<div class="page-title">Mis rutas</div>
    <div class="tab-row">
      <div class="tab active" onclick="filtMR(this,'')">Todas</div>
      <div class="tab" onclick="filtMR(this,'Pendiente')">Pendientes</div>
      <div class="tab" onclick="filtMR(this,'Aprobada')">Aprobadas</div>
      <div class="tab" onclick="filtMR(this,'Rechazada')">Rechazadas</div>
    </div>
    <div id="mr-list">${rutas.length?rutas.map(r=>rutaTicket(r,false)).join(''):empty('Sin rutas aún')}</div>`;
  }catch(e){c.innerHTML=errMsg();}
}
function filtMR(el,est){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));el.classList.add('active');
  const f=est?(window._allRutas||[]).filter(r=>r['Estado']===est):(window._allRutas||[]);
  document.getElementById('mr-list').innerHTML=f.length?f.map(r=>rutaTicket(r,false)).join(''):empty('Sin rutas en esta categoría');
}

// ─── VIEW: MI CUENTA ─────────────────────────────────────────────────────────
async function vCuenta(c){
  c.innerHTML=spin();
  try{
    const r=await api({action:'getRutas',rol:'admin'});
    const todas=(r.rutas||[]).filter(rt=>{
      if(rt['Estado']!=='Aprobada')return false;
      const veh=String(rt['Vehiculo']||'').trim();
      const owner=VEH_OWNER[veh];
      if(owner) return owner===session.usuario;
      return rt['Usuario']===session.usuario;
    });
    window._cuentaRutas=todas;
    const pd=getPeriodoDates(0);
    window._cFi=pd.fi; window._cFf=pd.ff; window._cFiltro='periodo';
    renderCuenta(c);
  }catch(e){c.innerHTML=errMsg();}
}

function renderCuenta(c){
  const filtro=window._cFiltro||'periodo';
  const fi=window._cFi||getPeriodoDates(0).fi, ff=window._cFf||getPeriodoDates(0).ff;
  const rutas=filterByDate(window._cuentaRutas||[],fi,ff);
  const totalKm=Math.round(rutas.reduce((s,r)=>s+parseFloat(r['KM']||0),0)*10)/10;
  const totalUsd=Math.round(rutas.reduce((s,r)=>s+parseFloat(r['Valor ($)']||0),0)*100)/100;
  const meses=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const fi0=new Date(fi+'T12:00:00'), ff0=new Date(ff+'T12:00:00');
  const pd=getPeriodoDates(0), pa=getPeriodoDates(-1);
  const pLabel=`26 ${meses[new Date(pd.fi+'T12:00:00').getMonth()]} → 25 ${meses[new Date(pd.ff+'T12:00:00').getMonth()]}`;
  const aLabel=`26 ${meses[new Date(pa.fi+'T12:00:00').getMonth()]} → 25 ${meses[new Date(pa.ff+'T12:00:00').getMonth()]}`;
  const label=fi===ff?`${fi0.getDate()} ${meses[fi0.getMonth()]} ${fi0.getFullYear()}`:`${fi0.getDate()} ${meses[fi0.getMonth()]} → ${ff0.getDate()} ${meses[ff0.getMonth()]} ${ff0.getFullYear()}`;
  c.innerHTML=`
  <div class="page-title">Mi cuenta</div>
  <div class="filter-bar">
    <div class="filter-label">Período</div>
    <div class="filter-btns">
      ${['hoy','ayer','7dias','semana','periodo','anterior','todo'].map(id=>{
        const labels={hoy:'Hoy',ayer:'Ayer','7dias':'7 días',semana:'Semana ant.',periodo:`Período (${pLabel})`,anterior:`← Anterior (${aLabel})`,todo:'Todo'};
        return `<button class="filt-btn${filtro===id?' active':''}" id="c-btn-${id}" onclick="cSetFiltro('${id}')">${labels[id]}</button>`;
      }).join('')}
    </div>
    <div class="date-row">
      <input type="date" id="c-fi" value="${fi}">
      <span style="color:var(--text3)">→</span>
      <input type="date" id="c-ff" value="${ff}">
      <button class="btn-ok" onclick="cApply()">OK</button>
    </div>
  </div>
  <div class="corte-hero">
    <div class="corte-hero-lbl">Total a cobrar</div>
    <div class="corte-hero-amt">$${totalUsd.toFixed(2)}</div>
    <div class="corte-hero-sub">${label}</div>
  </div>
  <div class="corte-stats">
    <div class="corte-stat"><div class="corte-stat-val">${rutas.length}</div><div class="corte-stat-lbl">Rutas</div></div>
    <div class="corte-stat"><div class="corte-stat-val">${totalKm}</div><div class="corte-stat-lbl">KM</div></div>
    <div class="corte-stat"><div class="corte-stat-val">$${rutas.length?(totalUsd/rutas.length).toFixed(2):'0.00'}</div><div class="corte-stat-lbl">Prom.</div></div>
  </div>
  <div class="card">
    ${rutas.length?rutas.map(r=>`
      <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:.5px solid var(--border)">
        <div>
          <div style="font-size:13px;font-weight:600">${placeName(r['Destino']||'—')}</div>
          <div style="font-size:11px;color:var(--text2)">${fd(r['Fecha Servicio']||'')} · ${r['KM']} km${r['Vehiculo']?' · '+r['Vehiculo']:''}</div>
        </div>
        <div style="font-size:14px;font-weight:700">$${parseFloat(r['Valor ($)']).toFixed(2)}</div>
      </div>`).join(''):empty('Sin rutas en este período')}
  </div>`;
}
function cSetFiltro(f){ window._cFiltro=f; const d=applyDateFiltro(f,'c'); window._cFi=d.fi; window._cFf=d.ff; renderCuenta(document.getElementById('content')); }
function cApply(){ window._cFi=document.getElementById('c-fi').value; window._cFf=document.getElementById('c-ff').value; window._cFiltro='custom'; document.querySelectorAll('[id^="c-btn-"]').forEach(b=>b.classList.remove('active')); renderCuenta(document.getElementById('content')); }

// ─── VIEW: APROBAR ────────────────────────────────────────────────────────────
async function vAprobar(c){
  c.innerHTML=spin();
  try{
    const r=await api({action:'getRutas',rol:'admin',estado:'Pendiente'});
    const rutas=r.rutas||[];
    window._allRutas=rutas;
    c.innerHTML=`<div class="page-title">Por aprobar</div>
    <div class="page-sub">${rutas.length} pendiente${rutas.length!==1?'s':''}</div>
    ${rutas.length?`<button onclick="aprobarTodo()" style="width:100%;padding:12px;background:var(--brand);color:#fff;border:none;border-radius:var(--radius);font-size:14px;font-weight:700;cursor:pointer;margin-bottom:12px">✓ Aprobar todo</button>`:''}
    ${rutas.length?rutas.map(r=>rutaTicket(r,true)).join(''):empty('Sin solicitudes pendientes ✓')}`;
  }catch(e){c.innerHTML=errMsg();}
}
async function aprobarTodo(){
  const pendientes=(window._allRutas||[]).filter(r=>r['Estado']==='Pendiente');
  for(const r of pendientes){
    try{ await api({action:'aprobarRuta',id:r['ID'],admin:session.usuario}); }catch(e){}
  }
  toast('✓ Todas aprobadas');setView('aprobar');
}

// ─── VIEW: HISTORIAL ──────────────────────────────────────────────────────────
async function vHistorial(c){
  c.innerHTML=spin();
  try{
    const r=await api({action:'getRutas',rol:session.rol,usuario:session.usuario});
    window._histRutas=r.rutas||[];
    const pd=getPeriodoDates(0);
    window._hFi=pd.fi; window._hFf=pd.ff; window._hFiltro='periodo';
    window._hEstado=''; window._hSearch='';
    renderHistorial(c);
  }catch(e){c.innerHTML=errMsg();}
}

function hSetFiltro(f){ window._hFiltro=f; const d=applyDateFiltro(f,'h'); window._hFi=d.fi; window._hFf=d.ff; hRender(); }
function hApply(){ window._hFi=document.getElementById('h-fi').value; window._hFf=document.getElementById('h-ff').value; window._hFiltro='custom'; document.querySelectorAll('[id^="h-btn-"]').forEach(b=>b.classList.remove('active')); hRender(); }
function hSetEstado(e,el){ window._hEstado=e; document.querySelectorAll('.cnt-btn').forEach(b=>b.classList.remove('active')); el.classList.add('active'); hRender(); }

async function vCorte(c){
  c.innerHTML=spin();
  try{
    const r=await api({action:'getRutas',rol:'admin'});
    const all0=r.rutas||[];
    // Non-admin: only show routes for vehicles they own
    const isAdmin=session.rol==='admin';
    const myVehs=isAdmin?null:Object.keys(VEH_OWNER).filter(v=>VEH_OWNER[v]===session.usuario);
    window._corteRutasAll=isAdmin?all0:all0.filter(x=>myVehs.includes(String(x['Vehiculo']||'').trim()));
    window._corteRutas=window._corteRutasAll.filter(x=>x['Estado']==='Aprobada');
    const sd=getSemanaAnteriorDates();
    window._corFi=sd.fi; window._corFf=sd.ff; window._corFiltro='semana';
    renderCorte(c);
  }catch(e){c.innerHTML=errMsg();}
}

function renderCorte(c){
  const filtro=window._corFiltro||'semana';
  const _sd=getSemanaAnteriorDates();
  const fi=window._corFi||_sd.fi, ff=window._corFf||_sd.ff;
  const meses=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const pd=getPeriodoDates(0), pa=getPeriodoDates(-1);
  const pLabel=`26 ${meses[new Date(pd.fi+'T12:00:00').getMonth()]} → 25 ${meses[new Date(pd.ff+'T12:00:00').getMonth()]}`;
  const aLabel=`26 ${meses[new Date(pa.fi+'T12:00:00').getMonth()]} → 25 ${meses[new Date(pa.ff+'T12:00:00').getMonth()]}`;
  const rutas=filterByDate(window._corteRutas||[],fi,ff);
  const totalKm=Math.round(rutas.reduce((s,r)=>s+parseFloat(r['KM']||0),0)*10)/10;
  const totalUsd=Math.round(rutas.reduce((s,r)=>s+parseFloat(r['Valor ($)']||0),0)*100)/100;
  // Desglose por propietario de vehículo
  const byOwner={};
  const OWNERS={EFCH:'Esteban Ferlito',MPL:'Martín Pinto',OPM:'Oswaldo Peña'};
  rutas.forEach(rt=>{
    const veh=String(rt['Vehiculo']||'').trim();
    const ownId=VEH_OWNER[veh]; if(!ownId)return;
    if(!byOwner[ownId])byOwner[ownId]={id:ownId,nombre:OWNERS[ownId]||ownId,km:0,usd:0,vehs:{}};
    byOwner[ownId].km=Math.round((byOwner[ownId].km+parseFloat(rt['KM']||0))*10)/10;
    byOwner[ownId].usd=Math.round((byOwner[ownId].usd+parseFloat(rt['Valor ($)']||0))*100)/100;
    if(!byOwner[ownId].vehs[veh])byOwner[ownId].vehs[veh]={km:0,usd:0,n:0};
    byOwner[ownId].vehs[veh].km=Math.round((byOwner[ownId].vehs[veh].km+parseFloat(rt['KM']||0))*10)/10;
    byOwner[ownId].vehs[veh].usd=Math.round((byOwner[ownId].vehs[veh].usd+parseFloat(rt['Valor ($)']||0))*100)/100;
    byOwner[ownId].vehs[veh].n++;
  });
  const ownerList=Object.values(byOwner).sort((a,b)=>b.usd-a.usd);
  const fi0=new Date(fi+'T12:00:00'), ff0=new Date(ff+'T12:00:00');
  const label=fi===ff?`${fi0.getDate()} ${meses[fi0.getMonth()]} ${fi0.getFullYear()}`:`${fi0.getDate()} ${meses[fi0.getMonth()]} → ${ff0.getDate()} ${meses[ff0.getMonth()]} ${ff0.getFullYear()}`;
  c.innerHTML=`
  <div style="display:flex;align-items:center;justify-content:space-between"><div class="page-title">Corte</div><button onclick="descargarCortePDF(document.getElementById('cor-fi').value,document.getElementById('cor-ff').value)" style="padding:8px 14px;background:#161926;color:#E8FF00;border:none;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0">↓ PDF</button></div>
  <div class="filter-bar">
    <div class="filter-label">Período</div>
    <div class="filter-btns">
      ${['hoy','ayer','7dias','semana','periodo','anterior','todo'].map(id=>{
        const labels={hoy:'Hoy',ayer:'Ayer','7dias':'7 días',semana:'Semana ant.',periodo:`Período (${pLabel})`,anterior:`← Anterior (${aLabel})`,todo:'Todo'};
        return `<button class="filt-btn${filtro===id?' active':''}" id="cor-btn-${id}" onclick="corSetFiltro('${id}')">${labels[id]}</button>`;
      }).join('')}
    </div>
    <div class="date-row">
      <input type="date" id="cor-fi" value="${fi}">
      <span style="color:var(--text3)">→</span>
      <input type="date" id="cor-ff" value="${ff}">
      <button class="btn-ok" onclick="corApply()">OK</button>
    </div>
  </div>
  <div class="corte-hero">
    <div class="corte-hero-lbl">Total a pagar</div>
    <div class="corte-hero-amt">$${totalUsd.toFixed(2)}</div>
    <div class="corte-hero-sub">${label}</div>
  </div>
  <div class="corte-stats">
    <div class="corte-stat"><div class="corte-stat-val">${rutas.length}</div><div class="corte-stat-lbl">Rutas</div></div>
    <div class="corte-stat"><div class="corte-stat-val">${totalKm}</div><div class="corte-stat-lbl">KM</div></div>
    <div class="corte-stat"><div class="corte-stat-val">$${parseFloat(cfg.precio_km||0.40).toFixed(2)}</div><div class="corte-stat-lbl">$/km</div></div>
  </div>
  <button class="btn-export" onclick="cerrarCorte('${label}')">📊 Cerrar corte y guardar en Sheets</button>
  <div class="card">
    <div style="font-size:13px;font-weight:700;margin-bottom:14px">💰 Desglose por propietario</div>
    ${ownerList.map(o=>{
      const co=col(o.id);
      const vLines=Object.entries(o.vehs).map(([v,d])=>`
        <div class="veh-row"><div class="veh-name">${v} · ${d.km} km · ${d.n} ruta${d.n!==1?'s':''}</div><div class="veh-val">$${d.usd.toFixed(2)}</div></div>`).join('');
      return `<div class="owner-card">
        <div class="owner-top">
          <div class="owner-left">
            <div class="owner-av" style="background:${co.bg};color:${co.tx}">${o.id}</div>
            <div><div class="owner-name">${o.nombre}</div><div class="owner-km">${o.km} km total</div></div>
          </div>
          <div class="owner-total">$${o.usd.toFixed(2)}</div>
        </div>${vLines}
      </div>`;
    }).join('')||empty('Sin rutas con vehículo asignado')}
  </div>
  <div class="card">
    <div style="font-size:13px;font-weight:700;margin-bottom:10px">Detalle de rutas (${rutas.length})</div>
    ${rutas.length?rutas.map(r=>`
      <div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:.5px solid var(--border)">
        <div>
          <div style="font-size:13px;font-weight:600">${placeName(r['Destino']||'—')}</div>
          <div style="font-size:11px;color:var(--text2)">${fd(r['Fecha Servicio']||'')} · ${r['KM']} km · ${r['Usuario']}${r['Vehiculo']?' · '+r['Vehiculo']:''}</div>
        </div>
        <div style="font-size:14px;font-weight:700">$${parseFloat(r['Valor ($)']).toFixed(2)}</div>
      </div>`).join(''):empty('Sin rutas en este período')}
  </div>`;
}
function corSetFiltro(f){ window._corFiltro=f; const d=applyDateFiltro(f,'cor'); window._corFi=d.fi; window._corFf=d.ff; renderCorte(document.getElementById('content')); }
function corApply(){ window._corFi=document.getElementById('cor-fi').value; window._corFf=document.getElementById('cor-ff').value; window._corFiltro='custom'; document.querySelectorAll('[id^="cor-btn-"]').forEach(b=>b.classList.remove('active')); renderCorte(document.getElementById('content')); }
async function cerrarCorte(periodo){ if(!confirm(`¿Cerrar el corte?\n${periodo}`))return; try{ const r=await api({action:'cerrarCorte',periodo,admin:session.usuario}); if(r.ok)toast('✓ Corte cerrado'); else toast('Error'); }catch(e){toast('Error de conexión');} }

// ─── VIEW: USUARIOS (read-only collaborators — no Caja PIN CRUD) ─────────────
async function vUsuarios(c){
  c.innerHTML=`<div class="page-title">Colaboradores</div>
    <div class="page-sub">Los accesos se gestionan en Admin → Usuarios. Aquí no hay PIN ni usuarios de Caja.</div>
    <div class="card">${(allUsers||[]).map(u=>{const co=col(u.usuario);return`<div class="uitem">
      <div class="uitem-av" style="background:${co.bg};color:${co.tx}">${u.usuario}</div>
      <div class="uitem-info"><div class="uitem-name">${u.nombre||u.usuario}</div>
      <div class="uitem-meta">${u.rol==='admin'?'Administrador':'Colaborador'}</div></div>
    </div>`;}).join('')||empty('Sin colaboradores en el listado')}</div>`;
}

// ─── VIEW: CONFIG ─────────────────────────────────────────────────────────────
async function vConfig(c){
  c.innerHTML=spin();
  try{
    const r=await api({action:'getConfig'}); const cf=r.config||{};
    c.innerHTML=`<div class="page-title">Configuración</div><div class="page-sub">Parámetros del sistema</div>
    <div class="card">
      <div class="cfg-row">
        <div><div class="cfg-label">Precio por KM</div><div class="cfg-sub">Se aplica a todas las rutas aprobadas</div></div>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="cfg-val">$${parseFloat(cf.precio_km||0.40).toFixed(2)}</div>
          <button onclick="editPrecio()" style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer">Editar</button>
        </div>
      </div>
      <div class="cfg-row">
        <div><div class="cfg-label">Período de corte</div><div class="cfg-sub">Ciclo de facturación</div></div>
        <div class="cfg-val">26 → 25</div>
      </div>
      <div class="cfg-row">
        <div><div class="cfg-label">Moto Minecore</div><div class="cfg-sub">Tarifa especial</div></div>
        <div class="cfg-val">$0.15/km</div>
      </div>
    </div>`;
  }catch(e){c.innerHTML=errMsg();}
}
async function editPrecio(){
  const n=prompt('Nuevo precio por KM (USD):');if(!n)return;
  const v=parseFloat(n);if(isNaN(v)||v<=0){toast('Inválido');return;}
  try{const r=await api({action:'updateConfig',clave:'precio_km',valor:v.toFixed(2)});if(r.ok){cfg.precio_km=v;toast('✓ Precio actualizado');vConfig(document.getElementById('content'));}else toast('Error');}catch(e){toast('Error de conexión');}
}

// ─── CAJA CHICA ───────────────────────────────────────────────────────────────
async function vBalance(c){
  c.innerHTML=spin();
  try{
    const isAdmin=session.rol==='admin';
    const rol=isAdmin?'admin':'chofer';
    const res=await Promise.all([
      api({action:'getEntregas',rol:rol,usuario:session.usuario}),
      api({action:'getGastos',rol:rol,usuario:session.usuario}),
      api({action:'getBalanceCaja'})
    ]);
    const entregas=cajaReadList(res[0],'entregas');
    const gastos=cajaReadList(res[1],'gastos');
    let balances=cajaReadList(res[2],'balances')||[];
    const pd=getPeriodoDates(0);
    let saldo=null;
    if(entregas&&gastos){
      saldo=saldoCajaPeriodo(entregas,gastos,pd.fi,pd.ff);
      window._cajEnt=entregas;
      window._cajGas=gastos;
      balances=saldo.users.slice();
    }
    if(!isAdmin) balances=balances.filter(b=>b.usuario===session.usuario);
    if(!saldo){
      const confirmed=balances.some(b=>(Number(b.entregado)||0)||(Number(b.aprobado)||0)||(Number(b.pendiente)||0)||(Number(b.disponible)||0));
      if(!confirmed){ c.innerHTML=errMsg(); return; }
    }

    const totalEnt=saldo?saldo.entregado:round2(balances.reduce((s,b)=>s+(Number(b.entregado)||0),0));
    const totalGast=saldo?saldo.aprobado:round2(balances.reduce((s,b)=>s+(Number(b.aprobado)||0),0));
    const totalPend=saldo?saldo.pendiente:round2(balances.reduce((s,b)=>s+(Number(b.pendiente)||0),0));
    const totalDisp=saldo?saldo.disponible:round2(totalEnt-totalGast);
    const pct=totalEnt>0?Math.min(100,Math.round(totalGast/totalEnt*100)):0;
    const over=totalGast>totalEnt;

    c.innerHTML=`<div class="page-title">Caja Chica</div>
    <div class="page-sub">Período: 26 al 25</div>

    <!-- HERO DASHBOARD -->
    <div style="background:var(--mc-dark);border-radius:var(--radius-lg);padding:20px;margin-bottom:12px;border:1px solid rgba(232,255,0,.2)">
      <div style="font-size:11px;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Disponible en caja</div>
      <div style="font-size:42px;font-weight:900;color:${totalDisp>=0?'var(--mc-yellow)':'#E24B4A'};letter-spacing:-1.5px;margin-bottom:4px">$${totalDisp.toFixed(2)}</div>
      <div style="font-size:12px;color:rgba(255,255,255,.4);margin-bottom:16px">Entregado $${totalEnt.toFixed(2)} — Gastado $${totalGast.toFixed(2)}</div>
      <!-- Progress bar -->
      <div style="background:rgba(255,255,255,.1);border-radius:4px;height:6px;margin-bottom:16px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${over?'#E24B4A':'var(--mc-yellow)'};border-radius:4px;transition:width .4s"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div style="background:rgba(255,255,255,.06);border-radius:10px;padding:10px 6px;text-align:center">
          <div style="font-size:16px;font-weight:800;color:var(--mc-yellow)">$${totalEnt.toFixed(2)}</div>
          <div style="font-size:10px;color:rgba(255,255,255,.4);text-transform:uppercase;margin-top:2px">Entregado</div>
        </div>
        <div style="background:rgba(255,255,255,.06);border-radius:10px;padding:10px 6px;text-align:center">
          <div style="font-size:16px;font-weight:800;color:#fff">$${totalGast.toFixed(2)}</div>
          <div style="font-size:10px;color:rgba(255,255,255,.4);text-transform:uppercase;margin-top:2px">Gastado</div>
        </div>
        <div style="background:rgba(255,255,255,.06);border-radius:10px;padding:10px 6px;text-align:center">
          <div style="font-size:16px;font-weight:800;color:#FFA040">$${totalPend.toFixed(2)}</div>
          <div style="font-size:10px;color:rgba(255,255,255,.4);text-transform:uppercase;margin-top:2px">Pendiente</div>
        </div>
      </div>
    </div>

    <!-- POR USUARIO -->
    ${balances.filter(b=>b.entregado>0||b.aprobado>0||b.pendiente>0).map(b=>{
      const co=col(b.usuario);
      const bpct=b.entregado>0?Math.min(100,Math.round(b.aprobado/b.entregado*100)):0;
      const bover=b.aprobado>b.entregado;
      return `<div class="balance-card">
        <div class="bal-user-row">
          <div class="bal-av" style="background:${co.bg};color:${co.tx}">${b.usuario}</div>
          <div style="flex:1">
            <div class="bal-name">${b.nombre}</div>
            ${b.pendiente>0?`<div style="font-size:11px;color:var(--warn-tx)">⏳ $${b.pendiente.toFixed(2)} pendiente aprobación</div>`:''}
          </div>
          <div style="font-size:18px;font-weight:900;color:${(b.disponible>=0)?'var(--ok-tx)':'var(--err-tx)'}">$${b.disponible.toFixed(2)}</div>
        </div>
        <div style="background:var(--surface2);border-radius:4px;height:5px;margin-bottom:10px;overflow:hidden">
          <div style="height:100%;width:${bpct}%;background:${bover?'var(--err-tx)':'var(--brand)'};border-radius:4px"></div>
        </div>
        <div class="bal-grid">
          <div class="bal-stat"><div class="bal-stat-val">$${b.entregado.toFixed(2)}</div><div class="bal-stat-lbl">Entregado</div></div>
          <div class="bal-stat"><div class="bal-stat-val">$${b.aprobado.toFixed(2)}</div><div class="bal-stat-lbl">Justificado</div></div>
          <div class="bal-stat"><div class="bal-stat-val ${b.disponible>=0?'pos':'neg'}">$${b.disponible.toFixed(2)}</div><div class="bal-stat-lbl">Disponible</div></div>
        </div>
      </div>`;
    }).join('')||'<div class="empty">Sin movimientos registrados</div>'}`;
  }catch(e){c.innerHTML=errMsg();}
}

function renderNuevaEntrega(c){
  const us=[...allUsers.filter(u=>(u.activo==='SI'||(u.activo===undefined))&&(u.rol||'').toLowerCase()==='chofer'),
             ...allUsers.filter(u=>(u.activo==='SI'||(u.activo===undefined))&&(u.rol||'').toLowerCase()!=='chofer')];
  c.innerHTML=`<div class="page-title">Registrar entrega</div><div class="page-sub">Dinero entregado a un colaborador</div>
  <div class="card">
    <div class="field-group"><label class="field-label">Para quién</label>
      <select class="field-sel" id="e-dest">${us.map(u=>`<option value="${u.usuario}">${u.usuario} — ${u.nombre}</option>`).join('')}</select></div>
    <div class="field-group"><label class="field-label">Monto ($)</label><input class="field-input" type="number" id="e-monto" placeholder="0.00" step="0.01" min="0.01"></div>
    <div class="field-group"><label class="field-label">Forma</label>
      <select class="field-sel" id="e-forma"><option value="Transferencia">💳 Transferencia</option><option value="Efectivo">💵 Efectivo</option><option value="Cheque">📄 Cheque</option></select></div>
    <div class="field-group"><label class="field-label">Descripción</label><input class="field-input" id="e-desc" placeholder="Ej: Anticipo caja chica junio"></div>
    <label class="field-label">Foto del comprobante (opcional)</label>
    <div class="photo-zone" onclick="document.getElementById('e-foto').click()">
      <input type="file" id="e-foto" accept="image/*" onchange="handleFoto(this,'e-prev','e-stat','e-url')">
      <div style="font-size:28px;margin-bottom:6px">📷</div>
      <div style="font-size:13px;color:var(--text2)">Tomar foto o subir imagen</div>
      <img id="e-prev" class="photo-preview">
      <div class="photo-status" id="e-stat"></div>
    </div>
    <input type="hidden" id="e-url">
    <button class="btn-submit gold" onclick="enviarEntrega()" id="btn-e">Registrar entrega</button>
  </div>`;
}
function vNuevaEntrega(c){ if(!puedeInteractuar()||!esAdminCaja()){ c.innerHTML=roMsg('registrar entregas'); return; } renderNuevaEntrega(c); }
async function enviarEntrega(){
  const monto=parseFloat(document.getElementById('e-monto').value);
  if(!monto||monto<=0){toast('Ingresa el monto');return;}
  // If a photo was selected but not yet uploaded, block submission
  const fotoInp=document.getElementById('e-foto');
  const fotoUrl=document.getElementById('e-url').value;
  if(fotoInp&&fotoInp.files&&fotoInp.files.length>0&&!fotoUrl){
    toast('⏳ Espera que la foto termine de subirse');return;
  }
  let excMotivoE='';
  if(!fotoUrl){
    const mEl=document.getElementById('e-exc-motivo');
    excMotivoE=mEl?mEl.value.trim():'';
    if(excMotivoE.length<5){ mostrarExcepcion('e'); toast('Escribe el motivo en la caja naranja (mínimo unas palabras)'); return; }
  }
  const btn=document.getElementById('btn-e');btn.textContent='Guardando...';btn.disabled=true;
  try{const r=await api({action:'crearEntrega',admin:session.usuario,usuarioDestino:document.getElementById('e-dest').value,monto,forma:document.getElementById('e-forma').value,descripcion:(excMotivoE?'[SIN COMPROBANTE: '+excMotivoE+'] ':'')+(document.getElementById('e-desc').value||'Sin descripción'),fotoUrl:document.getElementById('e-url').value||''});
  if(r.ok){toast('✓ Entrega registrada');try{setView('balance');}catch(e2){cajaGoHome();}}else toast('Error: '+(r.error||''));}catch(e){toast('Error de conexión');}
  btn.textContent='Registrar entrega';btn.disabled=false;
}

async function vAprobarGastos(c){
  c.innerHTML=spin();
  try{const r=await api({action:'getGastos',rol:'admin',estado:'Pendiente'});const g=r.gastos||[];
  window._pendGastos=g;
  c.innerHTML=`<div class="page-title">Gastos por aprobar</div><div class="page-sub">${g.length} pendiente${g.length!==1?'s':''}</div>
  ${g.length?`<button onclick="aprobarTodosGastos()" style="width:100%;padding:12px;background:var(--brand);color:#fff;border:none;border-radius:var(--radius);font-size:14px;font-weight:700;cursor:pointer;margin-bottom:12px">✓ Aprobar todos</button>`:''}
  ${g.length?g.map(x=>gastoH(x,true)).join(''):empty('Sin gastos pendientes ✓')}`;
  }catch(e){c.innerHTML=errMsg();}
}
async function aprobarTodosGastos(){
  const pend=window._pendGastos||[];
  for(const g of pend){try{await api({action:'aprobarGasto',id:g['ID'],admin:session.usuario});}catch(e){}}
  toast('✓ Todos aprobados'); setView('aprobar-gastos');
}

async function vHistorialCaja(c){
  c.innerHTML=spin();
  try{
    const isAdmin=session.rol==='admin';
    const[re,rg]=await Promise.all([
      api({action:'getEntregas',rol:session.rol,usuario:session.usuario}),
      api({action:'getGastos',  rol:session.rol,usuario:session.usuario})
    ]);
    window._cajEnt=re.entregas||[]; window._cajGas=rg.gastos||[];
    const sd=getSemanaAnteriorDates();
    window._cajFi=sd.fi; window._cajFf=sd.ff; window._cajFiltro='semana'; window._cajTab='e';
    renderHistCaja(c);
  }catch(e){c.innerHTML=errMsg();}
}

function cajSetFiltro(f){
  window._cajFiltro=f;
  const d=applyDateFiltro(f,'caj');
  window._cajFi=d.fi; window._cajFf=d.ff;
  renderHistCaja(document.getElementById('content'));
}
function cajApply(){
  window._cajFi=document.getElementById('caj-fi').value;
  window._cajFf=document.getElementById('caj-ff').value;
  window._cajFiltro='custom';
  document.querySelectorAll('[id^="caj-btn-"]').forEach(b=>b.classList.remove('active'));
  renderHistCaja(document.getElementById('content'));
}
function cajSetTab(t,el){
  window._cajTab=t;
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  el.classList.add('active');
  const fi=window._cajFi, ff=window._cajFf;
  const d1=new Date(fi+'T00:00:00'), d2=new Date(ff+'T23:59:59');
  const filtEnt=(window._cajEnt||[]).filter(e=>{const d=parseDateStr((e['Fecha']||'').toString().split(' ')[0]);return d&&d>=d1&&d<=d2;});
  const filtGas=(window._cajGas||[]).filter(g=>{const d=parseDateStr((g['Fecha']||'').toString().split(' ')[0]);return d&&d>=d1&&d<=d2;});
  cajRenderList(t, filtEnt, filtGas);
}
function cajRenderList(tab, filtEnt, filtGas){
  const el=document.getElementById('caj-list'); if(!el)return;
  if(tab==='e') el.innerHTML=filtEnt.length?entregasH(filtEnt):empty('Sin entregas en este período');
  else el.innerHTML=filtGas.length?filtGas.map(g=>gastoH(g,false)).join(''):empty('Sin gastos en este período');
}

async function vMisGastos(c){
  c.innerHTML=spin();
  try{const r=await api({action:'getGastos',rol:'chofer',usuario:session.usuario});const g=r.gastos||[];
  window._misGas=g;
  c.innerHTML=`<div class="page-title">Mis gastos</div>
  <div class="tab-row">
    <div class="tab active" onclick="filtG(this,'')">Todos</div>
    <div class="tab" onclick="filtG(this,'Pendiente')">Pendientes</div>
    <div class="tab" onclick="filtG(this,'Aprobado')">Aprobados</div>
  </div>
  <div id="gas-list">${g.length?g.map(x=>gastoH(x,false)).join(''):empty('Sin gastos registrados')}</div>`;
  }catch(e){c.innerHTML=errMsg();}
}
function filtG(el,est){ document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));el.classList.add('active');const f=est?(window._misGas||[]).filter(g=>g['Estado']===est):(window._misGas||[]);document.getElementById('gas-list').innerHTML=f.length?f.map(x=>gastoH(x,false)).join(''):empty('Sin gastos'); }

function vNuevoGasto(c){
  if(!puedeInteractuar()){ c.innerHTML=roMsg('registrar gastos'); return; }
  c.innerHTML=`<div class="page-title">Registrar gasto</div><div class="page-sub">Sube la factura para aprobación</div>
  <div class="card">
    <div class="field-group"><label class="field-label">Monto ($)</label><input class="field-input" type="number" id="g-monto" placeholder="0.00" step="0.01" min="0.01"></div>
    <div class="field-group"><label class="field-label">Categoría</label>
      <select class="field-sel" id="g-cat"><option value="Alimentación">🍽 Alimentación</option><option value="Combustible">⛽ Combustible</option><option value="Materiales">🔧 Materiales</option><option value="Transporte">🚌 Transporte</option><option value="Otros">📦 Otros</option></select></div>
    <div class="field-group"><label class="field-label">Descripción</label><input class="field-input" id="g-desc" placeholder="Ej: Almuerzo en cliente norte"></div>
    <label class="field-label">Foto de la factura</label>
    <div class="photo-zone" onclick="document.getElementById('g-foto').click()">
      <input type="file" id="g-foto" accept="image/*" onchange="handleFoto(this,'g-prev','g-stat','g-url')">
      <div style="font-size:28px;margin-bottom:6px">🧾</div>
      <div style="font-size:13px;color:var(--text2)">Tomar foto de la factura</div>
      <img id="g-prev" class="photo-preview">
      <div class="photo-status" id="g-stat"></div>
    </div>
    <input type="hidden" id="g-url">
    <button class="btn-submit gold" onclick="enviarGasto()" id="btn-g">Enviar para aprobación</button>
  </div>`;
}
async function enviarGasto(){
  const monto=parseFloat(document.getElementById('g-monto').value);
  if(!monto||monto<=0){toast('Ingresa el monto');return;}
  // If a photo was selected but not yet uploaded, block submission
  const stat=document.getElementById('g-stat');
  const fotoInp=document.getElementById('g-foto');
  const fotoUrl=document.getElementById('g-url').value;
  if(fotoInp&&fotoInp.files&&fotoInp.files.length>0&&!fotoUrl){
    toast('⏳ Espera que la foto termine de subirse');return;
  }
  let excMotivo='';
  if(!fotoUrl){
    const mEl=document.getElementById('g-exc-motivo');
    excMotivo=mEl?mEl.value.trim():'';
    if(excMotivo.length<5){ mostrarExcepcion('g'); toast('Escribe el motivo en la caja naranja (mínimo unas palabras)'); return; }
  }
  const btn=document.getElementById('btn-g');btn.textContent='Enviando...';btn.disabled=true;
  let r=null;
  try{r=await api({action:'crearGasto',usuario:session.usuario,monto,categoria:document.getElementById('g-cat').value,descripcion:(excMotivo?'[SIN RESPALDO: '+excMotivo+'] ':'')+(document.getElementById('g-desc').value||'Sin descripción'),fotoUrl:document.getElementById('g-url').value||''});}
  catch(e){toast('Error de conexión');btn.textContent='Enviar para aprobación';btn.disabled=false;return;}
  btn.textContent='Enviar para aprobación';btn.disabled=false;
  if(r&&r.ok){
    toast('✓ Gasto enviado');
    try{setView(session.rol==='admin'?'aprobar-gastos':'mis-gastos');}catch(e){cajaGoHome();}
  } else toast('Error: '+((r&&r.error)||''));
}

async function vMisEntregas(c){
  c.innerHTML=spin();
  try{const r=await api({action:'getEntregas',rol:'chofer',usuario:session.usuario});const e=r.entregas||[];
  const total=e.reduce((s,x)=>s+parseFloat(x['Monto ($)']||0),0);
  c.innerHTML=`<div class="page-title">Dinero recibido</div>
  <div class="card" style="background:var(--gold-light);border-color:var(--gold);margin-bottom:14px">
    <div style="font-size:11px;color:var(--gold);font-weight:700;text-transform:uppercase;margin-bottom:4px">Total recibido</div>
    <div style="font-size:28px;font-weight:900;color:var(--gold)">$${total.toFixed(2)}</div>
  </div>
  ${e.length?entregasH(e):empty('Sin entregas registradas')}`;
  }catch(e){c.innerHTML=errMsg();}
}

function entregasH(ent){
  if(!ent.length)return empty('Sin entregas');
  return ent.map(e=>{
    const fotoUrl=e['Foto URL']||e['FotoURL']||'';
    const fotoOk=fotoUrl&&fotoUrl!=='undefined'&&fotoUrl.startsWith('http');
    return `<div class="caja-item">
    <div class="caja-hdr"><div class="caja-desc">${e['Descripción']||e['Descripcion']||'Sin descripción'}</div><div class="caja-monto" style="color:var(--gold)">$${parseFloat(e['Monto ($)']||0).toFixed(2)}</div></div>
    <div class="caja-meta">Para: <strong>${e['Usuario Destino']}</strong> · ${e['Forma de Entrega']||e['Forma']||''} · ${fd((e['Fecha']||'').split(' ')[0])}</div>
    ${fotoOk?`<a href="${fotoUrl}" target="_blank" class="caja-link" style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:6px 12px;background:var(--gold-light);border-radius:20px;font-size:12px;font-weight:600;color:var(--gold);text-decoration:none">📎 Ver comprobante →</a>`
    :'<div style="font-size:11px;color:var(--text3);margin-top:4px">Sin comprobante adjunto</div>'}
  </div>`;
  }).join('');
}

function gastoH(g,isAdmin){
  const est=g['Estado']||'Pendiente', bc=badgeClass(est==='Aprobado'?'Aprobada':est==='Rechazado'?'Rechazada':est);
  const acc=isAdmin&&est==='Pendiente'?`<div class="action-row"><button class="btn-reject" onclick="rejG('${g['ID']}')">Rechazar</button><button class="btn-approve" onclick="aprG('${g['ID']}')">✓ Aprobar</button></div>`:'';
  const fotoUrl=g['Foto Factura URL']||g['Foto URL']||g['FotoURL']||'';
  const fotoOk=fotoUrl&&fotoUrl!=='undefined'&&fotoUrl.startsWith('http');
  return `<div class="caja-item">
    <div class="caja-hdr"><div class="caja-desc">${String(g['Descripción']||g['Descripcion']||'Sin descripción').replace(/^\[SIN RESPALDO:[^\]]*\]\s*/,'')}</div><span class="badge ${bc}">${est}</span></div>
    ${String(g['Descripcion']||g['Descripción']||'').indexOf('[SIN RESPALDO')===0?`<div style="display:inline-block;background:var(--warn-bg);color:var(--warn-tx);font-size:10px;font-weight:800;padding:3px 8px;border-radius:8px;margin-bottom:6px">⚠ SIN RESPALDO — ${String(g['Descripcion']||g['Descripción']||'').match(/\[SIN RESPALDO:\s*([^\]]*)\]/)?.[1]||''}</div>`:''}
    <div class="caja-monto" style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px">$${parseFloat(g['Monto ($)']||0).toFixed(2)}</div>
    <div class="caja-meta">${g['Categoría']||g['Categoria']||''} · ${g['Usuario']} · ${fd((g['Fecha']||'').split(' ')[0])}</div>
    ${fotoOk?`<a href="${fotoUrl}" target="_blank" class="caja-link" style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:6px 12px;background:var(--brand-light);border-radius:20px;font-size:12px;font-weight:600;color:var(--brand-dark);text-decoration:none">📎 Ver factura →</a>`
    :'<div style="font-size:11px;color:var(--text3);margin-top:4px">Sin foto adjunta</div>'}
    ${acc}</div>`;
}
async function aprG(id){try{const r=await api({action:'aprobarGasto',id,admin:session.usuario});if(r.ok){toast('✓ Aprobado');setView('aprobar-gastos');}else toast('Error');}catch(e){toast('Error de conexión');}}
async function rejG(id){try{const r=await api({action:'rechazarGasto',id,admin:session.usuario});if(r.ok){toast('Rechazado');setView('aprobar-gastos');}else toast('Error');}catch(e){toast('Error de conexión');}}

// ─── PHOTO UPLOAD ─────────────────────────────────────────────────────────────
async function handleFoto(input,prevId,statId,urlId){
  const file=input.files[0]; if(!file)return;
  const prev=document.getElementById(prevId), stat=document.getElementById(statId), urlInp=document.getElementById(urlId);
  prev.src=URL.createObjectURL(file); prev.style.display='block';
  stat.style.display='block'; stat.style.color='var(--text2)'; stat.textContent='Comprimiendo imagen...';
  // Disable ALL submit buttons while uploading
  const btns=document.querySelectorAll('.btn-submit');
  btns.forEach(b=>{b._wasDisabled=b.disabled;b.disabled=true;b.style.opacity='0.4';});
  urlInp.value=''; // Clear previous URL
  try{
    const b64=await comprimirImagen(file,1200,0.75);
    stat.textContent='Subiendo foto a Drive...';
    const r=await api({action:'savePhoto',base64:b64,mimeType:'image/jpeg',nombre:file.name||'foto.jpg'});
    if(r.ok){
      urlInp.value=r.url;
      stat.textContent='✓ Foto subida correctamente';
      stat.style.color='var(--brand)';
    } else {
      stat.textContent='❌ Error al subir: '+(r.error||'intenta de nuevo');
      stat.style.color='var(--err-tx)';
    }
  }catch(e){
    stat.textContent='❌ Error de conexión al subir foto';
    stat.style.color='var(--err-tx)';
  } finally {
    // Re-enable submit buttons
    btns.forEach(b=>{b.disabled=b._wasDisabled||false;b.style.opacity='';});
  }
}

function comprimirImagen(file, maxW, quality){
  return new Promise((res,rej)=>{
    const img=new Image();
    img.onload=()=>{
      let w=img.width, h=img.height;
      if(w>maxW){h=Math.round(h*maxW/w);w=maxW;}
      const canvas=document.createElement('canvas');
      canvas.width=w; canvas.height=h;
      canvas.getContext('2d').drawImage(img,0,0,w,h);
      const data=canvas.toDataURL('image/jpeg',quality);
      res(data.split(',')[1]);
    };
    img.onerror=rej;
    img.src=URL.createObjectURL(file);
  });
}

// ─── HOME QUICK ACTIONS ─────────────────────────────────────────────────────
async function renderHomeActions(){
  const isAdmin=session.rol==='admin';
  const attnEl=document.getElementById('home-attn');
  const metEl=document.getElementById('home-metrics');
  const gridEl=document.getElementById('home-grid');
  if(!attnEl||!metEl||!gridEl)return;

  const fabDin=document.getElementById('fab-dinero');
  if(fabDin) fabDin.style.display=isAdmin?'flex':'none';
  const cfgTab=document.getElementById('hnav-config');
  const navEl=document.getElementById('home-nav');
  if(cfgTab&&navEl){ cfgTab.style.display=isAdmin?'block':'none'; navEl.classList.toggle('c3',!isAdmin); }

  function hgBtn(mod,view,t,s){
    return `<button class="hg-item" onclick="cajaOpenMod('${mod}','${view}')"><div class="hg-t">${t}</div><div class="hg-s">${s}</div></button>`;
  }
  function mcCard(mod,view,lbl,val,sub){
    return `<button class="metric-card" onclick="cajaOpenMod('${mod}','${view}')"><div class="mc-lbl">${lbl}</div><div class="mc-val">${val}</div><div class="mc-sub">${sub}</div></button>`;
  }
  function attnRow(mod,view,txt){
    return `<button class="attn-row" onclick="cajaOpenMod('${mod}','${view}')"><span class="attn-txt">${txt}</span><span class="attn-go">Ver →</span></button>`;
  }

  if(isAdmin){
    gridEl.innerHTML=
      hgBtn('rutas','aprobar','Aprobar Rutas','Pendientes')+
      hgBtn('caja','aprobar-gastos','Aprobar Gastos','Pendientes')+
      hgBtn('rutas','historial','Historial Rutas','Ver todas')+
      hgBtn('caja','historial-caja','Historial Caja','Entregas y gastos');
  } else {
    gridEl.innerHTML=
      hgBtn('rutas','mis-rutas','Mis Rutas','Mis solicitudes')+
      hgBtn('rutas','cuenta','Mi Cuenta','KM y cobros')+
      hgBtn('caja','balance','Mi Caja','Balance')+
      hgBtn('caja','historial-caja','Historial Caja','Entregas y gastos');
  }

  metEl.innerHTML=
    mcCard('rutas','corte',isAdmin?'A pagar':'Mi período','...','')+
    mcCard('caja','balance','Caja disponible','...','');

  try{
    const rol=isAdmin?'admin':'chofer';
    const res=await Promise.all([
      api({action:'getRutas',rol:rol,usuario:session.usuario}),
      api({action:'getEntregas',rol:rol,usuario:session.usuario}),
      api({action:'getGastos',rol:rol,usuario:session.usuario})
    ]);
    const rutas=cajaReadList(res[0],'rutas');
    const entregas=cajaReadList(res[1],'entregas');
    const gastos=cajaReadList(res[2],'gastos');

    const pd=getPeriodoDates(0);
    let pagarTxt='—', pagarSub='sin conexión';
    if(rutas){
      const enPeriodo=r=>{const f=String(r['Fecha Servicio']||'').slice(0,10);return f>=pd.fi&&f<=pd.ff;};
      const aprob=rutas.filter(r=>r['Estado']==='Aprobada'&&enPeriodo(r));
      const km=Math.round(aprob.reduce((s,r)=>s+parseFloat(r['KM']||0),0)*10)/10;
      const usd=Math.round(aprob.reduce((s,r)=>s+parseFloat(r['Valor ($)']||0),0)*100)/100;
      pagarTxt='$'+usd.toFixed(2);
      pagarSub=aprob.length+' rutas · '+km+' km';
    }

    let saldo=null;
    if(entregas&&gastos){
      saldo=saldoCajaPeriodo(entregas,gastos,pd.fi,pd.ff);
      window._cajEnt=entregas;
      window._cajGas=gastos;
    } else {
      try{
        const br=await api({action:'getBalanceCaja'});
        const bals=cajaReadList(br,'balances')||[];
        const mine=isAdmin?bals:bals.filter(b=>b.usuario===session.usuario);
        const confirmed=mine.some(b=>(Number(b.entregado)||0)||(Number(b.aprobado)||0)||(Number(b.pendiente)||0)||(Number(b.disponible)||0));
        if(confirmed){
          const tE=mine.reduce((s,b)=>s+(Number(b.entregado)||0),0);
          const tA=mine.reduce((s,b)=>s+(Number(b.aprobado)||0),0);
          const tP=mine.reduce((s,b)=>s+(Number(b.pendiente)||0),0);
          saldo={disponible:round2(tE-tA),pendiente:round2(tP)};
        }
      }catch(e2){}
    }
    const dispTxt=saldo?('$'+Number(saldo.disponible||0).toFixed(2)):'—';
    const dispSub=!saldo?'sin conexión':((saldo.pendiente||0)>0?('$'+(Math.round(saldo.pendiente*100)/100).toFixed(2)+' pendiente'):'al día ✓');

    metEl.innerHTML=
      mcCard('rutas','corte',isAdmin?'A pagar':'Mi período',pagarTxt,pagarSub)+
      mcCard('caja','balance','Caja disponible',dispTxt,dispSub);

    const pendR=(rutas||[]).filter(r=>r['Estado']==='Pendiente');
    if(isAdmin){
      const pendG=gastos?gastos.filter(g=>cajaEstado(g)==='Pendiente'):[];
      let rows='';
      if(rutas&&pendR.length) rows+=attnRow('rutas','aprobar',pendR.length+(pendR.length!==1?' rutas':' ruta')+' por aprobar');
      if(gastos&&pendG.length) rows+=attnRow('caja','aprobar-gastos',pendG.length+(pendG.length!==1?' gastos':' gasto')+' por aprobar');
      attnEl.innerHTML=rows?('<div class="attn-card"><div class="attn-title">Requiere tu atención</div>'+rows+'</div>'):'';
    } else {
      const hoy=ymdLocal(new Date());
      const tieneHoy=!!(rutas&&rutas.some(r=>String(r['Fecha Servicio']||r['Fecha Solicitud']||'').slice(0,10)===hoy));
      let rows='';
      if(rutas&&!tieneHoy) rows+=attnRow('rutas','nueva','No has registrado rutas hoy');
      attnEl.innerHTML=rows?('<div class="attn-card"><div class="attn-title">Recordatorio</div>'+rows+'</div>'):'';
    }
    // Actividad reciente: últimas 4 rutas
    const actEl=document.getElementById('home-activity');
    const actLbl=document.getElementById('home-act-label');
    if(actEl){
      const rec=(rutas||[]).slice(0,4);
      if(rec.length){
        if(actLbl)actLbl.style.display='block';
        actEl.innerHTML=rec.map(r=>{
          const dest=placeName(r['Destino']||'—');
          const est=r['Estado']||'Pendiente';
          const dot=est==='Aprobada'?'#5DCAA5':est==='Rechazada'?'#F09595':'#FAC775';
          const val=parseFloat(r['Valor ($)']||0);
          return '<div class="act-row"><span class="act-txt"><span style="color:'+dot+'">●</span> '+dest+'</span><span class="act-val">$'+val.toFixed(2)+'</span></div>';
        }).join('');
      } else {
        if(actLbl)actLbl.style.display='none';
        actEl.innerHTML='';
      }
    }
  }catch(e){
    metEl.innerHTML=
      mcCard('rutas','corte',isAdmin?'A pagar':'Mi período','—','sin conexión')+
      mcCard('caja','balance','Caja disponible','—','sin conexión');
  }
}

function toggleFab(force){
  const menu=document.getElementById('fab-menu');
  const btn=document.getElementById('fab-btn');
  if(!menu||!btn)return;
  const open=force!==undefined?force:(menu.style.display==='none');
  menu.style.display=open?'block':'none';
  btn.textContent=open?'×':'+';
}

function fabGo(mod,view){
  toggleFab(false);
  cajaOpenMod(mod,view);
}

// ─── FOTO OBLIGATORIA: excepción justificada ─────────────────────────────────
function mostrarExcepcion(prefix){
  let exc=document.getElementById(prefix+'-exc');
  if(!exc){
    const btn=document.getElementById('btn-'+prefix);
    if(!btn)return;
    exc=document.createElement('div');
    exc.id=prefix+'-exc';
    exc.innerHTML='<div style="background:var(--warn-bg);border:1px solid var(--warn-tx);border-radius:10px;padding:12px;margin:12px 0">'
      +'<div style="font-size:12px;font-weight:700;color:var(--warn-tx);margin-bottom:8px">Sin comprobante — quedará marcado para revisión del admin</div>'
      +'<input id="'+prefix+'-exc-motivo" placeholder="Explica por qué no hay factura/foto" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text)">'
      +'</div>';
    btn.parentNode.insertBefore(exc,btn);
  }
  exc.style.display='block';
  const inp=document.getElementById(prefix+'-exc-motivo');
  if(inp)setTimeout(()=>inp.focus(),50);
}

// ─── PDF: cargador jsPDF ─────────────────────────────────────────────────────
function loadJsPDF(){
  return new Promise((res,rej)=>{
    if(window.jspdf&&window.jspdf.jsPDF)return res(window.jspdf.jsPDF);
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload=()=>res(window.jspdf.jsPDF);
    s.onerror=()=>rej(new Error('jspdf'));
    document.head.appendChild(s);
  });
}

function _pdfHeader(doc,titulo,sub){
  doc.setFillColor(22,25,38);
  doc.rect(0,0,210,26,'F');
  doc.setTextColor(232,255,0);
  doc.setFontSize(15);doc.setFont(undefined,'bold');
  doc.text('MINECORE',14,11);
  doc.setTextColor(255,255,255);
  doc.setFontSize(11);
  doc.text(titulo,14,19);
  doc.setTextColor(120,120,120);
  doc.setFontSize(8);doc.setFont(undefined,'normal');
  doc.text(sub,196,19,{align:'right'});
  doc.setTextColor(30,30,30);
  return 34;
}
function _pdfLinea(doc,y){ doc.setDrawColor(210,210,200); doc.line(14,y,196,y); return y+5; }
function _pdfCheckPage(doc,y){ if(y>276){doc.addPage();return 16;} return y; }

// ─── PDF: Corte de rutas ─────────────────────────────────────────────────────
async function descargarCortePDF(fiArg,ffArg){
  try{
    toast('Generando PDF...');
    const jsPDF=await loadJsPDF();
    const doc=new jsPDF();
    const fromArgs=!!(fiArg&&ffArg);
    const filtro=fromArgs?'rango':(window._corFiltro||'periodo');
    const fi=fromArgs?fiArg:window._corFi,ff=fromArgs?ffArg:window._corFf;
    const fuente=fromArgs?((window._histRutas&&window._histRutas.length?window._histRutas:window._corteRutas)||[]).filter(r=>r['Estado']==='Aprobada'):(window._corteRutas||[]);
    const todas=fuente;
    const rutas=(filtro==='todo')?todas:filterByDate(todas,fi,ff);
    const rango=(filtro==='todo')?'Todas las fechas':(fd(fi)+' — '+fd(ff));
    let y=_pdfHeader(doc,'Corte de rutas','Generado '+fd(new Date().toISOString().split('T')[0])+' por '+session.usuario);

    doc.setFontSize(10);doc.setFont(undefined,'bold');
    doc.text('Período: '+rango,14,y);y+=8;

    // Desglose por propietario
    const OWNERS={EFCH:'Esteban Ferlito',MPL:'Martín Pinto',OPM:'Oswaldo Peña'};
    const byOwner={};
    rutas.forEach(rt=>{
      const veh=String(rt['Vehiculo']||'').trim();
      const ownId=VEH_OWNER[veh];if(!ownId)return;
      if(!byOwner[ownId])byOwner[ownId]={nombre:OWNERS[ownId]||ownId,km:0,usd:0,vehs:{}};
      byOwner[ownId].km+=parseFloat(rt['KM']||0);
      byOwner[ownId].usd+=parseFloat(rt['Valor ($)']||0);
      if(!byOwner[ownId].vehs[veh])byOwner[ownId].vehs[veh]={km:0,usd:0,n:0};
      byOwner[ownId].vehs[veh].km+=parseFloat(rt['KM']||0);
      byOwner[ownId].vehs[veh].usd+=parseFloat(rt['Valor ($)']||0);
      byOwner[ownId].vehs[veh].n++;
    });
    doc.setFontSize(11);doc.text('Resumen por propietario',14,y);y+=2;y=_pdfLinea(doc,y+1);
    doc.setFontSize(9);
    Object.values(byOwner).forEach(o=>{
      y=_pdfCheckPage(doc,y);
      doc.setFont(undefined,'bold');
      doc.text(o.nombre,14,y);
      doc.text('$'+o.usd.toFixed(2),196,y,{align:'right'});
      doc.setFont(undefined,'normal');y+=5;
      Object.entries(o.vehs).forEach(([v,d])=>{
        y=_pdfCheckPage(doc,y);
        doc.setTextColor(100,100,100);
        doc.text('   '+v+' — '+d.n+' rutas · '+(Math.round(d.km*10)/10)+' km',14,y);
        doc.text('$'+d.usd.toFixed(2),196,y,{align:'right'});
        doc.setTextColor(30,30,30);y+=5;
      });
      y+=2;
    });

    // Detalle
    y+=3;y=_pdfCheckPage(doc,y);
    doc.setFontSize(11);doc.setFont(undefined,'bold');
    doc.text('Detalle de rutas ('+rutas.length+')',14,y);y=_pdfLinea(doc,y+3);
    doc.setFontSize(8);doc.setFont(undefined,'normal');
    rutas.forEach(r=>{
      const dest=_pdfSafe(String(r['Destino']||'\u2014'));
      const lines=doc.splitTextToSize((r['Usuario']||'')+' \u00B7 '+dest,90);
      const needH=lines.length*4.3+1.6;
      if(y+needH>276){doc.addPage();y=16;}
      doc.setTextColor(100,100,100);
      doc.text(fd((r['Fecha Servicio']||'').slice(0,10)),14,y);
      doc.setTextColor(30,30,30);
      doc.text((parseFloat(r['KM']||0))+' km',158,y,{align:'right'});
      doc.text('$'+parseFloat(r['Valor ($)']||0).toFixed(2),196,y,{align:'right'});
      for(let k=0;k<lines.length;k++){ doc.text(lines[k],36,y); y+=4.3; }
      y+=1.6;
    });
    const tKm=Math.round(rutas.reduce((s,r)=>s+parseFloat(r['KM']||0),0)*10)/10;
    const tUsd=Math.round(rutas.reduce((s,r)=>s+parseFloat(r['Valor ($)']||0),0)*100)/100;
    y=_pdfLinea(doc,y+1);y=_pdfCheckPage(doc,y);
    doc.setFontSize(10);doc.setFont(undefined,'bold');
    doc.text('TOTAL: '+tKm+' km',14,y);
    doc.text('$'+tUsd.toFixed(2),196,y,{align:'right'});
    // Sección aparte: rutas rechazadas (no cuentan en totales)
    const fuenteAll=(window._histRutas&&window._histRutas.length?window._histRutas:(window._corteRutasAll||[]));
    let rech=fuenteAll.filter(x=>x['Estado']==='Rechazada');
    if(filtro!=='todo') rech=filterByDate(rech,fi,ff);
    if(rech.length){
      y+=10;if(y>268){doc.addPage();y=16;}
      doc.setFontSize(11);doc.setFont(undefined,'bold');
      doc.setTextColor(163,45,45);
      doc.text('Rutas rechazadas ('+rech.length+') \u2014 no incluidas en el total',14,y);
      doc.setTextColor(30,30,30);
      y=_pdfLinea(doc,y+3);
      doc.setFontSize(8);doc.setFont(undefined,'normal');
      rech.forEach(x=>{
        const dest=_pdfSafe(String(x['Destino']||'\u2014'));
        const motivo=_pdfSafe(String(x['Notas']||''));
        const lines=doc.splitTextToSize((x['Usuario']||'')+' \u00B7 '+dest,90);
        const mLines=motivo?doc.splitTextToSize('Motivo: '+motivo,90):[];
        const needH=(lines.length+mLines.length)*4.3+1.6;
        if(y+needH>276){doc.addPage();y=16;}
        doc.setTextColor(100,100,100);
        doc.text(fd((x['Fecha Servicio']||'').slice(0,10)),14,y);
        doc.setTextColor(30,30,30);
        doc.text((parseFloat(x['KM']||0))+' km',158,y,{align:'right'});
        doc.text('$'+parseFloat(x['Valor ($)']||0).toFixed(2),196,y,{align:'right'});
        for(let k=0;k<lines.length;k++){ doc.text(lines[k],36,y); y+=4.3; }
        doc.setTextColor(163,45,45);
        for(let k=0;k<mLines.length;k++){ doc.text(mLines[k],36,y); y+=4.3; }
        doc.setTextColor(30,30,30);
        y+=1.6;
      });
    }
    doc.save('minecore-corte-'+(filtro==='todo'?'todo':fi)+'.pdf');
  }catch(e){toast('No se pudo generar el PDF');}
}

// ─── PDF: Historial de caja ──────────────────────────────────────────────────
async function descargarCajaPDF(fiArg,ffArg){
  try{
    toast('Generando PDF...');
    const jsPDF=await loadJsPDF();
    const doc=new jsPDF();
    const fromArgs=!!(fiArg&&ffArg);
    const filtro=fromArgs?'rango':(window._cajFiltro||'periodo');
    const fi=fromArgs?fiArg:window._cajFi,ff=fromArgs?ffArg:window._cajFf;
    const d1=new Date(fi+'T00:00:00'),d2=new Date(ff+'T23:59:59');
    const inRange=x=>{if(filtro==='todo')return true;const d=parseDateStr(((x['Fecha']||'').toString()).split(' ')[0]);return d&&d>=d1&&d<=d2;};
    const ent=(window._cajEnt||[]).filter(inRange);
    const gas=(window._cajGas||[]).filter(inRange);
    const rango=(filtro==='todo')?'Todas las fechas':(fd(fi)+' — '+fd(ff));
    let y=_pdfHeader(doc,'Caja chica — Historial','Generado '+fd(new Date().toISOString().split('T')[0])+' por '+session.usuario);
    const saldoIni=(filtro==='todo')?0:saldoAnterior(fi);
    doc.setFontSize(10);doc.setFont(undefined,'bold');
    doc.text('Período: '+rango,14,y);y+=6;
    if(filtro!=='todo'){
      doc.setFont(undefined,'normal');doc.setFontSize(9);
      doc.text('Saldo inicial (arrastre del período anterior): $'+saldoIni.toFixed(2),14,y);y+=7;
    } else { y+=2; }

    doc.setFontSize(11);doc.text('Entregas ('+ent.length+')',14,y);y=_pdfLinea(doc,y+3);
    doc.setFontSize(8);doc.setFont(undefined,'normal');
    let tE=0;
    ent.forEach(e=>{
      y=_pdfCheckPage(doc,y);
      const m=parseFloat(e['Monto ($)']||0);tE+=m;
      doc.setTextColor(100,100,100);
      doc.text(fd(((e['Fecha']||'').toString()).split(' ')[0]),14,y);
      doc.setTextColor(30,30,30);
      doc.text(_pdfSafe((e['Admin']||'')+' > '+(e['Usuario Destino']||'')+' \u00B7 '+(e['Forma']||'')),36,y);
      doc.text('$'+m.toFixed(2),196,y,{align:'right'});
      y+=5;
    });
    y=_pdfLinea(doc,y+1);
    doc.setFont(undefined,'bold');doc.setFontSize(9);
    doc.text('Total entregado',14,y);doc.text('$'+tE.toFixed(2),196,y,{align:'right'});y+=9;

    y=_pdfCheckPage(doc,y);
    const gasAct=gas.filter(x=>x['Estado']!=='Rechazado');
    const gasRech=gas.filter(x=>x['Estado']==='Rechazado');
    doc.setFontSize(11);doc.text('Gastos ('+gasAct.length+')',14,y);y=_pdfLinea(doc,y+3);
    doc.setFontSize(8);doc.setFont(undefined,'normal');
    let tA=0,tP=0;
    gasAct.forEach(g=>{
      const m=parseFloat(g['Monto ($)']||0);
      const est=g['Estado']||'Pendiente';
      if(est==='Aprobado')tA+=m; if(est==='Pendiente')tP+=m;
      const desc=_pdfSafe(String(g['Descripcion']||g['Descripción']||''));
      const lines=doc.splitTextToSize((g['Usuario']||'')+' \u00B7 '+desc,88);
      const needH=lines.length*4.3+1.6;
      if(y+needH>276){doc.addPage();y=16;}
      doc.setTextColor(100,100,100);
      doc.text(fd(((g['Fecha']||'').toString()).split(' ')[0]),14,y);
      doc.setTextColor(30,30,30);
      doc.text(est,158,y,{align:'right'});
      doc.text('$'+m.toFixed(2),196,y,{align:'right'});
      for(let k=0;k<lines.length;k++){ doc.text(lines[k],36,y); y+=4.3; }
      y+=1.6;
    });
    y=_pdfLinea(doc,y+1);y=_pdfCheckPage(doc,y);
    doc.setFont(undefined,'bold');doc.setFontSize(9);
    doc.text('Inicial $'+saldoIni.toFixed(2)+'  +  entró $'+tE.toFixed(2)+'  −  salió $'+tA.toFixed(2)+(tP>0?'   (pendiente $'+tP.toFixed(2)+')':''),14,y);
    doc.text('SALDO FINAL: $'+(Math.round((saldoIni+tE-tA)*100)/100).toFixed(2),196,y,{align:'right'});
    // Sección aparte: gastos rechazados (no cuentan en totales)
    if(gasRech.length){
      y+=10;if(y>268){doc.addPage();y=16;}
      doc.setFontSize(11);doc.setFont(undefined,'bold');
      doc.setTextColor(163,45,45);
      doc.text('Gastos rechazados ('+gasRech.length+') \u2014 no incluidos en el saldo',14,y);
      doc.setTextColor(30,30,30);
      y=_pdfLinea(doc,y+3);
      doc.setFontSize(8);doc.setFont(undefined,'normal');
      gasRech.forEach(g=>{
        const m=parseFloat(g['Monto ($)']||0);
        const desc=_pdfSafe(String(g['Descripcion']||g['Descripción']||''));
        const lines=doc.splitTextToSize((g['Usuario']||'')+' \u00B7 '+desc,88);
        const needH=lines.length*4.3+1.6;
        if(y+needH>276){doc.addPage();y=16;}
        doc.setTextColor(100,100,100);
        doc.text(fd(((g['Fecha']||'').toString()).split(' ')[0]),14,y);
        doc.setTextColor(30,30,30);
        doc.text('$'+m.toFixed(2),196,y,{align:'right'});
        for(let k=0;k<lines.length;k++){ doc.text(lines[k],36,y); y+=4.3; }
        y+=1.6;
      });
    }
    doc.save('minecore-caja-'+(filtro==='todo'?'todo':fi)+'.pdf');
  }catch(e){toast('No se pudo generar el PDF');}
}

function renderHistorial(c){
  c.innerHTML=`
  <div class="page-title">Historial de rutas</div>
  <input class="search-box" id="h-search" placeholder="🔍 Buscar por usuario, destino, vehículo..." oninput="hRender()" value="${window._hSearch||''}" style="margin:0 0 12px">
  <div id="h-list"></div>`;
  hRender();
}

function hRender(){
  const list=document.getElementById('h-list');
  if(!list)return;
  const sEl=document.getElementById('h-search');
  window._hSearch=sEl?sEl.value:'';
  const q=(window._hSearch||'').toLowerCase();
  const isAdmin=session.rol==='admin';
  let rutas=window._histRutas||[];
  if(q)rutas=rutas.filter(r=>((r['Usuario']||'')+' '+(r['Origen']||'')+' '+(r['Destino']||'')+' '+(r['Vehiculo']||'')).toLowerCase().includes(q));
  if(!rutas.length){list.innerHTML=empty('Sin rutas');return;}
  const getD=r=>parseDateStr(r['Fecha Servicio']||r['Fecha Solicitud']||'');
  const periodos=listaPeriodos(rutas,getD);
  list.innerHTML=periodos.map((p,i)=>{
    const items=rutas.filter(r=>{const d=getD(r);return d&&d>=p.d1&&d<=p.d2;});
    if(!items.length)return '';
    const usd=Math.round(items.filter(r=>r['Estado']==='Aprobada').reduce((s,r)=>s+parseFloat(r['Valor ($)']||0),0)*100)/100;
    const km=Math.round(items.reduce((s,r)=>s+parseFloat(r['KM']||0),0)*10)/10;
    const open=i===0&&!q?true:(q?true:false);
    return `<div class="pfolder">
      <div class="pfolder-hdr" onclick="togglePF('pf-r-${i}',this)">
        <div><div class="pf-lbl">📁 ${p.label}</div><div class="pf-sub">${items.length} ruta${items.length!==1?'s':''} · ${km} km · $${usd.toFixed(2)} aprobado</div></div>
        <div class="pf-actions"><button class="pf-pdf" onclick="event.stopPropagation();descargarCortePDF('${p.fi}','${p.ff}')">↓ PDF</button><span class="pf-chev">${open?'▴':'▾'}</span></div>
      </div>
      <div class="pfolder-body" id="pf-r-${i}" style="display:${open?'block':'none'}">${items.map(r=>rutaTicket(r,isAdmin)).join('')}</div>
    </div>`;
  }).join('')||empty('Sin rutas');
}

function renderHistCaja(c){
  const isAdmin=session.rol==='admin';
  const ent=window._cajEnt||[],gas=window._cajGas||[];
  const getD=x=>parseDateStr(((x['Fecha']||'').toString()).split(' ')[0]);
  const filtro=window._cajFiltro||'semana';
  const _sd=getSemanaAnteriorDates();
  const fi=window._cajFi||_sd.fi, ff=window._cajFf||_sd.ff;
  const meses=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const pd=getPeriodoDates(0), pa=getPeriodoDates(-1);
  const pLabel=`26 ${meses[new Date(pd.fi+'T12:00:00').getMonth()]} → 25 ${meses[new Date(pd.ff+'T12:00:00').getMonth()]}`;
  const aLabel=`26 ${meses[new Date(pa.fi+'T12:00:00').getMonth()]} → 25 ${meses[new Date(pa.ff+'T12:00:00').getMonth()]}`;
  c.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap"><div class="page-title">Historial Caja</div><button onclick="descargarCajaPDF(document.getElementById('caj-fi').value,document.getElementById('caj-ff').value)" style="padding:8px 14px;background:#161926;color:#E8FF00;border:none;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0">↓ Generar PDF</button></div>
  <div class="filter-bar">
    <div class="filter-label">Período</div>
    <div class="filter-btns">
      ${['hoy','ayer','7dias','semana','periodo','anterior','todo'].map(id=>{
        const labels={hoy:'Hoy',ayer:'Ayer','7dias':'7 días',semana:'Semana ant.',periodo:`Período (${pLabel})`,anterior:`← Anterior (${aLabel})`,todo:'Todo'};
        return `<button class="filt-btn${filtro===id?' active':''}" id="caj-btn-${id}" onclick="cajSetFiltro('${id}')">${labels[id]}</button>`;
      }).join('')}
    </div>
    <div class="date-row">
      <input type="date" id="caj-fi" value="${fi}">
      <span style="color:var(--text3)">→</span>
      <input type="date" id="caj-ff" value="${ff}">
      <button class="btn-ok" onclick="cajApply()">OK</button>
    </div>
  </div>
  <div class="page-sub">Carpetas por período de corte</div><div id="hc-list"></div>`;
  const list=document.getElementById('hc-list');
  const all=ent.concat(gas);
  if(!all.length){list.innerHTML=empty('Sin movimientos');return;}
  const periodos=listaPeriodos(all,getD);
  list.innerHTML=periodos.map((p,i)=>{
    const e=ent.filter(x=>{const d=getD(x);return d&&d>=p.d1&&d<=p.d2;});
    const g=gas.filter(x=>{const d=getD(x);return d&&d>=p.d1&&d<=p.d2;});
    if(!e.length&&!g.length)return '';
    const tE=Math.round(e.reduce((s,x)=>s+parseFloat(x['Monto ($)']||0),0)*100)/100;
    const tG=Math.round(g.filter(x=>x['Estado']==='Aprobado').reduce((s,x)=>s+parseFloat(x['Monto ($)']||0),0)*100)/100;
    const ini=saldoAnterior(p.fi);
    const fin=Math.round((ini+tE-tG)*100)/100;
    const open=i===0;
    return `<div class="pfolder">
      <div class="pfolder-hdr" onclick="togglePF('pf-c-${i}',this)">
        <div><div class="pf-lbl">📁 ${p.label}</div><div class="pf-sub">Inicial $${ini.toFixed(2)} · Entró $${tE.toFixed(2)} · Salió $${tG.toFixed(2)} · <b style="color:var(--brand)">Final $${fin.toFixed(2)}</b></div></div>
        <div class="pf-actions"><button class="pf-pdf" onclick="event.stopPropagation();descargarCajaPDF('${p.fi}','${p.ff}')">↓ PDF</button><span class="pf-chev">${open?'▴':'▾'}</span></div>
      </div>
      <div class="pfolder-body" id="pf-c-${i}" style="display:${open?'block':'none'}">
        ${e.length?'<div class="pf-mini">Entregas</div>'+entregasH(e):''}
        ${g.length?'<div class="pf-mini">Gastos</div>'+g.map(x=>gastoH(x,isAdmin)).join(''):''}
      </div>
    </div>`;
  }).join('')||empty('Sin movimientos');
}

function listaPeriodos(items,getD,maxBack){
  maxBack=maxBack||18;
  let oldest=null;
  items.forEach(x=>{const d=getD(x);if(d&&(!oldest||d<oldest))oldest=d;});
  const out=[];
  const M=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  for(let off=0;off>=-maxBack;off--){
    const pd=getPeriodoDates(off);
    const d1=new Date(pd.fi+'T00:00:00'),d2=new Date(pd.ff+'T23:59:59');
    const da=new Date(pd.fi+'T12:00:00'),db=new Date(pd.ff+'T12:00:00');
    const label=da.getDate()+' '+M[da.getMonth()]+' → '+db.getDate()+' '+M[db.getMonth()]+' '+db.getFullYear()+(off===0?' · actual':'');
    out.push({fi:pd.fi,ff:pd.ff,d1:d1,d2:d2,label:label,off:off});
    if(!oldest)break;
    if(d1<=oldest)break;
  }
  return out;
}

function togglePF(id,hdr){
  const el=document.getElementById(id);
  if(!el)return;
  const open=el.style.display==='none';
  el.style.display=open?'block':'none';
  if(hdr){const ch=hdr.querySelector('.pf-chev');if(ch)ch.textContent=open?'▴':'▾';}
}

function round2(n){ return Math.round((Number(n)||0)*100)/100; }
function cajaMonto(row){
  if(!row) return 0;
  var raw=row['Monto ($)'];
  if(raw==null||raw==='') raw=row.monto;
  var n=parseFloat(raw);
  return isNaN(n)?0:n;
}
function cajaDia(row){
  var raw=String((row&&(row['Fecha']||row.fecha))||'');
  return parseDateStr(raw.slice(0,10));
}
function cajaEstado(row){
  return String((row&&(row['Estado']||row.estado))||'').trim();
}
function cajaReadList(res, key){
  if(!res || res.ok===false || res._transport) return null;
  var list=res[key];
  return Array.isArray(list)?list:null;
}
/* Disponible del corte 26→25: arrastre anterior a fi + entregas del período − aprobados del período.
   Pendiente no resta (igual que el PDF de historial). Sin fecha se incluye, para no esconder plata. */
function saldoCajaPeriodo(entregas, gastos, fi, ff){
  var d1=new Date(fi+'T00:00:00');
  var d2=new Date(ff+'T23:59:59');
  var ent=0, apr=0, pen=0, entArr=0, aprArr=0;
  var by={};
  function bump(u){
    u=String(u||'').trim()||'—';
    if(!by[u]) by[u]={usuario:u,nombre:NAME_HINTS[u]||u,entregado:0,aprobado:0,pendiente:0,disponible:0};
    return by[u];
  }
  function inCut(d){ return !d || d<=d2; }
  (entregas||[]).forEach(function(e){
    var d=cajaDia(e);
    if(!inCut(d)) return;
    var m=cajaMonto(e);
    ent+=m;
    if(d&&d<d1) entArr+=m;
    bump(e['Usuario Destino']||e.usuarioDestino||e.usuario).entregado+=m;
  });
  var pendN=0;
  (gastos||[]).forEach(function(g){
    var est=cajaEstado(g);
    var m=cajaMonto(g);
    var who=g['Usuario']||g.usuario;
    if(est==='Pendiente'){
      pendN++;
      pen+=m;
      bump(who).pendiente+=m;
      return;
    }
    if(est!=='Aprobado') return;
    var d=cajaDia(g);
    if(!inCut(d)) return;
    apr+=m;
    if(d&&d<d1) aprArr+=m;
    bump(who).aprobado+=m;
  });
  var users=Object.keys(by).map(function(k){
    var b=by[k];
    b.entregado=round2(b.entregado);
    b.aprobado=round2(b.aprobado);
    b.pendiente=round2(b.pendiente);
    b.disponible=round2(b.entregado-b.aprobado);
    return b;
  });
  return {
    entregado:round2(ent),
    aprobado:round2(apr),
    pendiente:round2(pen),
    pendienteN:pendN,
    arrastre:round2(entArr-aprArr),
    disponible:round2(ent-apr),
    users:users
  };
}

function saldoAnterior(fi){
  const d1=new Date(fi+'T00:00:00');
  const getD=x=>parseDateStr(((x['Fecha']||'').toString()).split(' ')[0]);
  const e=(window._cajEnt||[]).filter(x=>{const d=getD(x);return d&&d<d1;}).reduce((s,x)=>s+parseFloat(x['Monto ($)']||0),0);
  const g=(window._cajGas||[]).filter(x=>{const d=getD(x);return d&&d<d1&&x['Estado']==='Aprobado';}).reduce((s,x)=>s+parseFloat(x['Monto ($)']||0),0);
  return Math.round((e-g)*100)/100;
}

function _pdfSafe(s){
  return String(s)
    .replace(/\u2192/g,' > ')
    .replace(/\s*>\s*/g,' > ')
    .replace(/\u2713/g,'OK')
    .replace(/\u26A0/g,'!')
    .replace(/\u25CF/g,'\u00B7')
    .replace(/\uD83D\uDCC1/g,'');
}

  var pub = { init: cajaInit, mapsReady: mapsReady, openMod: cajaOpenMod, goHome: cajaGoHome };
  try{ if(typeof _pdfCheckPage==='function'){ pub._pdfCheckPage=_pdfCheckPage; if('_pdfCheckPage'!=='openMod'&&'_pdfCheckPage'!=='goHome') global._pdfCheckPage=_pdfCheckPage; } }catch(e){}
  try{ if(typeof _pdfHeader==='function'){ pub._pdfHeader=_pdfHeader; if('_pdfHeader'!=='openMod'&&'_pdfHeader'!=='goHome') global._pdfHeader=_pdfHeader; } }catch(e){}
  try{ if(typeof _pdfLinea==='function'){ pub._pdfLinea=_pdfLinea; if('_pdfLinea'!=='openMod'&&'_pdfLinea'!=='goHome') global._pdfLinea=_pdfLinea; } }catch(e){}
  try{ if(typeof _pdfSafe==='function'){ pub._pdfSafe=_pdfSafe; if('_pdfSafe'!=='openMod'&&'_pdfSafe'!=='goHome') global._pdfSafe=_pdfSafe; } }catch(e){}
  try{ if(typeof addParada==='function'){ pub.addParada=addParada; if('addParada'!=='openMod'&&'addParada'!=='goHome') global.addParada=addParada; } }catch(e){}
  try{ if(typeof applyDateFiltro==='function'){ pub.applyDateFiltro=applyDateFiltro; if('applyDateFiltro'!=='openMod'&&'applyDateFiltro'!=='goHome') global.applyDateFiltro=applyDateFiltro; } }catch(e){}
  try{ if(typeof aprG==='function'){ pub.aprG=aprG; if('aprG'!=='openMod'&&'aprG'!=='goHome') global.aprG=aprG; } }catch(e){}
  try{ if(typeof aprobarTodo==='function'){ pub.aprobarTodo=aprobarTodo; if('aprobarTodo'!=='openMod'&&'aprobarTodo'!=='goHome') global.aprobarTodo=aprobarTodo; } }catch(e){}
  try{ if(typeof aprobarTodosGastos==='function'){ pub.aprobarTodosGastos=aprobarTodosGastos; if('aprobarTodosGastos'!=='openMod'&&'aprobarTodosGastos'!=='goHome') global.aprobarTodosGastos=aprobarTodosGastos; } }catch(e){}
  try{ if(typeof badgeClass==='function'){ pub.badgeClass=badgeClass; if('badgeClass'!=='openMod'&&'badgeClass'!=='goHome') global.badgeClass=badgeClass; } }catch(e){}
  try{ if(typeof cApply==='function'){ pub.cApply=cApply; if('cApply'!=='openMod'&&'cApply'!=='goHome') global.cApply=cApply; } }catch(e){}
  try{ if(typeof cSetFiltro==='function'){ pub.cSetFiltro=cSetFiltro; if('cSetFiltro'!=='openMod'&&'cSetFiltro'!=='goHome') global.cSetFiltro=cSetFiltro; } }catch(e){}
  try{ if(typeof cajApply==='function'){ pub.cajApply=cajApply; if('cajApply'!=='openMod'&&'cajApply'!=='goHome') global.cajApply=cajApply; } }catch(e){}
  try{ if(typeof cajRenderList==='function'){ pub.cajRenderList=cajRenderList; if('cajRenderList'!=='openMod'&&'cajRenderList'!=='goHome') global.cajRenderList=cajRenderList; } }catch(e){}
  try{ if(typeof cajSetFiltro==='function'){ pub.cajSetFiltro=cajSetFiltro; if('cajSetFiltro'!=='openMod'&&'cajSetFiltro'!=='goHome') global.cajSetFiltro=cajSetFiltro; } }catch(e){}
  try{ if(typeof cajSetTab==='function'){ pub.cajSetTab=cajSetTab; if('cajSetTab'!=='openMod'&&'cajSetTab'!=='goHome') global.cajSetTab=cajSetTab; } }catch(e){}
  try{ if(typeof cajaGoHome==='function'){ pub.cajaGoHome=cajaGoHome; if('cajaGoHome'!=='openMod'&&'cajaGoHome'!=='goHome') global.cajaGoHome=cajaGoHome; } }catch(e){}
  try{ if(typeof cajaOpenMod==='function'){ pub.cajaOpenMod=cajaOpenMod; if('cajaOpenMod'!=='openMod'&&'cajaOpenMod'!=='goHome') global.cajaOpenMod=cajaOpenMod; } }catch(e){}
  try{ if(typeof calcRoute==='function'){ pub.calcRoute=calcRoute; if('calcRoute'!=='openMod'&&'calcRoute'!=='goHome') global.calcRoute=calcRoute; } }catch(e){}
  try{ if(typeof cerrarCorte==='function'){ pub.cerrarCorte=cerrarCorte; if('cerrarCorte'!=='openMod'&&'cerrarCorte'!=='goHome') global.cerrarCorte=cerrarCorte; } }catch(e){}
  try{ if(typeof comprimirImagen==='function'){ pub.comprimirImagen=comprimirImagen; if('comprimirImagen'!=='openMod'&&'comprimirImagen'!=='goHome') global.comprimirImagen=comprimirImagen; } }catch(e){}
  try{ if(typeof corApply==='function'){ pub.corApply=corApply; if('corApply'!=='openMod'&&'corApply'!=='goHome') global.corApply=corApply; } }catch(e){}
  try{ if(typeof corSetFiltro==='function'){ pub.corSetFiltro=corSetFiltro; if('corSetFiltro'!=='openMod'&&'corSetFiltro'!=='goHome') global.corSetFiltro=corSetFiltro; } }catch(e){}
  try{ if(typeof delFav==='function'){ pub.delFav=delFav; if('delFav'!=='openMod'&&'delFav'!=='goHome') global.delFav=delFav; } }catch(e){}
  try{ if(typeof delParada==='function'){ pub.delParada=delParada; if('delParada'!=='openMod'&&'delParada'!=='goHome') global.delParada=delParada; } }catch(e){}
  try{ if(typeof descargarCajaPDF==='function'){ pub.descargarCajaPDF=descargarCajaPDF; if('descargarCajaPDF'!=='openMod'&&'descargarCajaPDF'!=='goHome') global.descargarCajaPDF=descargarCajaPDF; } }catch(e){}
  try{ if(typeof descargarCortePDF==='function'){ pub.descargarCortePDF=descargarCortePDF; if('descargarCortePDF'!=='openMod'&&'descargarCortePDF'!=='goHome') global.descargarCortePDF=descargarCortePDF; } }catch(e){}
  try{ if(typeof doApprove==='function'){ pub.doApprove=doApprove; if('doApprove'!=='openMod'&&'doApprove'!=='goHome') global.doApprove=doApprove; } }catch(e){}
  try{ if(typeof doReject==='function'){ pub.doReject=doReject; if('doReject'!=='openMod'&&'doReject'!=='goHome') global.doReject=doReject; } }catch(e){}
  try{ if(typeof editPrecio==='function'){ pub.editPrecio=editPrecio; if('editPrecio'!=='openMod'&&'editPrecio'!=='goHome') global.editPrecio=editPrecio; } }catch(e){}
  try{ if(typeof editRuta==='function'){ pub.editRuta=editRuta; if('editRuta'!=='openMod'&&'editRuta'!=='goHome') global.editRuta=editRuta; } }catch(e){}
  try{ if(typeof empty==='function'){ pub.empty=empty; if('empty'!=='openMod'&&'empty'!=='goHome') global.empty=empty; } }catch(e){}
  try{ if(typeof entregasH==='function'){ pub.entregasH=entregasH; if('entregasH'!=='openMod'&&'entregasH'!=='goHome') global.entregasH=entregasH; } }catch(e){}
  try{ if(typeof enviarEntrega==='function'){ pub.enviarEntrega=enviarEntrega; if('enviarEntrega'!=='openMod'&&'enviarEntrega'!=='goHome') global.enviarEntrega=enviarEntrega; } }catch(e){}
  try{ if(typeof enviarGasto==='function'){ pub.enviarGasto=enviarGasto; if('enviarGasto'!=='openMod'&&'enviarGasto'!=='goHome') global.enviarGasto=enviarGasto; } }catch(e){}
  try{ if(typeof enviarRuta==='function'){ pub.enviarRuta=enviarRuta; if('enviarRuta'!=='openMod'&&'enviarRuta'!=='goHome') global.enviarRuta=enviarRuta; } }catch(e){}
  try{ if(typeof errMsg==='function'){ pub.errMsg=errMsg; if('errMsg'!=='openMod'&&'errMsg'!=='goHome') global.errMsg=errMsg; } }catch(e){}
  try{ if(typeof fabGo==='function'){ pub.fabGo=fabGo; if('fabGo'!=='openMod'&&'fabGo'!=='goHome') global.fabGo=fabGo; } }catch(e){}
  try{ if(typeof fd==='function'){ pub.fd=fd; if('fd'!=='openMod'&&'fd'!=='goHome') global.fd=fd; } }catch(e){}
  try{ if(typeof filtDateBtns==='function'){ pub.filtDateBtns=filtDateBtns; if('filtDateBtns'!=='openMod'&&'filtDateBtns'!=='goHome') global.filtDateBtns=filtDateBtns; } }catch(e){}
  try{ if(typeof filtG==='function'){ pub.filtG=filtG; if('filtG'!=='openMod'&&'filtG'!=='goHome') global.filtG=filtG; } }catch(e){}
  try{ if(typeof filtMR==='function'){ pub.filtMR=filtMR; if('filtMR'!=='openMod'&&'filtMR'!=='goHome') global.filtMR=filtMR; } }catch(e){}
  try{ if(typeof filterByDate==='function'){ pub.filterByDate=filterByDate; if('filterByDate'!=='openMod'&&'filterByDate'!=='goHome') global.filterByDate=filterByDate; } }catch(e){}
  try{ if(typeof gastoH==='function'){ pub.gastoH=gastoH; if('gastoH'!=='openMod'&&'gastoH'!=='goHome') global.gastoH=gastoH; } }catch(e){}
  try{ if(typeof getPeriodoDates==='function'){ pub.getPeriodoDates=getPeriodoDates; if('getPeriodoDates'!=='openMod'&&'getPeriodoDates'!=='goHome') global.getPeriodoDates=getPeriodoDates; } }catch(e){}
  try{ if(typeof getSemanaAnteriorDates==='function'){ pub.getSemanaAnteriorDates=getSemanaAnteriorDates; if('getSemanaAnteriorDates'!=='openMod'&&'getSemanaAnteriorDates'!=='goHome') global.getSemanaAnteriorDates=getSemanaAnteriorDates; } }catch(e){}
  try{ if(typeof guardarFav==='function'){ pub.guardarFav=guardarFav; if('guardarFav'!=='openMod'&&'guardarFav'!=='goHome') global.guardarFav=guardarFav; } }catch(e){}
  try{ if(typeof hApply==='function'){ pub.hApply=hApply; if('hApply'!=='openMod'&&'hApply'!=='goHome') global.hApply=hApply; } }catch(e){}
  try{ if(typeof hRender==='function'){ pub.hRender=hRender; if('hRender'!=='openMod'&&'hRender'!=='goHome') global.hRender=hRender; } }catch(e){}
  try{ if(typeof hSetEstado==='function'){ pub.hSetEstado=hSetEstado; if('hSetEstado'!=='openMod'&&'hSetEstado'!=='goHome') global.hSetEstado=hSetEstado; } }catch(e){}
  try{ if(typeof hSetFiltro==='function'){ pub.hSetFiltro=hSetFiltro; if('hSetFiltro'!=='openMod'&&'hSetFiltro'!=='goHome') global.hSetFiltro=hSetFiltro; } }catch(e){}
  try{ if(typeof handleFoto==='function'){ pub.handleFoto=handleFoto; if('handleFoto'!=='openMod'&&'handleFoto'!=='goHome') global.handleFoto=handleFoto; } }catch(e){}
  try{ if(typeof hide==='function'){ pub.hide=hide; if('hide'!=='openMod'&&'hide'!=='goHome') global.hide=hide; } }catch(e){}
  try{ if(typeof hideAll==='function'){ pub.hideAll=hideAll; if('hideAll'!=='openMod'&&'hideAll'!=='goHome') global.hideAll=hideAll; } }catch(e){}
  try{ if(typeof initMap==='function'){ pub.initMap=initMap; if('initMap'!=='openMod'&&'initMap'!=='goHome') global.initMap=initMap; } }catch(e){}
  try{ if(typeof listaPeriodos==='function'){ pub.listaPeriodos=listaPeriodos; if('listaPeriodos'!=='openMod'&&'listaPeriodos'!=='goHome') global.listaPeriodos=listaPeriodos; } }catch(e){}
  try{ if(typeof loadJsPDF==='function'){ pub.loadJsPDF=loadJsPDF; if('loadJsPDF'!=='openMod'&&'loadJsPDF'!=='goHome') global.loadJsPDF=loadJsPDF; } }catch(e){}
  try{ if(typeof mostrarExcepcion==='function'){ pub.mostrarExcepcion=mostrarExcepcion; if('mostrarExcepcion'!=='openMod'&&'mostrarExcepcion'!=='goHome') global.mostrarExcepcion=mostrarExcepcion; } }catch(e){}
  try{ if(typeof parseDateStr==='function'){ pub.parseDateStr=parseDateStr; if('parseDateStr'!=='openMod'&&'parseDateStr'!=='goHome') global.parseDateStr=parseDateStr; } }catch(e){}
  try{ if(typeof periodLabel==='function'){ pub.periodLabel=periodLabel; if('periodLabel'!=='openMod'&&'periodLabel'!=='goHome') global.periodLabel=periodLabel; } }catch(e){}
  try{ if(typeof placeAddr==='function'){ pub.placeAddr=placeAddr; if('placeAddr'!=='openMod'&&'placeAddr'!=='goHome') global.placeAddr=placeAddr; } }catch(e){}
  try{ if(typeof placeName==='function'){ pub.placeName=placeName; if('placeName'!=='openMod'&&'placeName'!=='goHome') global.placeName=placeName; } }catch(e){}
  try{ if(typeof rejG==='function'){ pub.rejG=rejG; if('rejG'!=='openMod'&&'rejG'!=='goHome') global.rejG=rejG; } }catch(e){}
  try{ if(typeof renderCorte==='function'){ pub.renderCorte=renderCorte; if('renderCorte'!=='openMod'&&'renderCorte'!=='goHome') global.renderCorte=renderCorte; } }catch(e){}
  try{ if(typeof renderCuenta==='function'){ pub.renderCuenta=renderCuenta; if('renderCuenta'!=='openMod'&&'renderCuenta'!=='goHome') global.renderCuenta=renderCuenta; } }catch(e){}
  try{ if(typeof renderHistCaja==='function'){ pub.renderHistCaja=renderHistCaja; if('renderHistCaja'!=='openMod'&&'renderHistCaja'!=='goHome') global.renderHistCaja=renderHistCaja; } }catch(e){}
  try{ if(typeof renderHistorial==='function'){ pub.renderHistorial=renderHistorial; if('renderHistorial'!=='openMod'&&'renderHistorial'!=='goHome') global.renderHistorial=renderHistorial; } }catch(e){}
  try{ if(typeof renderNav==='function'){ pub.renderNav=renderNav; if('renderNav'!=='openMod'&&'renderNav'!=='goHome') global.renderNav=renderNav; } }catch(e){}
  try{ if(typeof renderNuevaEntrega==='function'){ pub.renderNuevaEntrega=renderNuevaEntrega; if('renderNuevaEntrega'!=='openMod'&&'renderNuevaEntrega'!=='goHome') global.renderNuevaEntrega=renderNuevaEntrega; } }catch(e){}
  try{ if(typeof rutaTicket==='function'){ pub.rutaTicket=rutaTicket; if('rutaTicket'!=='openMod'&&'rutaTicket'!=='goHome') global.rutaTicket=rutaTicket; } }catch(e){}
  try{ if(typeof saldoAnterior==='function'){ pub.saldoAnterior=saldoAnterior; if('saldoAnterior'!=='openMod'&&'saldoAnterior'!=='goHome') global.saldoAnterior=saldoAnterior; } }catch(e){}
  try{ if(typeof saldoCajaPeriodo==='function'){ pub.saldoCajaPeriodo=saldoCajaPeriodo; if('saldoCajaPeriodo'!=='openMod'&&'saldoCajaPeriodo'!=='goHome') global.saldoCajaPeriodo=saldoCajaPeriodo; } }catch(e){}
  try{ if(typeof cajaCallScript==='function'){ pub.cajaCallScript=cajaCallScript; if('cajaCallScript'!=='openMod'&&'cajaCallScript'!=='goHome') global.cajaCallScript=cajaCallScript; } }catch(e){}
  try{ if(typeof saveEditRuta==='function'){ pub.saveEditRuta=saveEditRuta; if('saveEditRuta'!=='openMod'&&'saveEditRuta'!=='goHome') global.saveEditRuta=saveEditRuta; } }catch(e){}
  try{ if(typeof setView==='function'){ pub.setView=setView; if('setView'!=='openMod'&&'setView'!=='goHome') global.setView=setView; } }catch(e){}
  try{ if(typeof show==='function'){ pub.show=show; if('show'!=='openMod'&&'show'!=='goHome') global.show=show; } }catch(e){}
  try{ if(typeof spin==='function'){ pub.spin=spin; if('spin'!=='openMod'&&'spin'!=='goHome') global.spin=spin; } }catch(e){}
  try{ if(typeof toast==='function'){ pub.toast=toast; if('toast'!=='openMod'&&'toast'!=='goHome') global.toast=toast; } }catch(e){}
  try{ if(typeof today==='function'){ pub.today=today; if('today'!=='openMod'&&'today'!=='goHome') global.today=today; } }catch(e){}
  try{ if(typeof toggleFab==='function'){ pub.toggleFab=toggleFab; if('toggleFab'!=='openMod'&&'toggleFab'!=='goHome') global.toggleFab=toggleFab; } }catch(e){}
  try{ if(typeof togglePF==='function'){ pub.togglePF=togglePF; if('togglePF'!=='openMod'&&'togglePF'!=='goHome') global.togglePF=togglePF; } }catch(e){}
  try{ if(typeof updVehPrice==='function'){ pub.updVehPrice=updVehPrice; if('updVehPrice'!=='openMod'&&'updVehPrice'!=='goHome') global.updVehPrice=updVehPrice; } }catch(e){}
  try{ if(typeof usarFav==='function'){ pub.usarFav=usarFav; if('usarFav'!=='openMod'&&'usarFav'!=='goHome') global.usarFav=usarFav; } }catch(e){}
  try{ if(typeof usarGPS==='function'){ pub.usarGPS=usarGPS; if('usarGPS'!=='openMod'&&'usarGPS'!=='goHome') global.usarGPS=usarGPS; } }catch(e){}
  try{ if(typeof vNueva==='function'){ pub.vNueva=vNueva; if('vNueva'!=='openMod'&&'vNueva'!=='goHome') global.vNueva=vNueva; } }catch(e){}
  try{ if(typeof vNuevaEntrega==='function'){ pub.vNuevaEntrega=vNuevaEntrega; if('vNuevaEntrega'!=='openMod'&&'vNuevaEntrega'!=='goHome') global.vNuevaEntrega=vNuevaEntrega; } }catch(e){}
  try{ if(typeof vNuevoGasto==='function'){ pub.vNuevoGasto=vNuevoGasto; if('vNuevoGasto'!=='openMod'&&'vNuevoGasto'!=='goHome') global.vNuevoGasto=vNuevoGasto; } }catch(e){}
  global.Caja = pub;
  global.cajaOpenMod = cajaOpenMod;
  global.cajaGoHome = cajaGoHome;
  global.cajaLeaveToAdmin = cajaLeaveToAdmin;
  global.cajaMapsReady = cajaMapsReady;
  global.mapsReady = mapsReady;
})(window);
