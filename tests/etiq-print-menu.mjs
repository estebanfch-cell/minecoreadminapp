/**
 * El menú Print cabe en el teléfono. No abre el portal ni imprime.
 *   node tests/etiq-print-menu.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const start = html.indexOf('function anclarPrint(');
const end = html.indexOf('function printMenu(');
if (start < 0 || end < start) throw new Error('falta anclarPrint');
const fn = html.slice(start, end);
if (!fn.includes("position='fixed'") && !fn.includes('position=\'fixed\'')) throw new Error('el menú no se fija a la pantalla');
if (!html.includes("MC_BUILD='626'")) throw new Error('build');
if (html.includes('right:0;left:auto;min-width:240px')) throw new Error('sigue el anclaje que se sale');

const items = ['Orden de venta', 'Recibo', 'Lista de preparación', 'Packing list', 'Box label', 'Box content list', 'Factura', 'Labels (DYMO 19×51 mm)', 'Imprimir etiquetas remotas'];
const page = `<!doctype html><meta charset="utf-8"><title>print</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0b1622;color:#dce6f0;font-family:-apple-system,sans-serif}
.row{display:flex;flex-wrap:wrap;gap:6px;padding:10px 8px}
.chip{background:#12202d;color:#dce6f0;border:1px solid #2a3d52;border-radius:12px;padding:8px 12px;font-size:14px}
#vt-print{display:none;background:#13202e;border:1px solid #26405c;border-radius:10px;padding:4px}
#vt-print .chip{display:block;margin:2px 0;border:none;text-align:left;white-space:normal;overflow-wrap:anywhere;width:100%}
#result{position:absolute;left:-9999px}
</style>
<div class="row" id="bar">
<button class="chip">Fulfill</button>
<button class="chip">Dividir orden</button>
<button class="chip">Duplicar</button>
<span style="position:relative;display:inline-block"><button class="chip" id="print">🖨 Print ▾</button>
<div id="vt-print">${items.map((t) => '<div class="chip" data-k="' + t + '">' + t + '</div>').join('')}</div></span>
<button class="chip">Cancelar</button>
</div>
<div id="result"></div>
<script>
${fn}
var m=document.getElementById('vt-print');
var bar=document.getElementById('bar');
var bad=[];
var picked='';
function abierto(){m.style.display='block';anclarPrint(m);}
function revisar(tag){
  var r=m.getBoundingClientRect();
  var vw=document.documentElement.clientWidth, vh=document.documentElement.clientHeight;
  if(r.left<-1||r.right>vw+1||r.top<-1||r.bottom>vh+1) bad.push(tag+' menu '+Math.round(r.left)+'..'+Math.round(r.right)+'/'+vw);
  [].forEach.call(m.children,function(c){
    var cr=c.getBoundingClientRect();
    if(cr.left<-1||cr.right>vw+1) bad.push(tag+' fuera '+c.textContent.slice(0,18));
    if(c.scrollWidth>c.clientWidth+2) bad.push(tag+' recorte '+c.textContent.slice(0,18));
    if(!c.textContent.trim()) bad.push(tag+' vacio');
  });
}
['left','right'].forEach(function(side){
  bar.style.justifyContent=side==='right'?'flex-end':'flex-start';
  abierto();
  revisar(side);
  m.style.display='none';
});
abierto();
document.getElementById('print').addEventListener('click',function(){m.style.display=m.style.display==='block'?'none':'block';if(m.style.display==='block')anclarPrint(m);});
document.getElementById('print').click();
if(m.style.display!=='none') bad.push('no cierra');
document.getElementById('print').click();
if(m.style.display!=='block') bad.push('no abre');
m.querySelector('[data-k="Imprimir etiquetas remotas"]').addEventListener('click',function(){picked='etiq';m.style.display='none';});
m.querySelector('[data-k="Imprimir etiquetas remotas"]').click();
if(picked!=='etiq'||m.style.display!=='none') bad.push('accion');
abierto();
document.getElementById('result').textContent=bad.length?('FAIL '+bad.join(' | ')):'OK';
</script>`;
const dir = '/tmp/etiq-print-menu';
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'menu.html'), page);
const chrome = '/usr/local/bin/google-chrome';
const widths = [320, 375, 390, 430, 471, 1280];
for (const w of widths) {
  const dump = spawnSync('timeout', ['--signal=KILL', '15', chrome, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--user-data-dir=/tmp/chrome-print-' + w, '--timeout=4000', '--window-size=' + w + ',844', '--virtual-time-budget=800', '--dump-dom', 'file://' + join(dir, 'menu.html')], { encoding: 'utf8' });
  const mark = ((dump.stdout || '').match(/<div id="result">([^<]*)</) || [])[1] || '';
  if (mark !== 'OK') throw new Error(w + ' ' + (mark || (dump.stderr || '').slice(0, 180)));
  console.log(w, 'OK');
}
spawnSync('timeout', ['--signal=KILL', '15', chrome, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--user-data-dir=/tmp/chrome-print-shot', '--timeout=4000', '--window-size=471,844', '--virtual-time-budget=800', '--screenshot=/opt/cursor/artifacts/etiq-print-menu-471.png', 'file://' + join(dir, 'menu.html')], { encoding: 'utf8' });
console.log('etiq-print-menu OK');
