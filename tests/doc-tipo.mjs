/**
 * El documento de la OC dice qué es, no «adjunto».
 *   node tests/doc-tipo.mjs
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
assert.match(html, /var MC_BUILD='615'/);
assert.match(sw, /var SWV='b615'/);
assert.match(html, /op:'po_adjunto_tipo'/);
assert.match(html, /op:'so_adjunto_tipo'/);
assert.match(html, /doc_kind:tipo/);

const lib = new Function(
  html.slice(html.indexOf("var MC_DOC_TIPOS"), html.indexOf("/* b610: el botón ABC")) +
    "\nreturn {mcDocClase:mcDocClase,mcDocTit:mcDocTit,MC_DOC_TIPOS:MC_DOC_TIPOS};"
)();

test("el nombre dice el tipo y el número", () => {
  const nc = lib.mcDocClase("NC_F001-00002276.pdf", "Minecore", "po");
  assert.equal(nc.tipo, "Nota de crédito");
  assert.equal(nc.numero, "F001-00002276");
  assert.equal(lib.mcDocTit(nc), "Nota de crédito · F001-00002276");
  const fac = lib.mcDocClase("20100060311-01-F001-00050461.pdf", "Vinculado · Costeo MCOR-02.3.5.13 (asignación costeo F001-00050461)", "");
  assert.equal(fac.tipo, "Factura");
  assert.equal(fac.numero, "F001-00050461");
  assert.equal(lib.mcDocClase("PACKING LIST _PRELIMINAR (1).pdf", "", "").tipo, "Packing list");
  assert.equal(lib.mcDocClase("PL_40560.pdf", "", "").tipo, "Packing list");
  assert.equal(lib.mcDocClase("SWIFT_CM2610290FSC821_Boyles.pdf", "SECRE", "").tipo, "Comprobante de pago");
  assert.equal(lib.mcDocClase("proforma-boyles.pdf", "", "").tipo, "Proforma");
  assert.equal(lib.mcDocClase("MINECORE 41182.pdf", "Minecore", "").tipo, "Otro");
  assert.equal(lib.mcDocClase("20100060311-01-F001-00050461.pdf", "", "Proforma").tipo, "Proforma");
  assert.equal(lib.mcDocClase("FACTURA F001-1086.pdf", "", "Otro").tipo, "Factura");
});

function pagina(w, admin) {
  const js = html.slice(html.indexOf("var MC_DOC_TIPOS"), html.indexOf("/* b610: el botón ABC"));
  const files = [
    ["NC_F001-00002276.pdf", "Minecore", "po"],
    ["20100060311-01-F001-00050461.pdf", "Vinculado · Costeo", ""],
    ["PACKING LIST _PRELIMINAR (1).pdf", "", ""]
  ];
  return `<!doctype html><meta charset="utf-8"><title>docs</title>
<style>html,body{width:${w}px;max-width:${w}px;margin:0;overflow-x:hidden;background:#0b1520;color:#e8eef6;font:14px sans-serif}
.mdoc{border:1px solid #26405c;border-radius:12px;padding:14px;margin:8px;background:#13202e}
.mdoc-t{font-size:18px;font-weight:700;overflow-wrap:anywhere}
.mc-doct{width:100%;max-width:100%;min-height:44px;font-size:16px;box-sizing:border-box}
#result{padding:8px;color:#b7f34a}</style>
<div id="box"></div><div id="result"></div>
<script>
${js}
var A=${admin ? "true" : "false"};
var files=${JSON.stringify(files)};
var h='';
files.forEach(function(f,i){
  var c=mcDocClase(f[0],f[1],f[2]);
  var tit=A?mcDocSel(c.tipo,'id="s'+i+'"')+'<div>'+c.numero+'</div>':mcDocTit(c);
  h+='<div class="mdoc"><div class="mdoc-t">'+tit+'</div><div>'+f[0]+'</div></div>';
});
document.getElementById('box').innerHTML=h;
var t=document.getElementById('box').textContent;
var fuera=document.body.scrollWidth>document.body.clientWidth+2;
var ok=!fuera&&t.indexOf('Nota de crédito')>=0&&t.indexOf('F001-00002276')>=0&&t.indexOf('Factura')>=0&&t.indexOf('F001-00050461')>=0&&t.indexOf('Packing list')>=0&&t.indexOf('Adjunto')<0;
if(A){var s=document.getElementById('s0');if(!s||s.value!=='Nota de crédito')ok=false;}
else if(document.querySelector('select'))ok=false;
document.getElementById('result').textContent=ok?'OK':'FAIL '+t+' fuera='+fuera;
</script>`;
}

const dir = "/tmp/doc-tipo";
mkdirSync(dir, { recursive: true });
for (const [w, admin] of [[390, true], [1280, true], [390, false]]) {
  const file = join(dir, "ui-" + w + "-" + (admin ? "a" : "u") + ".html");
  writeFileSync(file, pagina(w, admin));
  const run = spawnSync("/usr/local/bin/google-chrome", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--user-data-dir=/tmp/chrome-doc-" + w + (admin ? "a" : "u"), "--window-size=" + w + ",800", "--virtual-time-budget=2000", "--dump-dom", file], { encoding: "utf8", timeout: 20000 });
  const m = (run.stdout || "").match(/id="result"[^>]*>([^<]*)</);
  if (!m || m[1] !== "OK") throw new Error(w + " " + admin + " " + (m ? m[1] : (run.stderr || "").slice(-200)));
  console.log(w, admin ? "admin" : "user", "OK");
}
