/**
 * Lista de OV: «Sin factura» gris, «Factura solicitada» ámbar con fecha y nombre. 390 y escritorio.
 *   node tests/factura-solicitada.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
if (!html.includes("var MC_BUILD='623'")) throw new Error('build');
if (!sw.includes("var SWV='b623'")) throw new Error('sw');
if (!html.includes('ov-facsol')) throw new Error('endpoint');
if (!html.includes('MCFacSol.pegar(lista)')) throw new Error('lista');
const bloque = html.slice(html.indexOf('var MCFacSol=(function(){'), html.indexOf('function mcFacEnv'));
if (!bloque.includes('function mcFacSolEtq') || !bloque.includes('function mcFacSolViva')) throw new Error('funciones');

function page(w) {
  return `<!doctype html><meta charset="utf-8"><title>fac</title>
<style>html,body{margin:0;width:${w}px;background:#0b1520;color:#e8eef5;font:14px sans-serif}
.card{box-sizing:border-box;width:${w}px;padding:10px;border-bottom:1px solid #26405c}
.tagx{font-size:10px;padding:2px 8px;border-radius:10px;font-weight:700;border:1px solid #8fa3b8;color:#8fa3b8}
#result{padding:8px;color:#b7f34a;font-size:12px}</style>
<div id="box"></div><div id="result"></div>
<script>
${bloque}
var A={id:'a',payment_status:'uninvoiced'};
var B={id:'b',payment_status:'uninvoiced',fac_sol:{at:'2026-11-09T21:40:00.000Z',por:'EFCH',nombre:'Esteban Ferlito'}};
var C={id:'c',payment_status:'invoiced',is_invoiced:true,factura_sri:'001-001-000000123',fac_sol:{at:'2026-11-09T21:40:00.000Z',por:'EFCH',nombre:'Esteban Ferlito'}};
function fila(o){
  var pago=mcFacSolViva(o)?mcFacSolEtq(o):'<span class="tagx">'+(o.factura_sri?'Por cobrar':'Sin factura')+'</span>';
  var meta=o.factura_sri?('Fac. '+o.factura_sri):(mcFacSolViva(o)?mcFacSolEtq(o):'Sin factura');
  return '<div class="card" data-id="'+o.id+'"><div>'+pago+'</div><div class="meta">'+meta+'</div></div>';
}
document.getElementById('box').innerHTML=fila(A)+fila(B)+fila(C);
var box=document.getElementById('box');
var chip=box.querySelector('[data-id="b"] .mc-facsol');
chip.click();
var pop=document.getElementById('mc-facsol-pop');
var pr=pop?pop.getBoundingClientRect():null;
var br=box.getBoundingClientRect();
var ok=box.querySelector('[data-id="a"]').textContent.indexOf('Sin factura')>=0
  &&box.querySelector('[data-id="a"]').textContent.indexOf('Factura solicitada')<0
  &&chip&&getComputedStyle(chip).color==='rgb(240, 192, 64)'
  &&getComputedStyle(box.querySelector('[data-id="a"] .tagx')).color==='rgb(143, 163, 184)'
  &&box.querySelector('[data-id="c"]').textContent.indexOf('Por cobrar')>=0
  &&box.querySelector('[data-id="c"]').textContent.indexOf('001-001-000000123')>=0
  &&box.querySelector('[data-id="c"]').textContent.indexOf('Factura solicitada')<0
  &&pop&&pop.textContent.indexOf('09/11/2026 16:40 (EC)')>=0
  &&pop.textContent.indexOf('Esteban Ferlito')>=0
  &&pr.left>=0&&pr.right<=${w}+1&&pr.top>=0
  &&box.scrollWidth<=br.width+2;
document.getElementById('result').textContent=ok?'OK':('FAIL '+ (pop?pop.textContent:'sin pop')+' | '+box.textContent.slice(0,180));
document.title=document.getElementById('result').textContent;
</script>`;
}

const dir = '/tmp/factura-solicitada';
mkdirSync(dir, { recursive: true });
const chrome = '/usr/local/bin/google-chrome';
for (const w of [390, 1280]) {
  const file = `${dir}/ui-${w}.html`;
  writeFileSync(file, page(w));
  const run = spawnSync(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=1', `--user-data-dir=/tmp/chrome-fac-${w}`, `--window-size=${w},900`, '--virtual-time-budget=2500', '--dump-dom', file], { encoding: 'utf8', timeout: 25000 });
  const dom = (run.stdout || '') + (run.stderr || '');
  const m = dom.match(/id="result"[^>]*>([^<]*)</);
  if (!m || m[1] !== 'OK') throw new Error(w + ' ' + (m ? m[1] : dom.slice(-700)));
  console.log(w, 'OK');
}
