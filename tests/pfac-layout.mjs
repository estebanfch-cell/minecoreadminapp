/**
 * b558: el aviso «Por facturar» no solapa ni desborda.
 * Reproduce el caso del iPhone (MCOR-SO-001044-5-2) y añade cliente largo,
 * comentario largo y varias OV. También comprueba que el flex viejo SÍ se monta,
 * para que el test no pase en falso.
 *
 *   node tests/pfac-layout.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const shotDir = process.env.PFAC_SHOTS || '/tmp/pfac-shots';
mkdirSync(shotDir, { recursive: true });

function sliceMark(src, a, b) {
  const i = src.indexOf(a);
  const j = src.indexOf(b);
  if (i < 0 || j < 0 || j <= i) throw new Error('marcador ausente: ' + a);
  return src.slice(i + a.length, j).trim();
}

const css = sliceMark(html, '/* mc-pfac-css-start */', '/* mc-pfac-css-end */');
const render = sliceMark(html, '/* mc-pfac-render-start */', '/* mc-pfac-render-end */');
function extractFn(src, name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) throw new Error('no está ' + name);
  let i = src.indexOf('{', start);
  let d = 0;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(start, k + 1); }
  }
  throw new Error('función sin cierre: ' + name);
}
const mcBD = [extractFn(html, 'mcBD')];

