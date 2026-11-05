/**
 * Etiqueta Clientes 51×19 con Code128 compacto. Datos de prueba.
 * El decoder es zbar (imagen), no una pistola física.
 *   node tests/etiq-clientes-layout.mjs
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, 'etiq/clientes-layout.js'), 'utf8');
const sandbox = {};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(src, sandbox);
const lay = sandbox.MCCliLay;

const sku = 'PRUEBA000261';
const fit = lay.fit(sku);
if (fit.module < lay.MIN_MOD) throw new Error('modulo ' + fit.module);
if (fit.sym.quiet !== 10) throw new Error('quiet');
const longName = 'HO LOCKING COUPLING FULL HOLE W/O HEAT TREATED - BOYLES BROS DE PRUEBA';
const words = longName.split(/\s+/);

function pbm(sku) {
  const sym = lay.symbol(sku);
  const px = 4;
  const quiet = 10 * px;
  let mods = 0;
  sym.pats.forEach((p) => { for (const ch of p) mods += +ch; });
  const w = mods * px + quiet * 2;
  const h = 80;
  const row = new Uint8Array(w);
  row.fill(255);
  let x = quiet;
  for (const p of sym.pats) {
    let black = true;
    for (const ch of p) {
      const ww = (+ch) * px;
      if (black) row.fill(0, x, x + ww);
      x += ww;
      black = !black;
    }
  }
  const bytesPer = Math.ceil(w / 8);
  const body = Buffer.alloc(bytesPer * h);
  for (let y = 0; y < h; y++) {
    for (let i = 0; i < w; i++) {
      if (row[i] === 0) body[y * bytesPer + (i >> 3)] |= 0x80 >> (i & 7);
    }
  }
  const head = Buffer.from(`P4\n${w} ${h}\n`);
  return Buffer.concat([head, body]);
}
mkdirSync('/tmp/etiq-bars', { recursive: true });
const pbmPath = '/tmp/etiq-bars/prueba.pbm';
writeFileSync(pbmPath, pbm(sku));
const dec = spawnSync('zbarimg', ['-q', '--raw', pbmPath], { encoding: 'utf8' });
if (dec.status !== 0 || dec.stdout.trim() !== sku) {
  throw new Error('zbar ' + dec.status + ' ' + dec.stdout + ' ' + dec.stderr);
}

const req = createRequire('/tmp/jspdfpkg/package.json');
const { jsPDF } = req('jspdf');
function check(info, label) {
  if (info.skuPt !== info.ovPt) throw new Error(label + ' tamanos ' + info.skuPt + ' ' + info.ovPt);
  if (info.gap < 0.7 || info.gap > 1.8) throw new Error(label + ' gap ' + info.gap);
  if (info.qtyX < info.skuX + info.skuW + 0.6) throw new Error(label + ' solape sku/cantidad');
  if (info.lines === 1 && info.qtyX + info.qtyW > info.ovX - 1.2) throw new Error(label + ' solape cantidad/OV');
  if (info.skuX < 1.4 || info.ovX + info.ovW > 49.7) throw new Error(label + ' margen');
  if (info.lines === 2 && info.yOv <= info.ySku) throw new Error(label + ' OV no bajo de linea');
}
const doc = new jsPDF({ unit: 'mm', format: [51, 19], orientation: 'landscape' });
const cases = [
  { nombre: longName, sku, qty: 3, ov: 'PRUEBA-SO-0001' },
  { nombre: 'BROCA DE PRUEBA', sku: 'PRUEBA000261', qty: 1, ov: 'PRUEBA-SO-001285-1' },
  { nombre: longName, sku: 'PRUEBA000261', qty: 12, ov: 'PRUEBA-SO-001285-2' },
  { nombre: 'PIEZA DE PRUEBA CON VARIOS SPLITS', sku: 'PRUEBA000261', qty: 4, ov: 'PRUEBA-SO-001044-5-2' }
];
const infos = cases.map(function (c, i) {
  if (i) doc.addPage([51, 19], 'landscape');
  const info = lay.draw(doc, c);
  check(info, c.ov);
  return info;
});
if (doc.internal.pageSize.getWidth() !== 51 || doc.internal.pageSize.getHeight() !== 19) {
  throw new Error('pagina ' + doc.internal.pageSize.getWidth() + 'x' + doc.internal.pageSize.getHeight());
}
const pdf = doc.output();
for (const w of words) if (!pdf.includes(w)) throw new Error('falta ' + w);
for (const ov of ['PRUEBA-SO-0001', 'PRUEBA-SO-001285-1', 'PRUEBA-SO-001285-2', 'PRUEBA-SO-001044-5-2']) {
  if (!pdf.includes(ov)) throw new Error('falta ' + ov);
}
if (infos[0].moduleMm < 0.19) throw new Error('modulo pdf');
const xml = lay.xml({ nombre: longName, sku, qty: 3, ov: 'PRUEBA-SO-001285-1' });
const sizes = xml.match(/Name>O<[\s\S]*?Size="(\d+)"|Name>SQ<[\s\S]*?Size="(\d+)"/g) || [];
if (!xml.includes('Size="8"') || !xml.includes('PRUEBA-SO-001285-1') || !xml.includes('Code128Auto')) throw new Error('xml');
writeFileSync('/opt/cursor/artifacts/etiq-clientes-prueba.pdf', Buffer.from(doc.output('arraybuffer')));

const html = readFileSync(join(root, 'index.html'), 'utf8');
const i = html.indexOf("if(t==='despacho')");
const desp = html.slice(i, i + 80);
if (!desp.includes('MCCliLay.xml')) throw new Error('xml despacho');
const bodega = html.slice(html.indexOf('else o=txt', i), html.indexOf('else o=txt', i) + 220);
if (!bodega.includes('bc(')) throw new Error('bodega sin barras');
const labels = html.slice(html.indexOf("kind==='labels'"), html.indexOf("kind==='labels'") + 400);
if (labels.includes('mcCode128')) throw new Error('labels sigue con el barcode viejo a todo el ancho');
if (!html.includes("MC_BUILD='561'")) throw new Error('build');
console.log('etiq-clientes-layout OK', cases.map(function (c, i) {
  return c.ov + ' lineas=' + infos[i].lines + ' pt=' + infos[i].skuPt + ' gap=' + infos[i].gap.toFixed(2);
}).join(' | '), 'zbar', sku);
