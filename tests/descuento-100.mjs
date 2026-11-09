/**
 * Descuento de línea al 100% para admin: el editor lo acepta y la línea queda en $0.
 *   node tests/descuento-100.mjs
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
if (!html.includes('d<=100')) throw new Error('pdf');
if (!html.includes('functions/v1/desc100')) throw new Error('fn');
const ed = html.slice(html.indexOf('function guardarEdicion'), html.indexOf('function convertirOV'));
if (!ed.includes("mcDesc100Empacar") || !ed.includes("editarCotCreada")) throw new Error('cot lista');
const io = html.slice(html.indexOf('function ioGuardar'), html.indexOf('function vinculoHtml'));
if (!io.includes("mcDesc100Empacar") || !io.includes("editarOrdenInflow")) throw new Error('ov lista');
const i = html.indexOf('function mcDescTope()');
const j = html.indexOf('/* editor modal:');
const helpers = html.slice(i, j);
if (!helpers.includes('~ov.e.desc100=1')) throw new Error('switch');

function page(w) {
  return `<!doctype html><meta charset="utf-8"><title>d100</title>
<style>html,body{margin:0;background:#0b1520;color:#e8eef5;font:14px sans-serif}
#caja{width:${w}px;max-width:${w}px;box-sizing:border-box;padding:8px}
.uinput{width:100%;box-sizing:border-box;min-height:44px;font-size:16px}
#result{color:#b7f34a;padding:8px}</style>
<div id="caja"></div><div id="result"></div>
<script>
function getProfile(){return window._P;}
function MCPtoks(m){return m||[];}
function mcRound(n){return Math.round(n);}
${helpers}
function mal(s){document.getElementById('result').textContent='FAIL '+s;document.title='FAIL';}
window._P={rol:'admin',modulos:[]};
if(mcDescTope()!==100)mal('admin');
if(mcDescClamp(100)!==100||mcDescClamp(150)!==100||mcDescClamp(-3)!==0)mal('clamp admin');
var pack=mcDesc100Empacar([{product_id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',sku:'MCOR1',quantity:2,unit_price:19.49,discount_pct:100}]);
if(pack.ped.length!==1||pack.lineas[0].discount_pct!==99)mal('empaca');
var fin=mcRound(19.49*(1-100/100)*100)/100;
if(fin!==0)mal('cero '+fin);
window._P={rol:'usuario',modulos:['$precios=0']};
if(mcDescTope()!==99||mcDescClamp(100)!==99)mal('resto');
if(mcDesc100Empacar([{discount_pct:100,quantity:1,unit_price:10,product_id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'}]).ped.length)mal('resto empaca');
window._P={rol:'usuario',modulos:['~ov.e.desc100=1']};
if(mcDescTope()!==100)mal('switch');
var caja=document.getElementById('caja');
caja.innerHTML='<label>Desc %<input id="d" class="uinput" type="number" min="0" max="'+mcDescTope()+'" value="100"></label><div id="fin"></div>';
var d=document.getElementById('d');
var neto=mcRound(19.49*(1-mcDescClamp(d.value)/100)*100)/100;
document.getElementById('fin').textContent='Final $'+neto.toFixed(2);
var r=caja.getBoundingClientRect();
if(d.getBoundingClientRect().right>r.right+1||d.getBoundingClientRect().width<40)mal('ancho');
if(document.getElementById('fin').textContent!=='Final $0.00')mal('texto');
if(document.getElementById('result').textContent.indexOf('FAIL')===0){}
else {document.getElementById('result').textContent='OK';document.title='OK';}
</script>`;
}

const dir = '/tmp/descuento-100';
mkdirSync(dir, { recursive: true });
mkdirSync('/opt/cursor/artifacts', { recursive: true });
const chrome = '/usr/local/bin/google-chrome';
for (const w of [390, 1280]) {
  const file = join(dir, 'ui-' + w + '.html');
  writeFileSync(file, page(w));
  const run = spawnSync(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=1', '--user-data-dir=/tmp/chrome-d100-' + w, '--window-size=' + w + ',700', '--virtual-time-budget=2500', '--screenshot=/opt/cursor/artifacts/descuento-100-' + w + '.png', '--dump-dom', file], { encoding: 'utf8', timeout: 20000 });
  const dom = (run.stdout || '') + (run.stderr || '');
  if (!dom.includes('>OK<') && !dom.includes('>OK</div>')) {
    const m = dom.match(/id="result"[^>]*>([^<]*)</);
    throw new Error(w + ' ' + (m ? m[1] : 'sin resultado ' + run.status));
  }
  console.log(w, 'OK');
}
