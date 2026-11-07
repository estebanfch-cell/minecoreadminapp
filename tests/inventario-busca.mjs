import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, "index.html"), "utf8");
const sw = readFileSync(join(root, "sw.js"), "utf8");
assert.match(html, /var MC_BUILD='610'/);
assert.match(sw, /var SWV='b610'/);

const lib = new Function(
  html.slice(html.indexOf("function mcNorm"), html.indexOf("function mcBusca")) +
    html.slice(html.indexOf("function pfCodigos"), html.indexOf("function pfFiltra")) +
    "\nreturn {mcNorm:mcNorm,pfCodigos:pfCodigos,pfCodigoDe:pfCodigoDe};"
)();
const avisos = new Function("window", html.slice(html.indexOf("window.mcAvisoCodigos="), html.indexOf("var MCAvisos=")) + "\nreturn window.mcAvisoCodigos;")({});

const productos = [
  { sku: "MCOR000126", name: "Tuani inner", codigo: "", cod_prov: "", is_active: true },
  { sku: "MCOR000522", name: "HP housing", codigo: "", cod_prov: "", is_active: true },
  { sku: "MCOR000517", name: "Otra pieza", codigo: "", cod_prov: "", is_active: true },
  { sku: "MCOR009999", name: "Fuera", codigo: "", cod_prov: "", is_active: true }
];

test("sin coma no parte la búsqueda", () => {
  assert.equal(lib.pfCodigos("tuani"), null);
  assert.equal(lib.pfCodigos("HP"), null);
});

test("varios códigos separados por coma", () => {
  assert.deepEqual(lib.pfCodigos("MCOR000126, MCOR000522, MCOR000517"), ["mcor000126", "mcor000522", "mcor000517"]);
  const q = lib.pfCodigos("MCOR000126, MCOR000522, MCOR000517");
  const hit = productos.filter((p) => q.some((c) => lib.pfCodigoDe(p, c))).map((p) => p.sku);
  assert.deepEqual(hit, ["MCOR000126", "MCOR000522", "MCOR000517"]);
});

test("el aviso usa códigos de sus datos o del texto", () => {
  assert.deepEqual(avisos({ tipo: "stockNegativo", skus: ["MCOR000126", "MCOR000522"], texto: "sin códigos" }), ["MCOR000126", "MCOR000522"]);
  assert.deepEqual(avisos({ tipo: "stockNegativo", texto: "Stock negativo: MCOR000126, MCOR000517" }), ["MCOR000126", "MCOR000517"]);
  assert.deepEqual(avisos({ tipo: "stockNegativo", texto: "Hay stock negativo en bodega" }), []);
});

function pagina(w) {
  return `<!doctype html><meta charset="utf-8"><title>busca</title>
<style>html,body{width:${w}px;max-width:${w}px;margin:0;overflow-x:hidden;background:#0b1520;color:#e8eef5;font:14px sans-serif}
.fila{display:flex;flex-direction:${w >= 1024 ? "row" : "column"};gap:8px;align-items:flex-start;width:100%;box-sizing:border-box}
.izq{width:${w >= 1024 ? "290px" : "100%"};box-sizing:border-box}
#lista{max-height:240px;overflow:auto}#ficha{flex:1;min-width:0;width:100%;box-sizing:border-box;border:1px solid #34506c;padding:8px}
input{width:100%;box-sizing:border-box;font-size:16px;min-height:44px}#result{padding:8px;color:#b7f34a}</style>
<div class="fila"><div class="izq"><input id="q" placeholder="Filtrar la lista"><div id="lista"></div></div><div id="ficha">FICHA MCOR000126</div></div><div id="result"></div>
<script>
${html.slice(html.indexOf("function mcNorm"), html.indexOf("function mcBusca"))}
${html.slice(html.indexOf("function pfCodigos"), html.indexOf("function pfFiltra"))}
var all=${JSON.stringify(productos)};
var abierto='MCOR000126';
function pintar(q){
  var codes=pfCodigos(q);
  var t=codes?[]:String(q||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').split(/\\s+/).filter(Boolean);
  var L=all.filter(function(x){
    if(codes)return codes.some(function(c){return pfCodigoDe(x,c);});
    if(!t.length)return true;
    var h=(x.sku+' '+x.name).toLowerCase();
    return t.every(function(k){return h.indexOf(k)>=0;});
  });
  document.getElementById('lista').innerHTML=L.map(function(x){return '<div data-sku="'+x.sku+'">'+x.sku+' '+x.name+'</div>';}).join('')||'<div>Sin resultados</div>';
}
var inp=document.getElementById('q');
inp.oninput=function(){pintar(inp.value);};
pintar('');
inp.value='tuani';inp.dispatchEvent(new Event('input',{bubbles:true}));
var uno=document.getElementById('lista').textContent;
inp.value='HP';inp.dispatchEvent(new Event('input',{bubbles:true}));
var dos=document.getElementById('lista').textContent;
inp.value='MCOR000126, MCOR000517';inp.dispatchEvent(new Event('input',{bubbles:true}));
var tres=[].map.call(document.querySelectorAll('#lista [data-sku]'),function(n){return n.getAttribute('data-sku');}).join(',');
var ficha=document.getElementById('ficha').textContent;
var fuera=document.body.scrollWidth>document.body.clientWidth+2;
var ok=!fuera&&uno.indexOf('Tuani')>=0&&uno.indexOf('HP')<0&&dos.indexOf('HP')>=0&&dos.indexOf('Tuani')<0&&tres==='MCOR000126,MCOR000517'&&ficha==='FICHA MCOR000126';
document.getElementById('result').textContent=ok?'OK':'FAIL '+uno+' || '+dos+' || '+tres;
</script>`;
}

const dir = "/tmp/inventario-busca";
mkdirSync(dir, { recursive: true });
for (const w of [390, 1280]) {
  const file = join(dir, "ui-" + w + ".html");
  writeFileSync(file, pagina(w));
  const run = spawnSync("/usr/local/bin/google-chrome", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--force-device-scale-factor=1", "--user-data-dir=/tmp/chrome-busca-" + w, "--window-size=" + w + ",800", "--virtual-time-budget=2500", "--dump-dom", file], { encoding: "utf8", timeout: 25000 });
  const m = (run.stdout || "").match(/id="result"[^>]*>([^<]*)</);
  if (!m || m[1] !== "OK") throw new Error(w + " " + (m ? m[1] : (run.stdout || "").slice(-300)));
  console.log(w, "OK");
}
