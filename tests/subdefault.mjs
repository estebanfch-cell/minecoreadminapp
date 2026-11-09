import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sw = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const bloque = html.match(/window\.MCSubDef=\(function\(\)\{[\s\S]*?\}\)\(\);/);
if (!bloque) throw new Error("MCSubDef no está en index.html");
const MCSubDef = eval(bloque[0].replace("window.MCSubDef=", ""));
const LOC = "a4b0d9f6-9544-4200-aefa-43ed6c027484";
const OTRA = "3a81bc1d-8e34-486c-a98d-9a93c32cfb50";
const PID = "212a29cd-a8f7-45c2-8031-70bd9abeca23";

function datos(def) {
  return {
    stock: [
      { location_id: LOC, bodega: "BODEGA PRINCIPAL", sublocation: " 2-a-2 ", q: 1, ser: false },
      { location_id: LOC, bodega: "BODEGA PRINCIPAL", sublocation: "2-A-1", q: 1, ser: false },
      { location_id: OTRA, bodega: "BODEGA NORTE", sublocation: "ZONA 1", q: 4, ser: false }
    ],
    sub_defaults: [
      { location_id: LOC, bodega: "BODEGA PRINCIPAL", sub: def },
      { location_id: OTRA, bodega: "BODEGA NORTE", sub: "ZONA 1" }
    ],
    subs_bod: { [LOC]: ["2-A-2", "2-A-1", "  sin stock  "] }
  };
}
function ficha(def) {
  return MCSubDef.load(datos(def));
}

test("normaliza espacios, mayúsculas y guiones sin perder el código", () => {
  assert.equal(MCSubDef.norm("  2-a-2 "), "2-A-2");
  assert.equal(MCSubDef.norm("2 A 2"), "2 A 2");
  assert.equal(MCSubDef.norm("2-A-1"), "2-A-1");
  assert.equal(MCSubDef.norm("x".repeat(50)).length, 40);
});

test("elegir otra sububicación no toca cantidades y al reabrir sigue", () => {
  const st = ficha("2-A-2");
  assert.equal(st.B[LOC].def, "2-A-2");
  assert.equal(st.B[LOC].rows.length, 2);
  const fila = st.B[LOC].rows.find((x) => x.sub === "2-A-1");
  st.B[LOC].def = fila.sub;
  const plan = MCSubDef.cambios(st, PID);
  assert.deepEqual(plan.defs, [{ loc: LOC, sub: "2-A-1" }]);
  assert.deepEqual(plan.adj, {});
  assert.equal(st.B[LOC].rows.reduce((a, x) => a + x.q, 0), 2);
  assert.equal(MCSubDef.noQuedo(datos("2-A-1"), plan.defs), null);
  const otra = MCSubDef.load(datos("2-A-1"));
  assert.equal(otra.B[LOC].def, "2-A-1");
  assert.equal(otra.B[OTRA].def, "ZONA 1");
});

test("si la relectura sigue en el valor anterior, no hay éxito", () => {
  const st = ficha("2-A-2");
  st.B[LOC].def = "2-A-1";
  const plan = MCSubDef.cambios(st, PID);
  const mal = MCSubDef.noQuedo(datos("2-a-2"), plan.defs);
  assert.equal(mal.quiero, "2-A-1");
  assert.equal(mal.tengo, "2-A-2");
});

test("espacios distintos son la misma sububicación y no duplican la fila", () => {
  const st = ficha("2-A-2");
  assert.equal(st.B[LOC].rows.filter((x) => x.sub === "2-A-2").length, 1);
  assert.equal(st.B[LOC].rows.find((x) => x.sub === "2-A-2").q, 1);
});

test("sububicación válida sin stock se puede predeterminar sin ajuste", () => {
  const st = ficha("2-A-2");
  MCSubDef.ponerSinStock(st, LOC, " sin stock ");
  const row = st.B[LOC].rows.find((x) => x.sub === "SIN STOCK");
  assert.equal(row.q, 0);
  assert.equal(row.soloDef, true);
  st.B[LOC].def = row.sub;
  const plan = MCSubDef.cambios(st, PID);
  assert.deepEqual(plan.defs, [{ loc: LOC, sub: "SIN STOCK" }]);
  assert.deepEqual(plan.adj, {});
  const releido = {
    stock: datos("2-A-2").stock,
    sub_defaults: [
      { location_id: LOC, bodega: "BODEGA PRINCIPAL", sub: "SIN STOCK" },
      { location_id: OTRA, bodega: "BODEGA NORTE", sub: "ZONA 1" }
    ]
  };
  assert.equal(MCSubDef.noQuedo(releido, plan.defs), null);
  assert.equal(MCSubDef.load(releido).B[LOC].rows.find((x) => x.sub === "SIN STOCK").q, 0);
});

