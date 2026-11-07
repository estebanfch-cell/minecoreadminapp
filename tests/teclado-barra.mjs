/**
 * Teclado móvil: oculta barra y flotantes. 320/375/390/430 y escritorio.
 *   node tests/teclado-barra.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
if (!html.includes("var MC_BUILD='606'")) throw new Error('build');
if (!sw.includes("var SWV='b606'")) throw new Error('sw');
if (!html.includes('html.kb-open #mc-bbar')) throw new Error('css');
if (!html.includes('visualViewport')) throw new Error('vv');
if (!html.includes("scrollIntoView({block:'center'")) throw new Error('scroll');
const css = html.slice(html.indexOf('@media(max-width:899px){\n html.kb-open'), html.indexOf('.dv-tabs button{flex:1 1 0'));
const jsStart = html.indexOf('/* b588:');
const js = html.slice(html.indexOf('(function(){', jsStart), html.indexOf('})();', jsStart) + 5);

function page(){
  return `<!doctype html><meta charset="utf-8"><title>kb</title>
<style>
${css}
#mc-bbar{display:flex;position:fixed;left:0;right:0;bottom:0;height:62px;background:#1b1d4a}
#mca-btn,.hfab{position:fixed;width:52px;height:52px;border-radius:50%}
#mca-btn{right:16px;bottom:80px;background:#a3e635}
.hfab{right:16px;bottom:140px;background:#E8FF00}
body{margin:0;background:#0b1520;color:#fff;height:1400px}
#campo{margin-top:700px;font-size:17px;padding:10px}
#result{position:fixed;top:8px;left:8px;color:#b7f34a;z-index:1}
</style>
<body class="mc-nav">
<div id="mc-bbar"><span>Ventas</span><span>Crear</span></div>
<button id="mca-btn" class="asist">✦</button>
<button class="hfab">+</button>
<input id="campo" class="pk-q">
<input id="otro">
<input id="ro" readonly value="x">
<textarea id="ta"></textarea>
<select id="sel"><option>a</option></select>
<div id="result"></div>
<script>
var scrolls=[];
Element.prototype.scrollIntoView=function(o){scrolls.push(o&&o.block);};
${js}
function mal(s){document.getElementById('result').textContent='FAIL '+s;document.title='FAIL';}
function cssOf(id){return getComputedStyle(document.getElementById(id)).display;}
var w=document.documentElement.clientWidth;
setTimeout(function(){
  if(w>=900){
    document.getElementById('campo').focus();
    setTimeout(function(){
      if(document.documentElement.classList.contains('kb-open'))return mal('escritorio');
      document.getElementById('result').textContent='OK';document.title='OK';
    },50);
    return;
  }
  document.getElementById('ro').focus();
  if(document.documentElement.classList.contains('kb-open'))return mal('readonly');
  document.getElementById('campo').focus();
  if(!document.documentElement.classList.contains('kb-open'))return mal('no abre');
  if(cssOf('mc-bbar')!=='none'||cssOf('mca-btn')!=='none')return mal('visible');
  if(getComputedStyle(document.querySelector('.hfab')).display!=='none')return mal('mas');
  setTimeout(function(){
    if(scrolls.indexOf('center')<0)return mal('scroll');
    document.getElementById('campo').blur();
    document.getElementById('otro').focus();
    if(!document.documentElement.classList.contains('kb-open'))return mal('parpadeo');
    document.getElementById('ta').focus();
    document.getElementById('sel').focus();
    if(!document.documentElement.classList.contains('kb-open'))return mal('select');
    document.getElementById('sel').blur();
    setTimeout(function(){
      if(document.documentElement.classList.contains('kb-open'))return mal('no cierra');
      document.getElementById('result').textContent='OK';document.title='OK';
    },400);
  },320);
},30);
</script></body>`;
}
const dir='/tmp/teclado-barra';
mkdirSync(dir,{recursive:true});
const chrome='/usr/local/bin/google-chrome';
for(const w of [320,375,390,430,1280]){
  const file=join(dir,'ui-'+w+'.html');
  writeFileSync(file,page());
  const shot='/opt/cursor/artifacts/teclado-barra-'+w+'.png';
  const run=spawnSync(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--force-device-scale-factor=1','--user-data-dir=/tmp/chrome-kb'+w,'--window-size='+w+',800','--virtual-time-budget=2000','--screenshot='+shot,'--dump-dom',file],{encoding:'utf8',timeout:20000});
  const dom=(run.stdout||'')+(run.stderr||'');
  if(!dom.includes('>OK<')&&!dom.includes('>OK</div>')){
    const m=dom.match(/id="result"[^>]*>([^<]*)</);
    throw new Error(w+' '+(m?m[1]:'sin resultado'));
  }
  console.log(w,'OK');
}
