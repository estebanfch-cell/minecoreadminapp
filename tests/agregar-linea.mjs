/**
 * El «+» de la fila de producto agrega la cantidad escrita, también con el campo enfocado.
 * Vacío agrega 1. 390 y escritorio. No guarda documentos.
 *   node tests/agregar-linea.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
if (!html.includes("var MC_BUILD='628'")) throw new Error('build');
if (!sw.includes("var SWV='b628'")) throw new Error('sw');
const topeAt = html.indexOf('function mcDescTope()');
const mcptAt = html.indexOf('var MCPT=(function()');
if (topeAt < 0 || mcptAt < 0 || topeAt > mcptAt) throw new Error('mcDescTope sigue dentro de MCPT');
const a = html.indexOf('var MCpk=');
const b = html.indexOf('/* b450', a);
const mc = html.slice(a, b);
if (!mc.includes('function(ev,btn)') && !mc.includes('tap:function')) throw new Error('sin tap');
if (mc.includes('type="number"')) throw new Error('sigue type=number');
new Function(mc + ';return MCpk;');
const desc = html.slice(html.indexOf('function mcDescTope()'), html.indexOf('/* b475 EFCH'));
const kbStart = html.indexOf('(function(){', html.indexOf('/* b588:'));
const kbEnd = html.indexOf('})();', kbStart);
const kb = html.slice(kbStart, kbEnd + 5);

function page(w) {
  return `<!doctype html><meta charset="utf-8"><title>mas</title>
<style>html,body{margin:0;width:${w}px;background:#0b1520;color:#e8eef5;font:14px sans-serif}
body.mc-nav{padding-bottom:66px}
#mc-bbar{display:flex;position:fixed;left:0;right:0;bottom:0;height:62px;background:#1b1d4a}
.mb-crear{background:#E8FF00;width:44px;height:44px;border-radius:50%}
html.kb-open #mc-bbar,html.kb-open .mb-crear{display:none!important}
.cbz-card{box-sizing:border-box;width:${w}px;padding:8px;background:#0f1720}
.cbz-btn{background:#1e4976;color:#fff;border:0;border-radius:8px;padding:7px 12px}
.uinput{width:100%;box-sizing:border-box}
#result{padding:8px;color:#b7f34a;font-size:12px}</style>
<body class="mc-nav">
<div class="cbz-card" id="card"></div>
<div id="mc-bbar"><button class="mb-crear" type="button">+</button><span>Ventas</span></div>
<div id="result">WAIT</div>
<script>
function mcRound(v){var x=+v||0;var a=Number(Math.abs(x).toPrecision(15));var r=Math.floor(a+0.5);return x<0?-r:r;}
${desc}
${mc}
${kb}
var added=[],errs=[];
window.onerror=function(m){errs.push(String(m));};
window.alert=function(m){errs.push('alert:'+m);};
function getProfile(){return {rol:'admin',modulos:[]};}
var Cot={pkAddDet:function(sku,q){added.push({via:'cot',sku:sku,q:MCpk.q(q),tope:mcDescTope(),desc:mcDescClamp(120)});}};
var Ventas={pkAdd:function(i,q){added.push({via:'ov',i:i,q:MCpk.q(q),tope:mcDescTope()});}};
document.getElementById('card').innerHTML=MCpk.card('<div style="width:38px;height:38px;background:#fff"></div>','HO3 KH CORE LIFTER BROACHED','MCOR000127 · BODEGA PRINCIPAL: On hand <b>10</b> · Disponible <b>4</b> · $12.00',MCpk.row("Cot.pkAddDet('MCOR000127',",0,0))+MCpk.row('Ventas.pkAdd(0,',0,0);
var card=document.getElementById('card');
var inp=card.querySelector('input');
var btn=card.querySelector('button');
var btnOv=card.querySelectorAll('button')[1];
inp.focus();
inp.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));
inp.value='60';
btn.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));
var q60=added.length===1&&added[0].via==='cot'&&added[0].q===60&&added[0].sku==='MCOR000127'&&added[0].tope===100&&added[0].desc===100;
var ae0=document.activeElement&&document.activeElement.tagName;
var kbOn=document.documentElement.classList.contains('kb-open');
var barOn=getComputedStyle(document.getElementById('mc-bbar')).display==='none';
added.length=0;
inp.value='';
btn._mcPk=0;
btn.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));
var q1=added.length===1&&added[0].q===1;
added.length=0;
btnOv._mcPk=0;
btnOv.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));
var qOv=added.length===1&&added[0].via==='ov'&&added[0].q===1&&added[0].tope===100;
added.length=0;
inp.value='3';
btn._mcPk=0;
btn.click();
var qClick=added.length===1&&added[0].q===3;
var box=btn.getBoundingClientRect();
inp.blur();
setTimeout(function(){
  var kbOff=!document.documentElement.classList.contains('kb-open');
  var movil=matchMedia('(max-width:899px)').matches;
  var ok=q60&&q1&&qOv&&qClick&&errs.length===0&&box.right<=card.clientWidth+2&&card.scrollWidth<=card.clientWidth+2&&(movil?kbOn&&barOn&&kbOff:!kbOn);
  document.getElementById('result').textContent=ok?'OK':('FAIL 60='+q60+' vacio='+q1+' ov='+qOv+' click='+qClick+' kb='+kbOn+'/'+kbOff+' bar='+barOn+' w='+innerWidth+' ae0='+ae0+' err='+errs.join('|'));
  document.title=document.getElementById('result').textContent.slice(0,80);
},400);
</script></body>`;
}

const dir = '/tmp/agregar-linea';
mkdirSync(dir, { recursive: true });
const chrome = '/usr/local/bin/google-chrome';
for (const w of [390, 1280]) {
  const file = `${dir}/ui-${w}.html`;
  writeFileSync(file, page(w));
  const run = spawnSync(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--force-device-scale-factor=1', `--user-data-dir=/tmp/chrome-mas-${w}`, `--window-size=${w},900`, '--virtual-time-budget=2500', '--dump-dom', file], { encoding: 'utf8', timeout: 25000 });
  const out = `${run.stdout || ''}\n${run.stderr || ''}`;
  const title = (out.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  if (!out.includes('>OK<') && title !== 'OK') {
    const res = (out.match(/id="result">([^<]*)</) || [])[1] || out.slice(-800);
    throw new Error(w + ' ' + res);
  }
  console.log(w, 'OK');
}
console.log('agregar-linea ok');