test("varias bodegas: cambiar una no mueve la otra", () => {
  const st = ficha("2-A-2");
  st.B[OTRA].def = "MUELLE";
  MCSubDef.ponerSinStock(st, OTRA, "MUELLE");
  const plan = MCSubDef.cambios(st, PID);
  assert.deepEqual(plan.defs, [{ loc: OTRA, sub: "MUELLE" }]);
  assert.equal(plan.adj[LOC], undefined);
});

test("la ficha no repite la bodega y la predeterminada se confirma al releer", () => {
  assert.equal(html.includes("Automática:"), false);
  assert.match(html, /op:'setUbicacionDefault'/);
  assert.match(html, /op:'prod_get',id:p\.id/);
  assert.match(html, /MCStk2\.def/);
  assert.match(html, /!x\.soloDef\|\|\+x\.q===0/);
  assert.match(html, /MCReubicar\(\{id:p\.id,desde:m\.desde/);
  assert.equal(html.includes("MC_BUILD='623'"), true);
  assert.equal(sw.includes("SWV='b623'"), true);
  const lines = new Function(html.slice(html.indexOf("function pf2Principal"), html.indexOf("function pf2StkHtml")) + "\nreturn pf2StkLines;")();
  const una = lines({
    stock: [
      { bodega: "BODEGA PRINCIPAL", sublocation: "BS-3-B", q: 38 },
      { bodega: "CONSIGNACIÓN", sublocation: "CONSIGNACIÓN KLUANE", q: 0 }
    ],
    sub_defaults: [
      { bodega: "BODEGA PRINCIPAL", sub: "BS-3-B" },
      { bodega: "CONSIGNACIÓN", sub: "CONSIGNACIÓN KLUANE" }
    ]
  });
  assert.deepEqual(una, [{ bod: "BODEGA PRINCIPAL", sub: "BS-3-B", q: 38, p: 1 }]);
  const dos = lines({
    stock: [
      { bodega: "BODEGA PRINCIPAL", sublocation: "BS-3-B", q: 38 },
      { bodega: "CONSIGNACIÓN", sublocation: "KLUANE", q: 2 }
    ],
    sub_defaults: [{ bodega: "BODEGA PRINCIPAL", sub: "BS-3-B" }]
  });
  assert.equal(dos.length, 2);
  assert.equal(dos[0].bod, "BODEGA PRINCIPAL");
  assert.equal(dos[1].q, 2);
});

const ui = html.slice(html.indexOf("window.MCSubDef="), html.indexOf("window.MCStkEd="));
function pagina(w) {
  return `<!doctype html><meta charset="utf-8"><title>sub</title>
<style>html,body{width:${w}px;margin:0;background:#0b1520;color:#e8eef5;font:14px sans-serif}
#pf-stk2{width:${w}px;box-sizing:border-box}.cbz-btn,.chip{min-height:44px;font-size:16px}
#result{padding:8px;color:#b7f34a}</style>
<div id="pf-stk2"></div><div id="result"></div>
<script>
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function MCcan(){return true;}
function MCerr(e){return String(e&&e.message||e);}
function MCpost(){return Promise.resolve({ok:true});}
var avisos=[],llamadas=[];
function toast(t){avisos.push(t);}
function alert(m){avisos.push('ALERT '+m);}
var releer=${JSON.stringify(w === 390 ? "2-A-1" : "2-A-2")};
function api(p){llamadas.push(p.op+(avisos.length?':tarde':''));
  if(p.op==='setUbicacionDefault')return Promise.resolve({ok:true,sublocation:p.sublocation});
  if(p.op==='prod_get')return Promise.resolve({ok:true,producto:{id:'p1'},stock:PF.cur.stock,sub_defaults:[{location_id:'bp',bodega:'BODEGA PRINCIPAL',sub:releer}]});
  return Promise.resolve({ok:true});}
function stkFin(r,msg){toast(msg);}
${ui}
var PF={stkO:{bodegas:[],motivos:[]},cur:{producto:{id:'p1'},stock:[{location_id:'bp',bodega:'BODEGA PRINCIPAL',sublocation:' 2-a-2 ',q:1},{location_id:'bp',bodega:'BODEGA PRINCIPAL',sublocation:'2-A-1',q:1},{location_id:'co',bodega:'CONSIGNACIÓN',sublocation:'KLUANE',q:0}],sub_defaults:[{location_id:'bp',bodega:'BODEGA PRINCIPAL',sub:'2-A-2'},{location_id:'co',bodega:'CONSIGNACIÓN',sub:'KLUANE'}]}};
document.getElementById('pf-stk2').innerHTML=MCStk2.html();
var box=document.getElementById('pf-stk2');
var txt=box.textContent;
var circ=[].slice.call(box.querySelectorAll('[role="button"]')).filter(function(b){return b.textContent==='○'||b.textContent==='●';});
if(circ.length)circ[circ.length-1].click();
var btn=document.getElementById('pf-sg2');
if(btn)btn.click();
setTimeout(function(){
  var fuera=box.scrollWidth>box.clientWidth+2;
  var bien=${w === 390 ? "avisos.indexOf('Predeterminada guardada')>=0&&avisos.join(' ').indexOf('ALERT')<0" : "avisos.join(' ').indexOf('no quedó guardada')>=0&&avisos.indexOf('Predeterminada guardada')<0"};
  var ok=!fuera&&txt.indexOf('Automática')<0&&txt.indexOf('predeterminada 2-A-2')>=0&&circ.length===2&&llamadas[0]==='setUbicacionDefault'&&llamadas[1]==='prod_get'&&llamadas.indexOf('stk_adjust')<0&&bien;
  document.getElementById('result').textContent=ok?'OK':('FAIL '+(fuera?'fuera ':'')+llamadas.join(',')+' | '+avisos.join(' | ')+' | circ '+circ.length);
  document.title=document.getElementById('result').textContent;
},80);
</script>`;
}

const dir = "/tmp/subdefault-ui";
mkdirSync(dir, { recursive: true });
const chrome = "/usr/local/bin/google-chrome";
for (const w of [390, 1280]) {
  const file = `${dir}/ui-${w}.html`;
  writeFileSync(file, pagina(w));
  const run = spawnSync(chrome, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--force-device-scale-factor=1", `--user-data-dir=/tmp/chrome-sub-${w}`, `--window-size=${w},900`, "--virtual-time-budget=2500", "--dump-dom", file], { encoding: "utf8", timeout: 25000 });
  const dom = (run.stdout || "") + (run.stderr || "");
  const m = dom.match(/id="result"[^>]*>([^<]*)</);
  if (!m || m[1] !== "OK") throw new Error(w + " " + (m ? m[1] : dom.slice(-500)));
  console.log(w, "OK");
}

function paginaMover(w) {
  return `<!doctype html><meta charset="utf-8"><title>mover</title>
<style>html,body{width:${w}px;margin:0}#pf-stk2{width:${w}px}</style>
<div id="pf-stk2"></div><div id="result"></div>
<script>
function esc(s){return String(s==null?'':s);}
function MCcan(){return true;}
function MCerr(e){return String(e&&e.message||e);}
var avisos=[],llamadas=[],movidas=[];
function toast(t){avisos.push(t);}
function alert(m){avisos.push('ALERT '+m);}
function api(p){llamadas.push(p.op);return Promise.resolve({ok:true,sublocation:p.sublocation});}
function MCReubicar(extra){movidas.push(extra);llamadas.push('mover');return Promise.resolve({ok:true});}
function stkFin(r,msg){toast(msg);}
${ui}
var PF={stkO:{bodegas:[],motivos:[]},cur:{producto:{id:'p522'},stock:[{location_id:'bp',bodega:'BODEGA PRINCIPAL',sublocation:'10-B-2',q:33}],sub_defaults:[{location_id:'bp',bodega:'BODEGA PRINCIPAL',sub:'10-B-2'}]}};
document.getElementById('pf-stk2').innerHTML=MCStk2.html();
MCStk2.sel('bp','11-C-9');
var antes=document.querySelectorAll('#pf-stk2 .stk2-q input').length;
MCStk2.q('bp',1,'10');
MCStk2.def('bp',1);
var btn=document.getElementById('pf-sg2');
if(btn)btn.click();
setTimeout(function(){
  var m=movidas[0]||{};
  var ok=antes>=1&&llamadas[0]==='mover'&&llamadas.indexOf('setUbicacionDefault')<0&&llamadas.indexOf('stk_adjust')<0&&m.desde==='10-B-2'&&m.hasta==='11-C-9'&&m.qty===10&&m.predeterminada===true&&avisos.indexOf('Ubicación guardada')>=0;
  document.getElementById('result').textContent=ok?'OK':('FAIL '+JSON.stringify({antes,llamadas,movidas,avisos}));
},80);
</script>`;
}
for (const w of [390, 1280]) {
  const file = `${dir}/mover-${w}.html`;
  writeFileSync(file, paginaMover(w));
  const run = spawnSync(chrome, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--force-device-scale-factor=1", `--user-data-dir=/tmp/chrome-subm-${w}`, `--window-size=${w},900`, "--virtual-time-budget=2500", "--dump-dom", file], { encoding: "utf8", timeout: 25000 });
  const dom = (run.stdout || "") + (run.stderr || "");
  const m = dom.match(/id="result"[^>]*>([^<]*)</);
  if (!m || m[1] !== "OK") throw new Error("mover " + w + " " + (m ? m[1] : dom.slice(-800)));
  console.log("mover", w, "OK");
}
