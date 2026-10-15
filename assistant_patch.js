/* assistant_patch.js — Asistente Minecore (IA) en el portal. Módulo aislado: <script src="assistant_patch.js"></script> antes de </body>.
   Backend: Edge Function asistente-api (token de sesión del portal = MCsbGet/MCsbTok). Escrituras solo con botón Confirmar. */
(function(){
  if(window.MC_ASIS)return; window.MC_ASIS=1;
  var URL_A='https://bklbvwpkrdaojbezljsd.supabase.co/functions/v1/asistente-api';
  var hist=[], busy=false, modelo=localStorage.getItem('mc_asis_modelo')||'auto';
  function tok(){
    try{var s=(typeof MCsbGet==='function')&&MCsbGet(); if(s&&s.t)return Promise.resolve(s.t);}catch(e){}
    if(typeof MCsbTok!=='function')return Promise.reject(new Error('Sin sesión'));
    return MCsbTok().then(function(r){if(r&&r.sbt){try{MCsbSet(r.sbt);}catch(e){}return r.sbt;}throw new Error('Sin sesión');});
  }
  function esc(x){return String(x==null?'':x).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function md(t){ // markdown mínimo: tablas, títulos, negritas, listas
    var L=esc(t).split('\n'),o=[],i=0;
    while(i<L.length){var l=L[i];
      if(/^\|.*\|$/.test(l.trim())&&i+1<L.length&&/^\|[\s:|-]+\|$/.test(L[i+1].trim())){var h=l.trim().slice(1,-1).split('|');var r='<table><tr>'+h.map(function(c){return'<th>'+c.trim()+'</th>';}).join('')+'</tr>';i+=2;
        while(i<L.length&&/^\|.*\|$/.test(L[i].trim())){r+='<tr>'+L[i].trim().slice(1,-1).split('|').map(function(c){return'<td>'+c.trim()+'</td>';}).join('')+'</tr>';i++;}o.push('<div class="mca-tw">'+r+'</table></div>');continue;}
      if(/^#{1,3} /.test(l))l='<b class="mca-h">'+l.replace(/^#+ /,'')+'</b>';
      else if(/^\s*[-*] /.test(l))l='• '+l.replace(/^\s*[-*] /,'');
      o.push(l);i++;}
    return o.join('<br>').replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/(<\/div>|<\/b>)<br>/g,'$1');
  }
  function tabla(x){
    var f=x.filas||[]; if(!f.length)return'';
    var ks=Object.keys(f[0]).filter(function(k){return f.some(function(r){return r[k]!=null&&r[k]!=='';});});
    var fm=function(v){return typeof v==='number'?v.toLocaleString('es-EC',{maximumFractionDigits:2}):esc(v);};
    return '<details class="mca-tbl"'+(f.length<=12?' open':'')+'><summary>'+esc(x.titulo)+' · '+x.n+' fila'+(x.n===1?'':'s')+'</summary><div class="mca-tw"><table><tr>'+ks.map(function(k){return'<th>'+esc(k.replace(/_/g,' '))+'</th>';}).join('')+'</tr>'+
      f.map(function(r){return'<tr>'+ks.map(function(k){return'<td'+(typeof r[k]==='number'?' class="n"':'')+'>'+fm(r[k])+'</td>';}).join('')+'</tr>';}).join('')+'</table></div></details>';
  }
  var css='#mca-btn{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;background:#a3e635;color:#0f1620;border:0;box-shadow:0 4px 16px rgba(0,0,0,.4);font-size:26px;cursor:pointer;z-index:9998}'+
  /* v2 (b338): en móvil el ✦ va ~16px sobre la barra inferior (62px) y respeta el área segura del iPhone */
  '@media(max-width:899px){body.mc-nav #mca-btn{bottom:calc(62px + 16px + env(safe-area-inset-bottom));right:16px;width:52px;height:52px}}'+
  '#mca{position:fixed;top:0;right:0;bottom:0;width:440px;max-width:100vw;background:#121b26;color:#e6edf3;border-left:1px solid #1c2a3a;z-index:9999;display:none;flex-direction:column;font-size:14px}'+
  '#mca.on{display:flex}@media(max-width:700px){#mca{width:100vw;border:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}}'+
  '#mca header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #1c2a3a}#mca header b{color:#a3e635;flex:1}'+
  '#mca select,#mca header button{background:#1c2a3a;color:#e6edf3;border:0;border-radius:8px;padding:6px 8px;font:inherit}'+
  '#mca-log{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}'+
  '.mca-u{align-self:flex-end;background:#1c2a3a;border-radius:14px 14px 4px 14px;padding:8px 12px;max-width:85%}'+
  '.mca-a{align-self:flex-start;max-width:100%;line-height:1.45}.mca-h{color:#a3e635}.mca-meta{color:#8fa3b8;font-size:12px}'+
  '.mca-tw{overflow:auto;max-height:320px;margin:6px 0}#mca table{border-collapse:collapse;font-size:12px}#mca th,#mca td{border-bottom:1px solid #1c2a3a;padding:4px 6px;text-align:left;white-space:nowrap}#mca th{color:#8fa3b8;position:sticky;top:0;background:#121b26}#mca td.n{text-align:right}'+
  '.mca-tbl summary{cursor:pointer;color:#5cc8ff;font-size:12px}'+
  '.mca-card{border:1px solid #f0c040;border-radius:12px;padding:10px;background:#1a2330}.mca-card p{margin:0 0 8px}.mca-card button{border:0;border-radius:18px;padding:7px 16px;margin-right:8px;font:inherit;cursor:pointer}'+
  '.mca-ok{background:#a3e635;color:#0f1620}.mca-no{background:#1c2a3a;color:#e6edf3}'+
  '#mca form{display:flex;gap:6px;padding:10px;border-top:1px solid #1c2a3a}#mca textarea{flex:1;resize:none;background:#1c2a3a;color:#e6edf3;border:0;border-radius:12px;padding:9px 12px;font:inherit;height:42px;max-height:120px}'+
  '#mca form button{background:#a3e635;color:#0f1620;border:0;border-radius:50%;width:42px;height:42px;font-size:18px;cursor:pointer}#mca form button.mic{background:#1c2a3a;color:#e6edf3}#mca form button.mic.rec{background:#e05c5c}';
  var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
  var btn=document.createElement('button');btn.id='mca-btn';btn.title='Asistente Minecore';btn.textContent='✦';
  var P=document.createElement('div');P.id='mca';
  P.innerHTML='<header><b>Asistente Minecore</b><select id="mca-m" title="Modelo"><option value="auto">Auto</option><option value="haiku">Haiku (rápido)</option><option value="sonnet">Sonnet</option><option value="opus">Opus (análisis)</option></select><button id="mca-new" title="Nueva conversación">↺</button><button id="mca-x" title="Cerrar">✕</button></header>'+
    '<div id="mca-log"><div class="mca-a mca-meta">Pregúntame por órdenes, stock, clientes, CxC/CxP, reportes o fallos. Puedo proponer acciones (despachar, solicitar factura, crear cotización); nada se ejecuta sin que toques Confirmar.</div></div>'+
    '<form><button type="button" class="mic" title="Dictar">🎤</button><textarea placeholder="Escribe tu pregunta…"></textarea><button type="submit" title="Enviar">➤</button></form>';
  function mount(){document.body.appendChild(btn);document.body.appendChild(P);}
  if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount);
  var log=P.querySelector('#mca-log'),ta=P.querySelector('textarea'),sel=P.querySelector('#mca-m'),mic=P.querySelector('.mic');
  sel.value=modelo;
  btn.onclick=function(){P.classList.add('on');btn.style.display='none';ta.focus();
    tok().then(function(t){return fetch(URL_A,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'prefs',t:t})});}).then(function(r){return r.json();}).then(function(r){if(r&&r.ok){modelo=r.modelo;sel.value=modelo;localStorage.setItem('mc_asis_modelo',modelo);}}).catch(function(){});};
  P.querySelector('#mca-x').onclick=function(){P.classList.remove('on');btn.style.display='';};
  P.querySelector('#mca-new').onclick=function(){hist=[];log.innerHTML='';};
  sel.onchange=function(){modelo=sel.value;localStorage.setItem('mc_asis_modelo',modelo);tok().then(function(t){fetch(URL_A,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'prefs',t:t,modelo:modelo})});});};
  function add(cls,html){var d=document.createElement('div');d.className=cls;d.innerHTML=html;log.appendChild(d);log.scrollTop=log.scrollHeight;return d;}
  function card(a){
    var d=add('mca-card','<p>⚠️ <b>Acción propuesta</b><br>'+esc(a.resumen)+'</p><button class="mca-ok">Confirmar</button><button class="mca-no">Cancelar</button>');
    var go=function(cancel){d.querySelectorAll('button').forEach(function(b){b.disabled=true;});d.lastElementChild.insertAdjacentHTML('afterend','<div class="mca-meta">'+(cancel?'Cancelando…':'Ejecutando…')+'</div>');
      tok().then(function(t){return fetch(URL_A,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'confirmar',t:t,id:a.id,cancelar:!!cancel})});}).then(function(r){return r.json();})
      .then(function(r){var m=d.querySelector('.mca-meta');m.textContent=cancel?'Cancelada.':(r.ok?'✅ Hecho.':'❌ '+(r.error||'Error'));
        hist.push({role:'user',text:'(Sistema) Acción '+a.tipo+' '+(cancel?'cancelada por el usuario':(r.ok?'ejecutada con éxito':'falló: '+(r.error||'')))});
        if(r.ok&&!cancel){try{window.dispatchEvent(new Event('mc-stock'));}catch(e){}}})
      .catch(function(e){d.querySelector('.mca-meta').textContent='❌ '+e.message;});};
    d.querySelector('.mca-ok').onclick=function(){go(false);};d.querySelector('.mca-no').onclick=function(){go(true);};
  }
  function send(q){
    if(busy||!q.trim())return; busy=true; add('mca-u',esc(q)); ta.value='';
    var a=add('mca-a','<span class="mca-meta">Pensando…</span>'),txt='',meta='',blocks=[];
    var draw=function(){a.innerHTML=(meta?'<div class="mca-meta">'+meta+'</div>':'')+blocks.join('')+md(txt);log.scrollTop=log.scrollHeight;};
    tok().then(function(t){return fetch(URL_A,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'chat',t:t,mensaje:q,modelo:modelo,historial:hist})});})
    .then(function(r){
      if(r.status===401){try{MCsbSet(null);}catch(e){}throw new Error('Sesión vencida, vuelve a intentar');}
      if(!r.body||!/event-stream/.test(r.headers.get('content-type')||''))return r.json().then(function(j){throw new Error(j.error||('HTTP '+r.status));});
      var rd=r.body.getReader(),dec=new TextDecoder(),buf='';
      var pump=function(){return rd.read().then(function(x){if(x.done)return;buf+=dec.decode(x.value,{stream:true});var i;
        while((i=buf.indexOf('\n\n'))>=0){var ev=buf.slice(0,i);buf=buf.slice(i+2);if(ev.indexOf('data: ')!==0)continue;var e=JSON.parse(ev.slice(6));
          if(e.t==='text')txt+=e.d;
          else if(e.t==='modelo')meta=(e.auto?'Auto → ':'')+e.d+(e.escalado?' (escalado)':'');
          else if(e.t==='tool')meta=meta.replace(/ · consultando.*$/,'')+' · consultando '+e.d.replace(/_/g,' ')+'…';
          else if(e.t==='table'){blocks.push(tabla(e));}
          else if(e.t==='accion'){draw();card(e);a=add('mca-a','');blocks=[];txt0=txt;}
          else if(e.t==='error'){txt+='\n\n❌ '+e.d;}
          else if(e.t==='done')meta=meta.replace(/ · consultando.*$/,'');
          draw();}
        return pump();});};
      var txt0='';return pump();})
    .catch(function(e){txt+='\n\n❌ '+e.message;draw();})
    .then(function(){busy=false;hist.push({role:'user',text:q});hist.push({role:'assistant',text:txt.slice(0,3000)||'(sin texto)'});hist=hist.slice(-12);});
  }
  P.querySelector('form').onsubmit=function(e){e.preventDefault();send(ta.value);};
  ta.onkeydown=function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send(ta.value);}};
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition,rec=null;
  if(!SR)mic.style.display='none';
  mic.onclick=function(){if(rec){rec.stop();return;}rec=new SR();rec.lang='es-EC';rec.interimResults=true;mic.classList.add('rec');
    rec.onresult=function(e){var s='';for(var i=0;i<e.results.length;i++)s+=e.results[i][0].transcript;ta.value=s;};
    rec.onend=function(){mic.classList.remove('rec');rec=null;if(ta.value.trim())send(ta.value);};rec.start();};
})();
