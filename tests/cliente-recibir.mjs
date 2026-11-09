/**
 * Portal cliente: aviso y pantalla para recibir su orden, a 390 y escritorio.
 *   node tests/cliente-recibir.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const api = readFileSync(join(root, 'edge-patches/cli-recibir.ts'), 'utf8');
if (!html.includes("var MC_BUILD='626'")) throw new Error('build');
if (!sw.includes("var SWV='b626'")) throw new Error('sw');
if (!html.includes('cli-recibir') || !html.includes('cli.e.recibir')) throw new Error('ui');
if (!api.includes("lower(trim(c.name))=lower(trim(${empresa}))")) throw new Error('org');
if (!api.includes('~cli.e.recibir=1')) throw new Error('switch');
const rec = html.slice(html.indexOf('var MCCliRec='), html.indexOf('var MCRecibidos='));

function page(w) {
  return `<!doctype html><meta charset="utf-8"><title>cli</title>
<style>html,body{margin:0;background:#0b1520;color:#e8eef5;font:14px sans-serif}
#home,#maes-screen,#clir{width:${w}px;max-width:${w}px;box-sizing:border-box}
.cbz-card{border:1px solid #1c2a3a;border-radius:12px;padding:8px;margin:6px 0}
.cbz-btn,.cbz-btn-sec,.chip{border:1px solid #3a5878;border-radius:8px;background:#111a26;color:#e8eef6;min-height:44px}
.uinput{width:100%;box-sizing:border-box;min-height:44px}
#result{color:#b7f34a;padding:8px}</style>
<div id="home"></div><div id="maes-screen"></div><div id="result"></div>
<script>
var posts=[],fotos=[],opened=null,alerts=[];
window.alert=function(m){alerts.push(String(m));};
function mcEsCliV(){return true;}
function MCsbGet(){return {t:'tok'};}
function MCth(u){return u;}
function MCfoto(u,ev){if(ev&&ev.stopPropagation)ev.stopPropagation();fotos.push(u);}
function openMod(m){opened=m;}
function cargarPdfjs(){return Promise.resolve();}
window.pdfjsLib={getDocument:function(){
  var page={getViewport:function(o){var s=(o&&o.scale)||1;return {width:400*s,height:500*s};},render:function(){return {promise:Promise.resolve()};}};
  return {promise:Promise.resolve({numPages:1,getPage:function(){return Promise.resolve(page);}})};
}};
var STORE=[];
window.fetch=function(url,opt){
  var b=JSON.parse(opt.body);
  posts.push(b);
  if(String(url).indexOf('cli-recibir')>=0){
    if(window._OFF)return Promise.resolve({json:function(){return {ok:true,activo:false};}});
    if(b.op==='lista')return Promise.resolve({json:function(){return {ok:true,activo:true,ordenes:[{id:'so-k',order_number:'MCOR-SO-009100',fecha:'2026-11-09'}]};}});
    if(b.op==='marcar')STORE=(b.lineas||[]).slice();
    var L=[{k:'1|MCOR1|0',sku:'MCOR1',nombre:'TUBO INTERNO',cantidad:2,img:'https://example.invalid/tubo.jpg',sub:'10-B-2'},{k:'2|MCOR2|1',sku:'MCOR2',nombre:'BROCA',cantidad:1,img:'',sub:''}];
    var listo=STORE.length===L.length;
    return Promise.resolve({json:function(){return {ok:true,activo:true,id:'so-k',orden:'MCOR-SO-009100',token:'tok-entrega-123456789012345678901234567890123456',lineas:L,marcadas:STORE.slice(),n:2,listo:listo};}});
  }
  if(b.op==='doc')return Promise.resolve({json:function(){return {ok:true,url:'https://example.invalid/ov.pdf',nombre:'Orden.pdf'};}});
  if(b.op==='firmar')return Promise.resolve({json:function(){return {ok:true,pdf:true};}});
  return Promise.reject(new Error('url'));
};
${rec}
function mal(s){document.getElementById('result').textContent='FAIL '+s;document.title='FAIL';}
MCCliRec.aviso();
setTimeout(function(){
  var av=document.getElementById('cli-rec-av');
  if(!av||av.textContent.indexOf('1 orden por recibir')<0)return mal('aviso');
  document.getElementById('cli-rec-ir').click();
  if(opened!=='clirec')return mal('abre');
  MCCliRec.abrir('so-k');
  setTimeout(function(){
    var d=document.getElementById('clir');
    var row=d.querySelector('.chk-row');
    if(!row.querySelector('.chk-foto'))return mal('foto');
    if(row.textContent.indexOf('TUBO INTERNO')<0||row.textContent.indexOf('MCOR1')<0||row.textContent.indexOf('10-B-2')<0)return mal('tarjeta');
    row.querySelector('.chk-foto').click();
    if(!fotos.length||document.getElementById('clir-n').textContent!=='0/2')return mal('zoom');
    var fir=document.getElementById('clir-firmar');
    if(!fir.disabled)return mal('firma abierta');
    d.querySelectorAll('.chk-row')[0].click();
    setTimeout(function(){
      document.querySelectorAll('#clir .chk-row')[1].click();
      if(document.getElementById('clir-firmar').disabled)return mal('firma');
      if(document.getElementById('clir-n').textContent!=='2/2')return mal('contador');
      var box=document.getElementById('clir').getBoundingClientRect();
      var fuera=[].some.call(document.querySelectorAll('#clir .chk-row,#clir-ov,#clir-fac,#clir-firmar'),function(el){var r=el.getBoundingClientRect();return r.right>box.right+1||r.left<box.left-1||r.width<40;});
      if(fuera)return mal('ancho');
      document.getElementById('clir-ov').click();
      setTimeout(function(){
        if(!posts.some(function(p){return p.op==='doc'&&p.tipo==='ov'&&p.token&&p.token.indexOf('tok-entrega')===0;}))return mal('pdf');
        if(!document.querySelector('#clir-pags canvas')&&!document.getElementById('clir-ext'))return mal('visor');
        window._OFF=1;document.getElementById('cli-rec-av').remove();
        MCCliRec.aviso();
        setTimeout(function(){
          if(document.getElementById('cli-rec-av'))return mal('apagado');
          document.getElementById('result').textContent='OK';
          document.title='OK';
        },30);
      },40);
    },20);
  },40);
},30);
</script>`;
}

const dir = '/tmp/cliente-recibir';
mkdirSync(dir, { recursive: true });
mkdirSync('/opt/cursor/artifacts', { recursive: true });
const chrome = '/usr/local/bin/google-chrome';
for (const w of [390, 1280]) {
  const file = join(dir, 'ui-' + w + '.html');
  writeFileSync(file, page(w));
  const run = spawnSync(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--user-data-dir=/tmp/chrome-cli-' + w, '--window-size=' + w + ',900', '--virtual-time-budget=4000', '--screenshot=/opt/cursor/artifacts/cliente-recibir-' + w + '.png', '--dump-dom', file], { encoding: 'utf8', timeout: 20000 });
  const dom = (run.stdout || '') + (run.stderr || '');
  if (!dom.includes('>OK<') && !dom.includes('>OK</div>')) {
    const m = dom.match(/id="result"[^>]*>([^<]*)</);
    throw new Error(w + ' ' + (m ? m[1] : 'sin resultado ' + run.status));
  }
  console.log(w, 'OK');
}
