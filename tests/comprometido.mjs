import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, "index.html"), "utf8");
const sw = readFileSync(join(root, "sw.js"), "utf8");
assert.match(html, /var MC_BUILD='617'/);
assert.match(sw, /var SWV='b617'/);
assert.match(html, /Comprometido: /);
assert.match(html, /pf2IrOV/);

const ej = {
  comprometido_total: 7,
  comprometido: [{ so_id: "a4b0d9f6-9544-4200-aefa-43ed6c027484", so_number: "MCOR-SO-001231-4", cliente: "KLUANE DRILLING ECUADOR S.A", qty: 7 }]
};

function pagina(w, r) {
  const fn = html.slice(html.indexOf("function pf2IrOV"), html.indexOf("function pf2Head("));
  return `<!doctype html><meta charset="utf-8"><title>comp</title>
<style>html,body{width:${w}px;max-width:${w}px;margin:0;overflow-x:hidden;background:#0b1520;color:#e8eef5;font:14px sans-serif}
.pf-comp{width:100%;box-sizing:border-box}.pf-comp-t{font-weight:800;color:#f0c040}
.pf-comp-r{display:block;width:100%;box-sizing:border-box;text-align:left;background:transparent;border:0;color:#5cc8ff;font:inherit;font-size:13px;padding:6px 0;min-height:44px;white-space:normal;overflow-wrap:anywhere}
#caja{width:100%;box-sizing:border-box}#result{color:#b7f34a;padding:8px}</style>
<div id="caja"></div><div id="result"></div>
<script>
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function mcRound(n){return Math.round(n*100)/100;}
var abierto='';
function openMod(){}
var Ventas={abrir:function(id){abierto=id;}};
${fn}
document.getElementById('caja').innerHTML='<div>STOCK 38</div>'+pf2CompHtml(${JSON.stringify(r)});
var box=document.getElementById('caja');
var vacio=${JSON.stringify(!(r.comprometido_total > 0))};
var btn=box.querySelector('.pf-comp-r');
if(btn)btn.click();
setTimeout(function(){
  var ok=document.body.scrollWidth<=document.body.clientWidth+2;
  if(vacio) ok=ok&&!box.querySelector('.pf-comp');
  else ok=ok&&box.textContent.indexOf('Comprometido: 7')>=0&&box.textContent.indexOf('MCOR-SO-001231-4 · KLUANE DRILLING ECUADOR S.A · 7 u')>=0&&abierto==='a4b0d9f6-9544-4200-aefa-43ed6c027484';
  document.getElementById('result').textContent=ok?'OK':'FAIL '+box.textContent+' '+abierto;
},400);
</script>`;
}

test("sin comprometido no se muestra", () => {
  assert.equal(html.includes("function pf2CompHtml"), true);
});

const dir = "/tmp/comprometido";
mkdirSync(dir, { recursive: true });
for (const [w, r] of [[390, ej], [1280, ej], [390, { comprometido_total: 0, comprometido: [] }]]) {
  const file = join(dir, "ui-" + w + "-" + (r.comprometido_total || 0) + ".html");
  writeFileSync(file, pagina(w, r));
  const run = spawnSync("/usr/local/bin/google-chrome", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--force-device-scale-factor=1", "--user-data-dir=/tmp/chrome-comp-" + w + "-" + (r.comprometido_total || 0), "--window-size=" + w + ",800", "--virtual-time-budget=2500", "--dump-dom", file], { encoding: "utf8", timeout: 25000 });
  const m = (run.stdout || "").match(/id="result"[^>]*>([^<]*)</);
  if (!m || m[1] !== "OK") throw new Error(w + " " + (r.comprometido_total || 0) + " " + (m ? m[1] : (run.stdout || "").slice(-240)));
  console.log(w, r.comprometido_total || 0, "OK");
}
