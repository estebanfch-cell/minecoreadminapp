/* Clientes 51×19 mm (perfil PDF ya usado). Barras Code128 compactas del SKU canónico.
   El alto no sale de una foto. Bodega no usa este archivo. */
(function (root) {
  'use strict';
  var W = 51, H = 19, MX = 1.5, MY = 1.0, PT = 25.4 / 72, MIN_MOD = 0.19, QUIET = 10, BAR_H = 6.2;
  var PAT = ["212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112"];
  function encode(text) {
    text = String(text || '');
    function digitsAt(i) { var n = 0; while (i + n < text.length && text.charCodeAt(i + n) >= 48 && text.charCodeAt(i + n) <= 57) n++; return n; }
    var codes = [], i = 0, set = digitsAt(0) >= 4 ? 'C' : 'B';
    codes.push(set === 'C' ? 105 : 104);
    while (i < text.length) {
      var d = digitsAt(i);
      if (set === 'B' && d >= 4) { if (d % 2 === 1) { codes.push(text.charCodeAt(i) - 32); i++; } codes.push(99); set = 'C'; continue; }
      if (set === 'C' && d < 2) { codes.push(100); set = 'B'; continue; }
      if (set === 'C') { codes.push(parseInt(text.substr(i, 2), 10)); i += 2; }
      else { var c = text.charCodeAt(i); if (c < 32 || c > 126) c = 32; codes.push(c - 32); i++; }
    }
    var sum = codes[0], k; for (k = 1; k < codes.length; k++) sum += codes[k] * k;
    codes.push(sum % 103); codes.push(106); return codes;
  }
  function symbol(text) {
    var codes = encode(text), mods = 0, pats = [], i, k, p;
    for (i = 0; i < codes.length; i++) { p = PAT[codes[i]] || ''; pats.push(p); for (k = 0; k < p.length; k++) mods += +p[k]; }
    return { codes: codes, pats: pats, mods: mods, quiet: QUIET };
  }
  function fit(text) {
    var sym = symbol(text), maxW = W - MX * 2, need = sym.mods + QUIET * 2;
    var module = maxW / need;
    if (module < MIN_MOD) module = MIN_MOD;
    return { sym: sym, module: module, barW: sym.mods * module, quietMm: QUIET * module, totalW: need * module };
  }
  function lead(size) { return size * PT * 1.15; }
  function qtyText(q) {
    var n = typeof q === 'number' ? q : parseFloat(String(q == null ? '' : q).replace(',', '.'));
    var s = !isFinite(n) ? String(q == null ? '' : q) : (Math.abs(n - Math.round(n)) < 1e-6 ? String(Math.round(n)) : String(Math.round(n * 100) / 100));
    return '\u00d7' + s;
  }
  function fitW(doc, text, font, size, min, maxW) {
    var s = size; doc.setFont('helvetica', font);
    while (s > min) { doc.setFontSize(s); if (doc.getTextWidth(text) <= maxW + 0.01) return s; s = Math.round((s - 0.15) * 100) / 100; }
    doc.setFontSize(min); return min;
  }
  function draw(doc, d) {
    d = d || {};
    var nombre = String(d.nombre || ''), sku = String(d.sku || ''), ov = String(d.ov || ''), qty = qtyText(d.qty);
    var bar = fit(sku), barY = H - MY - BAR_H, nameTop = MY, nameH = 7.2, maxW = W - MX * 2;
    var size = 9.2, lines, lh;
    doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold');
    while (size >= 4.8) {
      doc.setFontSize(size); lines = doc.splitTextToSize(nombre, maxW); lh = lead(size);
      if (lines.length * lh <= nameH) break;
      size = Math.round((size - 0.2) * 100) / 100;
    }
    if (size < 4.8) size = 4.8;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(size);
    lines = doc.splitTextToSize(nombre, maxW); lh = lead(size);
    if (lines.length * lh > nameH) lh = nameH / Math.max(lines.length, 1);
    var y = nameTop + size * PT * 0.78;
    lines.forEach(function (line) { doc.text(String(line), MX, y); y += lh; });
    var foot = barY - 0.7;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    var qW = doc.getTextWidth(qty);
    var ovSize = fitW(doc, ov, 'bold', 7, 4.6, 18);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(ovSize);
    var ovW = doc.getTextWidth(ov), qtyX = W - MX - ovW - 1.3 - qW;
    var skuSize = fitW(doc, sku, 'bold', 8.2, 5, Math.max(8, qtyX - MX - 1));
    doc.setFont('helvetica', 'bold'); doc.setFontSize(skuSize); doc.text(sku, MX, foot);
    doc.setFontSize(10); doc.text(qty, qtyX, foot);
    doc.setFontSize(ovSize); doc.text(ov, W - MX, foot, { align: 'right' });
    var x = (W - bar.totalW) / 2 + bar.quietMm;
    doc.setFillColor(0, 0, 0);
    bar.sym.pats.forEach(function (p) {
      var black = true, k, ww;
      for (k = 0; k < p.length; k++) {
        ww = (+p[k]) * bar.module;
        if (black && ww > 0) doc.rect(x, barY, ww, BAR_H, 'F');
        x += ww; black = !black;
      }
    });
    return { page: { w: W, h: H }, nameLines: lines, namePt: size, moduleMm: bar.module, quiet: QUIET, barH: BAR_H, sku: sku, qty: qty, ov: ov, clipped: false };
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function tw(mm) { return Math.round(mm / 25.4 * 1440); }
  function piece(n, s, x, y, w, h, sz, bold, al) {
    return '<ObjectInfo><TextObject><Name>' + n + '</Name><ForeColor Alpha="255" Red="0" Green="0" Blue="0"/><BackColor Alpha="0" Red="255" Green="255" Blue="255"/><LinkedObjectName></LinkedObjectName><Rotation>Rotation0</Rotation><IsMirrored>False</IsMirrored><IsVariable>False</IsVariable><HorizontalAlignment>' + (al || 'Left') + '</HorizontalAlignment><VerticalAlignment>Middle</VerticalAlignment><TextFitMode>ShrinkToFit</TextFitMode><UseFullFontHeight>True</UseFullFontHeight><Verticalized>False</Verticalized><StyledText><Element><String>' + esc(s) + '</String><Attributes><Font Family="Arial" Size="' + sz + '" Bold="' + (bold ? 'True' : 'False') + '" Italic="False" Underline="False" Strikeout="False"/><ForeColor Alpha="255" Red="0" Green="0" Blue="0"/></Attributes></Element></StyledText></TextObject><Bounds X="' + tw(x) + '" Y="' + tw(y) + '" Width="' + tw(w) + '" Height="' + tw(h) + '"/></ObjectInfo>';
  }
  function xml(L) {
    var q = qtyText(L && L.qty), sku = L && L.sku || '';
    var quiet = tw(1.6);
    return piece('N', L && L.nombre, 1.5, 0.6, 48, 7.2, 11, true) +
      piece('S', sku, 1.5, 7.8, 22, 3.4, 9, true) +
      piece('Q', q, 24, 7.6, 10, 3.6, 13, true, 'Center') +
      piece('O', L && L.ov, 34, 7.9, 15.5, 3.3, 8, true, 'Right') +
      '<ObjectInfo><BarcodeObject><Name>BC</Name><ForeColor Alpha="255" Red="0" Green="0" Blue="0"/><BackColor Alpha="0" Red="255" Green="255" Blue="255"/><LinkedObjectName></LinkedObjectName><Rotation>Rotation0</Rotation><IsMirrored>False</IsMirrored><IsVariable>False</IsVariable><Text>' + esc(sku) + '</Text><Type>Code128Auto</Type><Size>Medium</Size><TextPosition>None</TextPosition><TextFont Family="Arial" Size="6" Bold="False" Italic="False" Underline="False" Strikeout="False"/><CheckSumFont Family="Arial" Size="6" Bold="False" Italic="False" Underline="False" Strikeout="False"/><TextEmbedding>None</TextEmbedding><ECLevel>0</ECLevel><HorizontalAlignment>Center</HorizontalAlignment><QuietZonesPadding Left="' + quiet + '" Top="0" Right="' + quiet + '" Bottom="0"/></BarcodeObject><Bounds X="' + tw(1.5) + '" Y="' + tw(11.6) + '" Width="' + tw(48) + '" Height="' + tw(BAR_H) + '"/></ObjectInfo>';
  }
  root.MCCliLay = { W: W, H: H, MIN_MOD: MIN_MOD, QUIET: QUIET, BAR_H: BAR_H, encode: encode, symbol: symbol, fit: fit, draw: draw, xml: xml, qtyText: qtyText };
})(typeof window !== 'undefined' ? window : globalThis);
