/**
 * Acta de entrega-recepción: encabezado Desde → Hacia en pastillas de color,
 * sin la lista de sububicaciones. El botón Acta PDF y WhatsApp usan MCInflowDoc.
 *   node --test tests/acta-flecha.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');

test('fuente: pastillas, flecha y Hacia sin sububicaciones', () => {
  assert.match(html, /var MC_BUILD='720'/);
  assert.match(sw, /var SWV='b720'/);
  assert.match(html, /function actaRuta\(/);
  assert.match(html, /function actaBadge\(/);
  assert.match(html, /function locColor\(/);
  assert.match(html, /else ya=actaRuta\(mt,d\.desde,d\.hacia,d\.entregado\)/);
  assert.match(html, /hacia:d\.destino\|\|''/);
  assert.doesNotMatch(html, /hacia:\(d\.destino\|\|''\)\+\(hs\?/);
  const pdfAt = html.indexOf('function actaPdf()');
  const pdf = html.slice(pdfAt, pdfAt + 2200);
  assert.doesNotMatch(pdf, /var hs=L\.map/);
  assert.match(pdf, /MCInflowDoc\('acta'/);
  assert.match(html, /onclick="Stk\.actaPdf\(\)"/);
  assert.match(html, /MCWa\.sib\(this\)/);
  // hoja de conteo sigue pasando grid:[] y no entra a actaRuta
  const hoja = html.slice(html.indexOf('function hojaPdf'), html.indexOf('function hojaPdf') + 1800);
  assert.match(hoja, /grid:\s*\[\]/);
});

test('colores fijos y deterministas', () => {
  const start = html.indexOf('function locColor(name)');
  const fn = html.slice(start, html.indexOf('function locTint', start));
  assert.match(fn, /consignacion[\s\S]*\[176,88,12\]/);
  assert.match(fn, /bodega principal[\s\S]*\[40,92,36\]/);
  assert.match(fn, /pal=/);
});
