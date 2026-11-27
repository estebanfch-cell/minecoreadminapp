#!/usr/bin/env node
/* b735: cabecera/filas de cobranza comparten columnas; volver de ficha no abre el Inventario viejo. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function assert(cond, msg) { if (!cond) throw new Error(msg); }

assert(/var MC_BUILD='735'/.test(html), 'MC_BUILD debe ser 735');

const m = html.match(/var AG=\[(\['por_vencer','Por vencer','#6fd68f','pv'\],\['d1_30','1–30','#f0c040','d1'\],\['d31_60','31–60','#f59e42','d31'\],\['d61_90','61–90','#e07a5c','d61'\],\['d90','\+90','#e05c5c','d90'\])\];/);
assert(m, 'AG de CxcSb debe incluir claves de grid-area');

assert(html.includes('grid-template-areas:"n cli pv d1 d31 d61 d90 saldo" ". act act act act act act act"'), 'misma plantilla de áreas en todo el escritorio');
assert(!html.includes('grid-template-areas:"n cli pv d1 d31 d61 d90 saldo act"'), 'sin 9.ª columna de max-content (desalineaba cabecera vs cuerpo)');
assert(!/\.cx-row\{[^}]*max-content/.test(html), 'sin max-content en la grilla .cx-row');
assert(!html.includes('.cx-hrow>span:last-child{display:none}'), 'ya no ocultar el último th a mano');
assert(html.includes('cx-c-'+'n') && html.includes('class="cx-c-n">#</span>'), 'cabecera # con área');
assert(html.includes('cx-c-cli">Cliente'), 'cabecera Cliente con área');
assert(html.includes("class=\"cx-c-'+a[3]+' r\""), 'cabecera y montos usan a[3] (misma definición)');
assert(html.includes('cx-c-saldo r">Saldo</span><span class="cx-c-act"></span>'), 'cabecera Saldo + placeholder (oculto en escritorio)');
assert(!html.includes('<span class="r">Saldo</span><span></span>'), 'sin celda vacía suelta en la cabecera');
assert(html.includes('class="cx-c-n cbz-muted"') && html.includes('class="cx-c-cli cx-n"'), 'cuerpo # y Cliente con las mismas áreas');
assert(html.includes('class="cx-c-saldo r"') && html.includes('class="cx-c-act cx-act"'), 'cuerpo Saldo y acciones con área');
assert(html.includes("CxcSb.mas(") && html.includes("Mostrando '+lim+' de '+C.length+' · Cargar más:"), 'pie Cargar más intacto');

assert(!html.includes("window._mcProdInv=(typeof mcEsCliV==='function'&&mcEsCliV())?0:1"), 'abrir vprod ya no marca _mcProdInv');
assert(!html.includes("mod==='vprod'&&!(typeof mcEsCliV==='function'&&mcEsCliV())?'inv'"), 'la ruta #/vprod ya no se reescribe a #/inv');
assert(html.includes('function pfVolverLista()'), 'existe pfVolverLista');
assert(/volver:function\(\)\{var fromInv=!!window\._mcProdInv;window\._mcProdInv=0;PF\.cur=null;if\(fromInv&&typeof mcEsCliV==='function'&&mcEsCliV\(\)\)\{openMod\('inv'\);return;\}pfVolverLista\(\);\}/.test(html), 'volver: cliente → inv, interno → lista de productos');
assert(!/volver:function\(\)\{if\(window\._mcProdInv\)\{window\._mcProdInv=0;PF\.cur=null;openMod\('inv'\);return;\}/.test(html), 'volver ya no abre inv para usuarios internos');
assert(html.includes('PF.cur=null;pfVolverLista();'), '_☰ vuelve a la lista sin pfInit');
assert(!html.includes("['📊','Stock actual','stock',I,function(){openMod('inv');},'inventario']"), 'Stock actual salió del menú interno');
assert(html.includes("add('vprod','📦','Inventario'"), 'mosaico Inicio interno abre vprod');
assert(html.includes("if(!_cli&&can('inventario')) add('vprod'"), 'solo el mosaico interno cambió a vprod');
assert(html.includes("gI.items.push(['📦','Inventario',function(){openMod('inv');}])"), 'menú del cliente sigue en su Inventario');
assert(html.includes("if(typeof mcEsCliV==='function'&&mcEsCliV()){openMod('inv');"), 'búsqueda rápida del cliente sigue en inv');
assert(html.includes("if(p.id){openMod('vprod');(function t(n){if(window.MCProd&&MCProd.abrirId)MCProd.abrirId(p.id);"), 'búsqueda rápida interna abre la ficha en vprod');

console.log('ok cxc-inv-b735');
