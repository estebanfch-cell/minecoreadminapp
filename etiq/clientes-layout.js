/* Vista legible 51×30 mm: 20 mm de nombre y 10 mm de código. El puente la gira al salir.
   Bodega no usa este archivo. */
(function (root) {
  'use strict';
  var W = 51, H = 30, MX = 1.5, SEAM = 20, PT = 25.4 / 72, MIN_MOD = 0.19, QUIET = 10, BAR_H = 6.2;
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
  /* Una sola fila, centrada: SKU, ×cantidad pegada y el SO completo.
     Los tres comparten el tamaño y se achican juntos hasta caber. */
  function place(doc, sku, qty, ov) {
    var gap = 1.15, sep = 2.4, maxW = W - MX * 2, sz, m, chosen = 3.4;
    function measure(sz) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(sz);
      return { sw: doc.getTextWidth(sku), qw: doc.getTextWidth(qty), ow: doc.getTextWidth(ov) };
    }
    for (sz = 8.2; sz >= 3.4; sz = Math.round((sz - 0.1) * 100) / 100) {
      m = measure(sz);
      if (m.sw + gap + m.qw + sep + m.ow <= maxW + 0.05) { chosen = sz; break; }
    }
    m = measure(chosen);
    var rowW = m.sw + gap + m.qw + sep + m.ow;
    var x0 = (W - rowW) / 2;
    return {
      lines: 1, skuPt: chosen, ovPt: chosen, qtyPt: chosen,
      skuX: x0, skuW: m.sw, qtyX: x0 + m.sw + gap, qtyW: m.qw,
      ovX: x0 + m.sw + gap + m.qw + sep, ovW: m.ow,
      gap: gap, sep: sep, rowW: rowW
    };
  }
  function draw(doc, d) {
    d = d || {};
    var nombre = String(d.nombre || ''), sku = String(d.sku || ''), ov = String(d.ov || ''), qty = qtyText(d.qty);
    var bar = fit(sku), idn = place(doc, sku, qty, ov);
    var barY = SEAM + 1.6, ySku = SEAM - 2.2, yOv = ySku;
    var nameTop = 0.6, nameBottom = ySku - idn.skuPt * PT * 0.85 - 0.45, maxW = W - MX * 2;
    var nameH = Math.max(2.6, nameBottom - nameTop);
    var size = 8.6, lines, lh, wide;
    doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold');
    while (size >= 2.8) {
      doc.setFontSize(size); lines = doc.splitTextToSize(nombre, maxW); lh = lead(size);
      wide = lines.some(function (line) { return doc.getTextWidth(String(line)) > maxW + 0.05; });
      if (!wide && lines.length * lh <= nameH) break;
      size = Math.round((size - 0.1) * 100) / 100;
    }
    if (size < 2.8) size = 2.8;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(size);
    lines = doc.splitTextToSize(nombre, maxW); lh = lead(size);
    var blockH = lines.length * lh;
    var slack = nameH - blockH;
    var y = nameTop + (slack > 0 ? slack / 2 : 0) + size * PT * 0.78;
    var nameY = y;
    lines.forEach(function (line) { doc.text(String(line), W / 2, y, { align: 'center' }); y += lh; });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(idn.skuPt);
    doc.text(sku, idn.skuX, ySku);
    doc.setFontSize(idn.qtyPt); doc.text(qty, idn.qtyX, ySku);
    doc.setFontSize(idn.ovPt); doc.text(ov, idn.ovX, yOv);
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
    return {
      page: { w: W, h: H }, nameLines: lines, namePt: size, moduleMm: bar.module, quiet: QUIET, barH: BAR_H,
      sku: sku, qty: qty, ov: ov, clipped: false, lines: idn.lines,
      skuPt: idn.skuPt, ovPt: idn.ovPt, qtyPt: idn.qtyPt,
      skuX: idn.skuX, skuW: idn.skuW, qtyX: idn.qtyX, qtyW: idn.qtyW, ovX: idn.ovX, ovW: idn.ovW,
      gap: idn.qtyX - (idn.skuX + idn.skuW), sep: idn.ovX - (idn.qtyX + idn.qtyW),
      rowMid: idn.skuX + idn.rowW / 2, ySku: ySku, yOv: yOv, nameY: nameY, nameBottom: y - lh
    };
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function tw(mm) { return Math.round(mm / 25.4 * 1440); }
  function piece(n, s, x, y, w, h, sz, bold, al) {
    return '<ObjectInfo><TextObject><Name>' + n + '</Name><ForeColor Alpha="255" Red="0" Green="0" Blue="0"/><BackColor Alpha="0" Red="255" Green="255" Blue="255"/><LinkedObjectName></LinkedObjectName><Rotation>Rotation0</Rotation><IsMirrored>False</IsMirrored><IsVariable>False</IsVariable><HorizontalAlignment>' + (al || 'Left') + '</HorizontalAlignment><VerticalAlignment>Middle</VerticalAlignment><TextFitMode>ShrinkToFit</TextFitMode><UseFullFontHeight>True</UseFullFontHeight><Verticalized>False</Verticalized><StyledText><Element><String>' + esc(s) + '</String><Attributes><Font Family="Arial" Size="' + sz + '" Bold="' + (bold ? 'True' : 'False') + '" Italic="False" Underline="False" Strikeout="False"/><ForeColor Alpha="255" Red="0" Green="0" Blue="0"/></Attributes></Element></StyledText></TextObject><Bounds X="' + tw(x) + '" Y="' + tw(y) + '" Width="' + tw(w) + '" Height="' + tw(h) + '"/></ObjectInfo>';
  }
  function el(text, sz) {
    return '<Element><String>' + esc(text) + '</String><Attributes><Font Family="Arial" Size="' + sz + '" Bold="True" Italic="False" Underline="False" Strikeout="False"/><ForeColor Alpha="255" Red="0" Green="0" Blue="0"/></Attributes></Element>';
  }
  function codes(sku, qty, ov) {
    var sz = 8;
    return '<ObjectInfo><TextObject><Name>SQ</Name><ForeColor Alpha="255" Red="0" Green="0" Blue="0"/><BackColor Alpha="0" Red="255" Green="255" Blue="255"/><LinkedObjectName></LinkedObjectName><Rotation>Rotation0</Rotation><IsMirrored>False</IsMirrored><IsVariable>False</IsVariable><HorizontalAlignment>Center</HorizontalAlignment><VerticalAlignment>Middle</VerticalAlignment><TextFitMode>ShrinkToFit</TextFitMode><UseFullFontHeight>True</UseFullFontHeight><Verticalized>False</Verticalized><StyledText>' + el(sku, sz) + el(' ' + qty, sz) + el('   ' + ov, sz) + '</StyledText></TextObject><Bounds X="' + tw(1.5) + '" Y="' + tw(9.0) + '" Width="' + tw(48) + '" Height="' + tw(2.7) + '"/></ObjectInfo>';
  }
  function xml(L) {
    var q = qtyText(L && L.qty), sku = L && L.sku || '';
    var quiet = tw(1.6);
    return piece('N', L && L.nombre, 1.5, 0.7, 48, 8.0, 10, true, 'Center') +
      codes(sku, q, L && L.ov || '') +
      '<ObjectInfo><BarcodeObject><Name>BC</Name><ForeColor Alpha="255" Red="0" Green="0" Blue="0"/><BackColor Alpha="0" Red="255" Green="255" Blue="255"/><LinkedObjectName></LinkedObjectName><Rotation>Rotation0</Rotation><IsMirrored>False</IsMirrored><IsVariable>False</IsVariable><Text>' + esc(sku) + '</Text><Type>Code128Auto</Type><Size>Medium</Size><TextPosition>None</TextPosition><TextFont Family="Arial" Size="6" Bold="False" Italic="False" Underline="False" Strikeout="False"/><CheckSumFont Family="Arial" Size="6" Bold="False" Italic="False" Underline="False" Strikeout="False"/><TextEmbedding>None</TextEmbedding><ECLevel>0</ECLevel><HorizontalAlignment>Center</HorizontalAlignment><QuietZonesPadding Left="' + quiet + '" Top="0" Right="' + quiet + '" Bottom="0"/></BarcodeObject><Bounds X="' + tw(1.5) + '" Y="' + tw(12.3) + '" Width="' + tw(48) + '" Height="' + tw(5.6) + '"/></ObjectInfo>';
  }
  root.MCCliLay = { W: W, H: H, MIN_MOD: MIN_MOD, QUIET: QUIET, BAR_H: BAR_H, encode: encode, symbol: symbol, fit: fit, draw: draw, xml: xml, qtyText: qtyText };
})(typeof window !== 'undefined' ? window : globalThis);
