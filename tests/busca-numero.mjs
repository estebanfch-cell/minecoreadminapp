/**
 * «126» encuentra MCOR000126 en los buscadores, y el botón del conteo
 * aparece en el teléfono.   node tests/busca-numero.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, "index.html"), "utf8");
const sw = readFileSync(join(root, "sw.js"), "utf8");
assert.match(html, /var MC_BUILD='612'/);
assert.match(sw, /var SWV='b612'/);
assert.equal(html.split("function ccDig(").length, 2);
assert.equal(html.split("function ccBusca(").length, 2);
assert.match(html, /function kb\(\)\{var m=MCkb\.toggle\(\)/);
assert.match(html, /id="pk-busca"/);

const lib = new Function(
  html.slice(html.indexOf("function mcNorm"), html.indexOf("function mcBusca")) +
    html.slice(html.indexOf("function pfCodigos"), html.indexOf("function pfFiltra")) +
    "\nreturn {mcQ:mcQ,ccBusca:ccBusca,pfCodigoDe:pfCodigoDe,pfCodigos:pfCodigos,MCps:MCps};"
)();

const cat = [
  { sku: "MCOR000126", name: "Tuani inner", nombre: "Tuani inner", codigo: "", cod_prov: "ZX-9", is_active: true },
  { sku: "MCOR000522", name: "HP housing", nombre: "HP housing", codigo: "000522", cod_prov: "", is_active: true },
  { sku: "MCOR000517", name: "Otra", nombre: "Otra", codigo: "", cod_prov: "", is_active: true }
];

test("126 es MCOR000126 y no apaga el texto ni el código del proveedor", () => {
  assert.equal(lib.ccBusca("126"), "MCOR000126");
  assert.equal(lib.ccBusca("126, 522"), "126, 522");
  assert.equal(lib.ccBusca("tuani"), "tuani");
  assert.equal(lib.mcQ("126", "MCOR000126 Tuani inner"), true);
  assert.equal(lib.mcQ("12", "MCOR000126 Tuani inner"), false);
  assert.equal(lib.mcQ("tuani", "MCOR000126 Tuani inner"), true);
  assert.equal(lib.mcQ("ZX-9", "MCOR000126 ZX-9"), true);
  assert.equal(lib.mcQ("000522", "codigo 000522"), true);
  assert.equal(lib.mcQ("126, 522", "MCOR000522 HP"), true);
  assert.equal(lib.mcQ("126, 522", "MCOR000517 Otra"), false);
  assert.equal(lib.pfCodigoDe(cat[0], "126"), true);
  assert.equal(lib.pfCodigoDe(cat[1], "522"), true);
  const q = lib.pfCodigos("126, 522");
  const hit = cat.filter((p) => q.some((c) => lib.pfCodigoDe(p, c))).map((p) => p.sku);
  assert.deepEqual(hit, ["MCOR000126", "MCOR000522"]);
  const rank = lib.MCps.rank("126, 522", cat, (p) => p.name, (p) => p.sku + " " + p.name + " " + p.codigo);
  assert.deepEqual(rank.map((p) => p.sku), ["MCOR000126", "MCOR000522"]);
});

function pagina(w) {
  const kb = html.slice(html.indexOf("window.MCkb="), html.indexOf("var mcIdb="));
  const css = ".mckb-row{display:flex;gap:6px;align-items:center;width:100%}.mckb{min-width:44px;height:40px;display:inline-flex}@media(min-width:701px){.mckb{display:none!important}}";
  return `<!doctype html><meta charset="utf-8"><title>kbnum</title>
<style>html,body{margin:0;background:#0b1520;color:#fff;font:14px sans-serif}
${css}
input{font-size:16px;min-height:40px}</style>
<input class="uinput mc-psrch" id="cz-q" placeholder="Buscar producto…">
<input id="ms-pq" placeholder="Buscar producto, SKU, marca o código">
<input id="pf-md-q" placeholder="Filtrar la lista">
<input id="vt-pq" class="mc-psrch" placeholder="Buscar producto…">
<input id="cf-pq" class="mc-psrch" placeholder="Buscar producto…">
<input id="pq-q" placeholder="Buscar OV, cliente o producto…">
<input id="pp-q" placeholder="Buscar OV, cliente o producto…">
<input id="pk-busca" class="mc-psrch" placeholder="Buscar producto…">
<input id="cli" placeholder="Buscar cliente…">
<div id="result"></div>
<script>
${kb}
setTimeout(function(){
  MCkb.vestir(document);
  var b=document.querySelector('#cz-q').parentNode.querySelector('.mckb');
  var vis=b?getComputedStyle(b).display:'missing';
  var modo=document.getElementById('cz-q').getAttribute('inputmode');
  if(b)b.click();
  var modo2=document.getElementById('cz-q').getAttribute('inputmode');
  var n=document.querySelectorAll('.mckb').length;
  var cli=document.getElementById('cli').dataset.mckb||'';
  var ok=n>=8&&!cli&&modo==='numeric'&&modo2==='text'&&((${w}>=701&&vis==='none')||(${w}<701&&vis!=='none'&&vis!=='missing'));
  document.getElementById('result').textContent=ok?'OK':'FAIL n='+n+' vis='+vis+' modo='+modo+'/'+modo2+' cli='+cli+' w='+document.documentElement.clientWidth;
},30);
</script>`;
}

const dir = "/tmp/busca-numero";
mkdirSync(dir, { recursive: true });
for (const w of [390, 1280]) {
  const file = join(dir, "ui-" + w + ".html");
  writeFileSync(file, pagina(w));
  const run = spawnSync("/usr/local/bin/google-chrome", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--force-device-scale-factor=1", "--user-data-dir=/tmp/chrome-kbnum-" + w, "--window-size=" + w + ",800", "--virtual-time-budget=2500", "--dump-dom", file], { encoding: "utf8", timeout: 25000 });
  const m = (run.stdout || "").match(/id="result"[^>]*>([^<]*)</);
  if (!m || m[1] !== "OK") throw new Error(w + " " + (m ? m[1] : (run.stderr || run.stdout || "").slice(-400)));
  console.log(w, "OK");
}