const page = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Por facturar</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#0b1219;color:#dce6f0;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;font-size:14px}
#shell{max-width:640px;margin:0 auto;padding:16px}
@media(min-width:1024px){#shell{max-width:1120px;padding:22px 28px}}
@media(min-width:1500px){#shell{max-width:1280px}}
.cbz-card,.cbz-card-row>*,[style*="display:grid"]>*,[style*="display:flex"]>*{min-width:0}
.cbz-muted{opacity:.6;font-size:12px}
.dash-h{font-size:22px;font-weight:800;letter-spacing:.4px;margin:2px 0 12px}
.dv-tabs{display:flex;background:#0f1720;border-radius:12px;padding:3px;margin:4px 0 12px}
.dv-tabs span{flex:1;text-align:center;color:#8fa3b8;padding:9px 0;border-radius:9px;font-size:13px;font-weight:600}
.dv-tabs span.on{background:#c8e632;color:#0b1219}
#legacy-host{position:absolute;left:0;top:0;width:390px;visibility:hidden;pointer-events:none}
${css}
</style>
<div id="legacy-host"><div id="shell"><div id="legacy"></div></div></div>
<div id="shell">
  <div class="dash-h">DASHBOARD</div>
  <div id="mount"></div>
  <div class="dv-tabs"><span class="on">Hoy</span><span>Semana</span><span>Mes</span><span>Año</span></div>
</div>
<script>
${mcBD[0]}
function mcHoy(){return '2026-11-05';}
function mcM(n){var x=parseFloat(n)||0;return (x<0?'-':'')+'$'+Math.abs(x).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
${render}
var HOY='2026-11-05';
var ORDERS=[
  {id:'a',order_number:'MCOR-SO-001044-5-2',cliente:'KLUANE DRILLING ECUADOR S.A',total:5746.54,nota_facturacion:'FACTURAR 8 DE NOVIEMBRE',facturar_el:'2026-11-08'},
  {id:'b',order_number:'MCOR-SO-009999-1',cliente:'CORPORACION INTERNACIONAL DE PERFORACION Y SERVICIOS MINEROS ANDINOS DEL ECUADOR SOCIEDAD ANONIMA',total:128450.75,nota_facturacion:'FACTURAR SOLO CUANDO LLEGUE EL ACTA FIRMADA DE LA OBRA NORTE Y EL ANTICIPO ESTE CONCILIADO EN EL BANCO PICHINCHA',facturar_el:'2026-11-03'},
  {id:'c',order_number:'MCOR-SO-001200',cliente:'MINERA EXPLORACIONES DEL SUR CÍA. LTDA.',total:890,nota_facturacion:'',facturar_el:'2026-11-05'}
];
function legacyHtml(o){
  var f=String(o.facturar_el).slice(0,10), v=f<=HOY;
  return '<div class="cbz-card" style="margin:0 0 10px;border:2px solid #f5c518;background:#0f1720;border-radius:12px;padding:12px"><b>🧾 Por facturar: 1 OV</b><div style="margin-top:6px;font-size:12px"><div style="display:flex;gap:8px;padding:2px 0"><span style="font-weight:800;color:'+(v?'#e05c5c':'#f5c518')+'">'+f.slice(8,10)+'/'+f.slice(5,7)+(v?'':' (mañana)')+'</span><b>'+o.order_number+'</b><span class="leg-cli cbz-muted" style="flex:1;overflow:visible;text-overflow:clip;white-space:normal">'+o.cliente+' · '+o.nota_facturacion+'</span><span class="leg-amt">'+mcM(o.total)+'</span></div></div></div>';
}
document.getElementById('legacy').innerHTML=legacyHtml(ORDERS[0]);
document.getElementById('mount').innerHTML=mcPfacBoxHtml(ORDERS,{variant:'dash',id:'mc-pfac-card',hoy:HOY,head:'🧾 Por facturar: '+ORDERS.length+' OV'});
function R(el){var r=el.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height};}
function hit(a,b){return Math.min(a.r,b.r)-Math.max(a.l,b.l)>1 && Math.min(a.b,b.b)-Math.max(a.t,b.t)>1;}
function audit(){
  var fail=[];
  var card=document.getElementById('mc-pfac-card');
  if(!card) fail.push('falta la tarjeta');
  if(card && /✕/.test(card.textContent)) fail.push('hay ✕');
  if(card && card.querySelector('button')) fail.push('hay un control');
  var rows=[].slice.call(document.querySelectorAll('#mc-pfac-card .mc-pfac-row'));
  if(rows.length!==3) fail.push('se esperaban 3 OV, hay '+rows.length);
  var narrow=window.innerWidth<700;
  var cr=card?R(card):null;
  if(card && (card.scrollWidth>card.clientWidth+2 || document.documentElement.scrollWidth>window.innerWidth+2))
    fail.push('desborde horizontal de la tarjeta o la página ('+card.scrollWidth+'/'+card.clientWidth+', page '+document.documentElement.scrollWidth+'/'+window.innerWidth+')');
  rows.forEach(function(row,i){
    var o=ORDERS[i];
    var parts=['.mc-pfac-date','.mc-pfac-when','.mc-pfac-ov','.mc-pfac-cli','.mc-pfac-amt'].map(function(s){return row.querySelector(s);});
    var note=row.querySelector('.mc-pfac-note');
    if(o.nota_facturacion){ if(!note) fail.push('falta comentario '+o.order_number); else parts.push(note); }
    else if(note) fail.push('comentario de más '+o.order_number);
    parts.forEach(function(el){
      if(!el){fail.push('falta campo en '+o.order_number);return;}
      var box=R(el);
      if(box.w<8||box.h<8) fail.push('campo vacío '+el.className+' '+o.order_number);
      if(cr && (box.l<cr.l-1||box.r>cr.r+1||box.t<cr.t-1||box.b>cr.b+1)) fail.push('fuera de la tarjeta '+el.className+' '+o.order_number);
      if(el.scrollWidth>el.clientWidth+2||el.scrollHeight>el.clientHeight+2) fail.push('texto cortado '+el.className+' '+o.order_number+' sw='+el.scrollWidth+' cw='+el.clientWidth);
    });
    for(var a=0;a<parts.length;a++)for(var b=a+1;b<parts.length;b++){
      if(parts[a]&&parts[b]&&hit(R(parts[a]),R(parts[b]))) fail.push('solape '+parts[a].className+' × '+parts[b].className+' '+o.order_number);
    }
    var cli=row.querySelector('.mc-pfac-cli');
    var fs=cli?parseFloat(getComputedStyle(cli).fontSize):0;
    if(fs<13) fail.push('letra achicada '+fs+' '+o.order_number);
    if(cli && cli.textContent!==o.cliente) fail.push('cliente incompleto '+o.order_number);
    if(note && note.textContent!==o.nota_facturacion) fail.push('comentario incompleto '+o.order_number);
    var ov=row.querySelector('.mc-pfac-ov');
    if(ov && ov.textContent!==o.order_number) fail.push('OV incompleta '+o.order_number);
    var amt=row.querySelector('.mc-pfac-amt');
    if(amt && amt.textContent!==mcM(o.total)) fail.push('monto '+amt.textContent+' ≠ '+mcM(o.total));
    var expectV=o.facturar_el<=HOY?'1':'0';
    if(row.getAttribute('data-vencida')!==expectV) fail.push('vencida mal marcada '+o.order_number);
    var col=getComputedStyle(row.querySelector('.mc-pfac-date')).color.replace(/\\s/g,'');
    if(expectV==='1' && col!=='rgb(255,107,107)') fail.push('vencida no está en rojo '+col);
    if(expectV==='0' && col!=='rgb(245,197,24)') fail.push('mañana no está en amarillo '+col);
    if(narrow && cli && cr && R(cli).w<cr.w*0.85) fail.push('cliente en columna estrecha '+Math.round(R(cli).w)+'/'+Math.round(cr.w));
    if(!narrow && cli && amt){
      var A=R(amt), C=R(cli);
      if(Math.abs((A.t+A.b)/2-(C.t+C.b)/2)>Math.max(A.h,C.h)) fail.push('en escritorio el monto no queda en la fila del cliente');
    }
  });
  for(var i=0;i<rows.length;i++)for(var j=i+1;j<rows.length;j++){
    if(hit(R(rows[i]),R(rows[j]))) fail.push('filas de OV se montan');
  }
  var legC=document.querySelector('.leg-cli'), legA=document.querySelector('.leg-amt');
  var legacyBug=false;
  if(legC&&legA){
    var lc=R(legC), la=R(legA);
    legacyBug=hit(lc,la)||lc.w<90;
  }
  if(!legacyBug) fail.push('el control del layout viejo no reprodujo el solape; el test no es sensible');
  return {ok:!fail.length,fail:fail,w:window.innerWidth,legacyBug:legacyBug,cardW:cr?Math.round(cr.w):0};
}
window.__audit=audit;
</script>`;

const pagePath = '/tmp/pfac-harness.html';
writeFileSync(pagePath, page);

function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

async function launch(){
  rmSync('/tmp/pfac-chrome-558', { recursive: true, force: true });
  const proc = spawn('google-chrome', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--remote-debugging-port=9333', '--user-data-dir=/tmp/pfac-chrome-558',
    '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'
  ], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9333/json/version');
      if (r.ok) return { proc, info: await r.json() };
    } catch (e) {}
    await sleep(100);
  }
  proc.kill('SIGKILL');
  throw new Error('Chrome no arrancó');
}

function cdp(wsUrl){
  const ws = new WebSocket(wsUrl);
  let n = 0;
  const wait = new Map();
  const opened = new Promise(function(res, rej){ ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  ws.addEventListener('message', function(ev){
    const m = JSON.parse(ev.data);
    if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
  });
  function send(method, params, sessionId){
    const id = ++n;
    const msg = { id, method, params: params || {} };
    if (sessionId) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
    return new Promise(function(res){ wait.set(id, res); });
  }
  return { ws, opened, send };
}

async function runWidth(browserWs, width, height){
  const c = cdp(browserWs);
  await c.opened;
  const created = await c.send('Target.createTarget', { url: 'about:blank' });
  const targetId = created.result.targetId;
  const attached = await c.send('Target.attachToTarget', { targetId, flatten: true });
  const sid = attached.result.sessionId;
  await c.send('Page.enable', {}, sid);
  await c.send('Runtime.enable', {}, sid);
  await c.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 2, mobile: width < 700
  }, sid);
  await c.send('Page.navigate', { url: 'file://' + pagePath }, sid);
  await sleep(400);
  const ev = await c.send('Runtime.evaluate', {
    expression: 'window.__audit ? window.__audit() : {ok:false,fail:["sin __audit"],href:location.href,ready:document.readyState}',
    returnByValue: true
  }, sid);
  if (ev.result && ev.result.exceptionDetails) {
    console.error('EVAL', JSON.stringify(ev.result.exceptionDetails).slice(0, 2000));
  }
  const audit = ev.result && ev.result.result && ev.result.result.value;
  const shot = await c.send('Page.captureScreenshot', { format: 'png' }, sid);
  const name = width < 700 ? 'pfac_390.png' : 'pfac_1280.png';
  writeFileSync(join(shotDir, name), Buffer.from(shot.result.data, 'base64'));
  await c.send('Target.closeTarget', { targetId });
  c.ws.close();
  return audit;
}

const chrome = await launch();
let code = 0;
try {
  for (const w of [390, 1280]) {
    const audit = await runWidth(chrome.info.webSocketDebuggerUrl, w, w < 700 ? 1100 : 820);
    console.log(JSON.stringify(audit));
    if (!audit || !audit.ok) code = 1;
  }
} finally {
  chrome.proc.kill('SIGKILL');
}
process.exit(code);
