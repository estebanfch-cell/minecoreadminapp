/**
 * Ficha de producto: bodega, costo a 2 decimales y escalas que caben. 320–430 y escritorio.
 *   node tests/ficha-bodega.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
if (!html.includes("var MC_BUILD='599'")) throw new Error('build');
if (!sw.includes("var SWV='b599'")) throw new Error('sw');
const css = html.slice(html.indexOf('.stk2-l{'), html.indexOf('#maes-screen #pf2-host'));
const ms = html.slice(html.indexOf('<style id="ms-b339">'), html.indexOf('</style>', html.indexOf('<style id="ms-b339">')) + 8);
let iife = html.slice(html.indexOf('/* ===== b276: Maestros'), html.indexOf("</script>\n<script>/* b276: Banco"));
if (!iife.trim().endsWith('})();')) throw new Error('corte');
iife = iife.replace(/\}\)\(\);\s*$/, 'window.__t={pf:function(){return PF;},precios:preciosHtml};})();');

function page(w){
  return `<!doctype html><meta charset="utf-8"><title>ficha</title>
<style>html,body{width:${w}px;max-width:${w}px;margin:0;background:#0b1520;color:#e8eef5;font:14px -apple-system,sans-serif}
#maes-screen{width:${w}px;max-width:${w}px;box-sizing:border-box;overflow:hidden}
.chip{border:1px solid #3a5878;border-radius:8px;padding:6px 10px;background:#111a26;color:#e8eef6}
#result{padding:8px;color:#b7f34a;font-size:12px}
</style>
${ms}
<style>${css}</style>
<div id="maes-screen"></div><div id="result"></div>
<script>
function getUserName(){return 'EFCH';}function getPin(){return '1';}
function MCpost(){return Promise.resolve({ok:true,bodegas:[],motivos:[]});}
function MCcan(){return true;}
function mcCfP(k,d){return d;}function mcRound(n){return Math.round(n*100)/100;}
function mcRoV(){return false;}function MCRO(){return false;}function mcEsCliV(){return false;}
function MCth(s){return s;}function toast(){}function MCerr(e){return String(e&&e.message||e);}
window.MCroute={set:function(){}};
${iife}
function mal(s){document.getElementById('result').textContent='FAIL '+s;document.title='FAIL';}
var PF=__t.pf();
PF.stkO={bodegas:[{id:'cons',name:'CONSIGNACIÓN'}],motivos:[]};
PF.cur={producto:{id:'p1',sku:'MCOR000458',unit_cost:214.7668},
  stock:[{location_id:'bp',bodega:'BODEGA PRINCIPAL',sublocation:'7-C-2',q:0},{location_id:'bp',bodega:'BODEGA PRINCIPAL',sublocation:'5-C-3',q:3}],
  sub_defaults:[{location_id:'bp',bodega:'BODEGA PRINCIPAL',sub:'7-C-2'}],
  subs_bod:{bp:['8-A-1']},
  precios:[{name:'PVP 50%',is_default:true,markup:50,precio:322.15},{name:'COSTO',markup:0,precio:214.77},{name:'PVP 25%',markup:25,precio:268.46}],
  costos_hist:[{at:'2026-11-01T10:00:00',anterior:200.1,costo:214.7668,source:'manual',actor:'EFCH'}]};
var box=document.getElementById('maes-screen');
box.innerHTML=MCStk2.html()+__t.precios(PF.cur,PF.cur.producto);
document.querySelector('details').open=true;
var borde=box.getBoundingClientRect().right;
var hl=document.querySelector('.stk2-hl'),hu=document.querySelector('.stk2-hu'),hb=hl.querySelector('b'),sub=document.querySelector('.stk2-ht .ms-sub');
if(hu.textContent!=='3 u')mal('total '+hu.textContent);
else if(hu.getClientRects().length!==1)mal('u partido');
else if(hu.getBoundingClientRect().right>borde+1)mal('total fuera '+Math.round(hu.getBoundingClientRect().right));
else if(hb.getBoundingClientRect().top>hu.getBoundingClientRect().top+4)mal('nombre abajo');
else if(sub.getBoundingClientRect().top<hl.getBoundingClientRect().bottom-2)mal('secundaria');
else if(sub.textContent.indexOf('2 sububicaciones · predeterminada 7-C-2')<0)mal('linea');
else {
  var qs=[].slice.call(document.querySelectorAll('.stk2-q')).filter(function(q){return q.textContent.trim()||q.querySelector('input');});
  var rights=qs.map(function(q){return Math.round(q.getBoundingClientRect().right);});
  if(rights.some(function(r){return Math.abs(r-rights[0])>2||r>borde;}))mal('cantidades '+rights.join(','));
  else {
    var cv=document.querySelector('.pf-costo-v');
    if(!cv||cv.textContent!=='$214.77')mal('costo '+(cv&&cv.textContent));
    else if((cv.getAttribute('title')||'').indexOf('214.7668')<0)mal('tooltip');
    else if(document.querySelector('.pf-costo .chip').getBoundingClientRect().left<cv.getBoundingClientRect().right-1)mal('boton pisa');
    else if(box.scrollWidth>box.clientWidth+2)mal('scroll '+box.scrollWidth);
    else {
      var cards=document.querySelectorAll('.pf-esc-c');
      var tabla=document.querySelector('table.pf-esc');
      document.documentElement.dataset.iw=String(window.innerWidth);
      var angosto=window.matchMedia('(max-width:700px)').matches;
      if(angosto){
        if(cards.length<3||getComputedStyle(tabla).display!=='none')mal('tarjetas');
        else if([].some.call(cards,function(c){return c.getBoundingClientRect().right>borde+1;}))mal('tarjeta fuera');
        else if(cards[0].textContent.indexOf('Markup')<0||cards[0].textContent.indexOf('Precio')<0)mal('campos');
        else okSin();
      } else {
        if(getComputedStyle(document.querySelector('.pf-esc-cards')).display!=='none')mal('cards en desktop');
        else if(getComputedStyle(tabla).display==='none')mal('tabla oculta');
        else if(tabla.getBoundingClientRect().right>borde+1)mal('tabla fuera');
        else okSin();
      }
    }
  }
}
function okSin(){
  var p={id:'p2',sku:'X'};
  var h=__t.precios({precios:[],costos_hist:[]},p);
  if(h.indexOf('Editar costo')>=0||h.indexOf('pf-costo')>=0||h.indexOf('Precios y costo')<0)return mal('permiso');
  document.getElementById('result').textContent='OK';
  document.title='OK';
}
</script>`;
}

const dir = '/tmp/ficha-bodega';
mkdirSync(dir, { recursive: true });
const chrome = '/usr/local/bin/google-chrome';
for (const w of [320, 375, 390, 430, 1280]) {
  const file = join(dir, 'ui-' + w + '.html');
  writeFileSync(file, page(w));
  const shot = w === 390 ? ['--screenshot=/opt/cursor/artifacts/ficha-bodega-390.png'] : [];
  const run = spawnSync(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=1', '--user-data-dir=/tmp/chrome-ficha-' + w, '--window-size=' + w + ',1100', '--virtual-time-budget=2500', ...shot, '--dump-dom', file], { encoding: 'utf8', timeout: 25000 });
  const dom = (run.stdout || '') + (run.stderr || '');
  if (!dom.includes('>OK<') && !dom.includes('>OK</div>')) {
    const m = dom.match(/id="result"[^>]*>([^<]*)</);
    throw new Error(w + ' ' + (m ? m[1] : 'sin resultado ' + run.status + ' ' + dom.slice(-400)));
  }
  const iw = (dom.match(/data-iw="(\d+)"/) || [])[1];
  console.log(w, 'OK', 'viewport', iw || '?');
}
