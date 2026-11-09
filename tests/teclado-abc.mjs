/**
 * El botón ABC cambia el teclado sin soltar el texto ni el cursor.
 * WebKit a 390 px (iPhone).   node tests/teclado-abc.mjs
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, "index.html"), "utf8");
const sw = readFileSync(join(root, "sw.js"), "utf8");
assert.match(html, /var MC_BUILD='619'/);
assert.match(sw, /var SWV='b619'/);
const kb = html.slice(html.indexOf("window.MCkb="), html.indexOf("var mcIdb="));
assert.match(kb, /pointerdown/);
assert.match(kb, /touchstart/);
assert.match(kb, /passive:false/);
assert.match(kb, /inp\.blur\(\)/);
assert.match(kb, /inp\.focus\(\)/);
assert.match(kb, /setSelectionRange/);
assert.match(kb, /localStorage\.setItem\('mc_cc_kb'/);
assert.match(html, /function kb\(\)\{MCkb\.pulsar\(\$\('cc-scan'\)\);\}/);

const page = `<!doctype html><meta charset="utf-8"><title>abc</title>
<style>.mckb{min-width:44px;height:40px;display:inline-flex}input{font-size:16px;min-height:40px}</style>
<input id="ms-pq" type="search" placeholder="Buscar producto, SKU, marca o código" value="">
<input id="pf-md-q" placeholder="Filtrar la lista">
<input id="cc-scan" type="text" placeholder="Escanea o busca código / nombre">
<button type="button" class="cc-kb" id="cc-kb">ABC</button>
<div id="result"></div>
<script>
${kb}
var log=[];
var inp=document.getElementById('ms-pq');
var ob=inp.blur, of=inp.focus;
inp.blur=function(){log.push('blur');return ob.call(inp);};
inp.focus=function(){log.push('focus');return of.call(inp);};
MCkb.vestir(document);
inp.value='126';
inp.focus();
log=[];
inp.setSelectionRange(1,1);
var btn=inp.parentNode.querySelector('.mckb');
var ev=new PointerEvent('pointerdown',{bubbles:true,cancelable:true});
btn.dispatchEvent(ev);
var prevented=ev.defaultPrevented;
var modo=inp.getAttribute('inputmode');
var typ=inp.getAttribute('type');
var val=inp.value;
var cur=inp.selectionStart;
var lab=btn.textContent;
var store='';
try{store=localStorage.getItem('mc_cc_kb');}catch(e){}
var orden=log.join(',');
var ckb=document.getElementById('cc-kb');
setTimeout(function(){
  var ev2=new PointerEvent('pointerdown',{bubbles:true,cancelable:true});
  btn.dispatchEvent(ev2);
  var back=inp.getAttribute('inputmode');
  var lab2=btn.textContent;
  var cev=new PointerEvent('pointerdown',{bubbles:true,cancelable:true});
  ckb.dispatchEvent(cev);
  var ok=prevented&&modo==='text'&&typ==='text'&&val==='126'&&cur===1&&lab==='123'&&store==='text'&&orden==='blur,focus'&&document.activeElement===inp&&ckb.dataset.mckbOn==='1'&&cev.defaultPrevented&&back==='numeric'&&lab2==='ABC'&&inp.value==='126'&&document.getElementById('pf-md-q').getAttribute('inputmode')==='numeric';
  document.getElementById('result').textContent=ok?'OK':'FAIL prev='+prevented+' modo='+modo+'/'+back+' typ='+typ+' val='+val+' cur='+cur+' lab='+lab+'/'+lab2+' st='+store+' log='+orden+' on='+ckb.dataset.mckbOn+' act='+(document.activeElement&&document.activeElement.id);
},320);
</script>`;

const dir = "/tmp/teclado-abc";
mkdirSync(dir, { recursive: true });
const file = join(dir, "ui.html");
writeFileSync(file, page);

function chrome() {
  const run = spawnSync("/usr/local/bin/google-chrome", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--user-data-dir=/tmp/chrome-abc-390", "--window-size=390,844", "--virtual-time-budget=2500", "--dump-dom", file], { encoding: "utf8", timeout: 25000 });
  const m = (run.stdout || "").match(/id="result"[^>]*>([^<]*)</);
  if (!m || m[1] !== "OK") throw new Error("chrome " + (m ? m[1] : (run.stderr || "").slice(-300)));
  console.log("chrome 390 OK");
}

async function webkit() {
  const pw = (await import("/tmp/pw/node_modules/playwright-core/index.js")).default;
  const browser = await pw.webkit.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    hasTouch: true,
    isMobile: true
  });
  const p = await context.newPage();
  await p.goto("file://" + file);
  await p.waitForFunction(() => document.getElementById("result").textContent.length > 0);
  const t = await p.locator("#result").textContent();
  await browser.close();
  if (t !== "OK") throw new Error("webkit " + t);
  console.log("webkit 390 OK");
}

chrome();
webkit().catch((e) => { console.error(e); process.exit(1); });
