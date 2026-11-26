/* Parser genérico de solicitudes de cotización / pedidos de cliente.
   Sin DOM. Usable en Node (tests) y en el navegador (MCCodCli.parsear).
   No inventa códigos MCOR. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MCSolicitudParse = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var CODE_RE = /(?:[A-Z]{1,6}\.)?\d{2}\.\d{2}\.[A-Z0-9]{2,8}\.\d{3,5}/i;
  var MCOR_RE = /\bMCOR\s*[-]?\s*0*(\d{1,6})\b/gi;
  var QTY_UNIT_RE = /([\d]{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(Unidad(?:es)?|Und\.?|PZA[S]?|Pcs?|EA|FT|MTS?|M\b|LITROS?|GAL(?:ONES)?|KG|JGO|JUEGO|SET|PAR)?/i;
  var SKIP_LINE = /^(gesti[oó]n|solicitud|datos de|solicita\b|proveedor\b|ruc\b|direcci[oó]n\b|contacto\b|solicitante\b|tel[eé]fono\b|correo\b|fecha\b|n[oº°]\.?$|nuestro c[oó]digo|descripci[oó]n$|su c[oó]digo|cantidad|cant\.?$|unidad$|c[oó]digo$|p[aá]gina\b|minecore\s*sas)/i;

  function normMcor(s) {
    var m = String(s || "").toUpperCase().replace(/\s+/g, "").match(/^MCOR-?0*(\d{1,6})$/);
    if (!m) {
      var m2 = String(s || "").toUpperCase().match(/MCOR\s*[-]?\s*0*(\d{1,6})/);
      if (!m2) return "";
      return "MCOR" + m2[1].padStart(6, "0");
    }
    return "MCOR" + m[1].padStart(6, "0");
  }

  function parseQty(s) {
    if (s == null || s === "") return null;
    var t = String(s).trim().replace(/\s/g, "");
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ""));
    if (/^\d{1,3}(,\d{3})+$/.test(t)) return Number(t.replace(/,/g, ""));
    if (/^\d+,\d+$/.test(t)) return Number(t.replace(",", "."));
    var n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  function tidy(s) {
    return String(s || "")
      .replace(/\bMINECORE\b/ig, " ")
      .replace(/[|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractMeta(text) {
    var t = String(text || "");
    var doc = (t.match(/\b(COT[-–]?\s*\d+|OC[-–]?\s*\d+|PO[-–]?\s*\d+|#\s*\d{3,})\b/i) || [])[0] || null;
    if (doc) doc = doc.replace(/\s+/g, "").toUpperCase().replace("COT–", "COT-");
    var fecha = null;
    var fm = t.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
    if (fm) {
      var y = fm[3].length === 2 ? "20" + fm[3] : fm[3];
      fecha = y + "-" + fm[2].padStart(2, "0") + "-" + fm[1].padStart(2, "0");
    }
    var decl = null;
    var dm = t.match(/(\d{1,4})\s*[ií]tems\b/i) || t.match(/\b(\d{1,4})\s*l[ií]neas\b/i);
    if (dm) decl = +dm[1];
    return { documento: doc, fecha: fecha, items_declarados: decl };
  }

  function findMcor(chunk) {
    MCOR_RE.lastIndex = 0;
    var last = "", m;
    while ((m = MCOR_RE.exec(chunk))) last = "MCOR" + m[1].padStart(6, "0");
    return last;
  }

  function stripCodes(chunk, codigo, mcor) {
    var s = " " + chunk + " ";
    if (codigo) s = s.replace(new RegExp("\\s" + codigo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s", "i"), " ");
    if (mcor) s = s.replace(new RegExp("\\sMCOR\\s*[-]?\\s*0*" + String(Number(mcor.replace(/\D/g, ""))) + "\\s", "i"), " ");
    s = s.replace(/\bSu c[oó]digo\b/ig, " ").replace(/\bNuestro c[oó]digo\b/ig, " ");
    return tidy(s);
  }

  function cleanFooter(s) {
    return String(s || "")
      .replace(/\bFormato\s+\S+.*$/i, " ")
      .replace(/\bP[aá]gina\s+\d+\s+de\b.*$/i, " ")
      .replace(/\bCant\.?\s*Unidad\b/ig, " ")
      .trim();
  }

  function qtyFromChunk(chunk, mcor) {
    var s = cleanFooter(String(chunk || "").replace(/\s+/g, " ").trim());
    var unitPrefer = "(Unidad(?:es)?|Und\\.?)";
    var unitOther = "(PZA[S]?|Pcs?|EA|FT|MTS?|KG|JGO|JUEGO|SET|PAR)";
    var num = "([\\d]{1,3}(?:[.,]\\d{3})+|\\d+(?:[.,]\\d+)?)";
    function plausible(raw) {
      var q = parseQty(raw);
      if (q == null || q <= 0) return false;
      if (/^\d{7,}$/.test(String(raw).replace(/[.,]/g, ""))) return false;
      if (q >= 1000000) return false;
      return true;
    }
    function okBefore(idx) {
      var before = s.slice(Math.max(0, idx - 16), idx);
      return !/P\/N|n\.?º|parte|despiece/i.test(before);
    }
    function first(re) {
      var src = re.source, flags = re.flags.indexOf("g") >= 0 ? re.flags : re.flags + "g";
      var r = new RegExp(src, flags);
      var m;
      while ((m = r.exec(s))) {
        if (m[0] === "") { r.lastIndex++; continue; }
        if (!okBefore(m.index) || !plausible(m[1])) continue;
        return { qty: parseQty(m[1]), unidad: (m[2] || "Unidad").replace(/\.$/, ""), match: m[0] };
      }
      return null;
    }
    if (mcor) {
      var got = first(new RegExp(mcor.replace(/(\d+)$/, "0*$1") + "\\s+" + num + "\\s+" + unitPrefer, "i"));
      if (got) return got;
    }
    var prefer = first(new RegExp(num + "\\s+" + unitPrefer + "\\b", "gi"));
    if (prefer) return prefer;
    if (mcor) {
      var got2 = first(new RegExp(mcor.replace(/(\d+)$/, "0*$1") + "\\s+" + num + "\\s+" + unitOther, "i"));
      if (got2) return got2;
    }
    var other = first(new RegExp(num + "\\s+" + unitOther + "\\b", "gi"));
    return other || { qty: null, unidad: null, match: "" };
  }

  function qtyFromTail(chunk) { return qtyFromChunk(chunk, findMcor(chunk)); }

  function starts() {
    return new RegExp("(?:^|[\\s])(\\d{1,3})\\s+(" + CODE_RE.source + ")", "gi");
  }

  function parseByItems(text) {
    var src = String(text || " ").replace(/\u00a0/g, " ");
    var re = starts();
    var hits = [], m;
    while ((m = re.exec(" " + src))) {
      var n = +m[1];
      if (n < 1 || n > 999) continue;
      hits.push({ n: n, codigo: String(m[2]).toUpperCase(), index: m.index, end: m.index + m[0].length });
    }
    if (hits.length < 2) return [];
    // Keep the longest increasing run of item numbers (1,2,3…), allowing small gaps.
    var best = [], cur = [];
    hits.forEach(function (h, i) {
      if (!cur.length || h.n === cur[cur.length - 1].n + 1 || (h.n > cur[cur.length - 1].n && h.n - cur[cur.length - 1].n <= 2)) {
        cur.push(h);
      } else {
        if (cur.length > best.length) best = cur;
        cur = [h];
      }
      if (i === hits.length - 1 && cur.length > best.length) best = cur;
    });
    if (best.length < 2) return [];
    // Prefer a run that starts at 1 when possible
    var runFrom1 = [];
    cur = [];
    hits.forEach(function (h) {
      if (!cur.length) {
        if (h.n === 1) cur = [h];
        return;
      }
      if (h.n === cur[cur.length - 1].n + 1 || (h.n > cur[cur.length - 1].n && h.n - cur[cur.length - 1].n <= 2)) cur.push(h);
      else if (h.n === 1) {
        if (cur.length > runFrom1.length) runFrom1 = cur;
        cur = [h];
      }
    });
    if (cur.length > runFrom1.length) runFrom1 = cur;
    if (runFrom1.length >= 2 && runFrom1.length + 2 >= best.length) best = runFrom1;

    var rows = [];
    for (var i = 0; i < best.length; i++) {
      var h = best[i];
      var sliceEnd = i + 1 < best.length ? best[i + 1].index : src.length + 1;
      var chunk = (" " + src).slice(h.end, sliceEnd);
      var mcor = findMcor(chunk);
      var q = qtyFromChunk(chunk, mcor);
      var desc = cleanFooter(String(chunk || "").replace(/\s+/g, " "));
      if (q.match) desc = desc.replace(q.match, " ");
      desc = stripCodes(desc, h.codigo, mcor);
      desc = desc.replace(/^\d{1,3}\s+/, "").replace(/\s+\d{1,3}$/, "");
      if (q.qty != null) {
        var qre = new RegExp("\\s+" + String(q.qty).replace(/\\./g, "\\.") + "\\s*(Unidad(?:es)?|Und\\.?)?\\s*$", "i");
        desc = desc.replace(qre, " ");
      }
      desc = tidy(desc);
      rows.push({
        n: h.n,
        codigo: h.codigo,
        mcor: mcor || "",
        descripcion: desc,
        qty: q.qty,
        unidad: q.unidad
      });
    }
    return rows;
  }

  // Legacy / Kluane: one physical line, code NN.NN.XXX.NNNN, qty at end.
  function parseLineByLine(text) {
    var out = [];
    String(text || "").split(/\r?\n/).forEach(function (line) {
      var raw = tidy(line);
      if (!raw || /^[—\-_=.\s]+$/.test(raw) || SKIP_LINE.test(raw)) return;
      var mcor = findMcor(raw);
      var code = "", rest = raw;
      var cm = raw.match(CODE_RE);
      if (cm) {
        code = String(cm[0]).toUpperCase();
        rest = tidy(raw.slice(0, cm.index) + " " + raw.slice(cm.index + cm[0].length));
      } else {
        // Kluane OCR typo-tolerant pattern (2.2.3.4)
        var k = raw.match(/([0-9OQDSBILZG]{2}[.\s][0-9OQDSBILZG]{2}[.\s][A-Z0-9]{3}[.\s][0-9OQDSBILZG]{4})/i);
        if (k) {
          code = k[1].toUpperCase().replace(/\s+/g, ".");
          rest = tidy(raw.slice(0, k.index) + " " + raw.slice(k.index + k[1].length));
        }
      }
      if (mcor) rest = stripCodes(rest, "", mcor);
      var q = qtyFromChunk(rest, mcor);
      if (q.match) rest = tidy(rest.replace(q.match, " "));
      rest = cleanFooter(rest);
      if (q.qty == null && (code || mcor)) {
        var qm = rest.match(/(?:^|\s)(\d{1,4})\s*$/);
        if (qm) { q.qty = +qm[1]; q.unidad = q.unidad || null; rest = rest.slice(0, qm.index).trim(); }
      }
      if (!code && !mcor && !q.unidad) q.qty = null;
      rest = tidy(rest.replace(/^\d{1,3}\s+/, ""));
      if (!code && !mcor && !rest) return;
      if (!code && !mcor && SKIP_LINE.test(rest)) return;
      if (!code && !mcor && /c[oó]digo|descripci[oó]n|cantidad|cant\.?/i.test(rest) && rest.length < 40) return;
      out.push({ n: out.length + 1, codigo: code, mcor: mcor || "", descripcion: rest, qty: q.qty, unidad: q.unidad });
    });
    return out;
  }

  function parseMcorAnchored(text) {
    var src = String(text || "");
    var re = /\bMCOR\s*[-]?\s*0*(\d{1,6})\b/gi;
    var hits = [], m;
    while ((m = re.exec(src))) hits.push({ mcor: "MCOR" + m[1].padStart(6, "0"), index: m.index, end: m.index + m[0].length });
    if (hits.length < 2) return [];
    var rows = [];
    for (var i = 0; i < hits.length; i++) {
      var from = i ? hits[i - 1].end : Math.max(0, hits[i].index - 240);
      var chunk = src.slice(from, hits[i].end + 40);
      var cm = chunk.match(new RegExp("(" + CODE_RE.source + ")\\s+(?:.*)$", "i"));
      // take last client code before this MCOR
      var codes = chunk.match(new RegExp(CODE_RE.source, "gi")) || [];
      var codigo = codes.length ? codes[codes.length - 1].toUpperCase() : "";
      var q = qtyFromChunk(src.slice(hits[i].end, hits[i].end + 80), hits[i].mcor);
      var desc = cleanFooter(chunk);
      if (q.match) desc = desc.replace(q.match, " ");
      desc = stripCodes(desc, codigo, hits[i].mcor);
      desc = desc.replace(/^\d{1,3}\s+/, "");
      rows.push({ n: i + 1, codigo: codigo, mcor: hits[i].mcor, descripcion: desc, qty: q.qty, unidad: q.unidad });
    }
    return rows;
  }

  function calidad(rows, meta) {
    var n = (rows || []).length;
    if (!n) return 0;
    var keys = rows.filter(function (r) { return r.mcor || r.codigo; }).length;
    var qtys = rows.filter(function (r) { return r.qty != null && r.qty > 0; }).length;
    var score = (keys / n) * 0.6 + (qtys / n) * 0.3;
    if (meta && meta.items_declarados) {
      var ratio = n / meta.items_declarados;
      if (ratio >= 0.9 && ratio <= 1.05) score += 0.1;
      else if (ratio < 0.7) score -= 0.2;
    }
    return Math.max(0, Math.min(1, score));
  }

  function parseCsv(text) {
    var raw = String(text || "").replace(/^\uFEFF/, "");
    var lines = raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (lines.length < 2) return [];
    var delim = (lines[0].split(";").length > lines[0].split(",").length) ? ";" : ",";
    if ((lines[0].split(delim).length) < 3) return [];
    function cells(line) {
      var out = [], cur = "", q = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (ch === '"') { q = !q; continue; }
        if (!q && ch === delim) { out.push(cur.trim()); cur = ""; continue; }
        cur += ch;
      }
      out.push(cur.trim());
      return out;
    }
    var head = cells(lines[0]).map(function (h) { return h.toLowerCase(); });
    var named = head.some(function (h) { return /c[oó]digo|descrip|mcor|cant|qty|unidad|sku/.test(h); });
    function idx(re, fallback) { for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i; return fallback; }
    var iN = idx(/^n|^item|^#|n[oº]/, 0);
    var iCod = idx(/c[oó]digo(?!.*mcor)|nuestro|cliente|ref/, 1);
    var iDesc = idx(/descrip|producto|detalle/, 2);
    var iMcor = idx(/mcor|su c[oó]digo|sku|nuestro minecore/, named ? -1 : 3);
    var iQty = idx(/cant|qty|cantidad/, named ? -1 : 4);
    var iUni = idx(/unidad|unit|und/, named ? -1 : 5);
    var rows = [], start = named ? 1 : 0;
    for (var r = start; r < lines.length; r++) {
      var c = cells(lines[r]);
      if (c.every(function (x) { return !x; })) continue;
      var blob = c.join(" ");
      var codigo = (iCod >= 0 && c[iCod] && CODE_RE.test(c[iCod]) ? String(c[iCod]).toUpperCase() : (blob.match(CODE_RE) || [""])[0].toUpperCase());
      var mcor = normMcor((iMcor >= 0 && c[iMcor]) ? c[iMcor] : findMcor(blob));
      var desc = (iDesc >= 0 ? c[iDesc] : "") || stripCodes(blob, codigo, mcor);
      var qty = parseQty(iQty >= 0 ? c[iQty] : "") || qtyFromChunk(blob, mcor).qty;
      var unidad = (iUni >= 0 && c[iUni]) ? c[iUni] : qtyFromChunk(blob, mcor).unidad;
      if (!codigo && !mcor && !tidy(desc)) continue;
      if (named && /c[oó]digo|descrip|cant/.test(desc) && !mcor && r === 0) continue;
      rows.push({ n: parseInt(c[iN], 10) || rows.length + 1, codigo: codigo, mcor: mcor || "", descripcion: tidy(desc), qty: qty, unidad: unidad || null });
    }
    return rows;
  }

  function parseSolicitud(text) {
    var meta = extractMeta(text);
    var byItems = parseByItems(text);
    var byLine = parseLineByLine(text);
    var byCsv = parseCsv(text);
    var pick = byItems, metodo = "items";
    function consider(rows, name) {
      if (calidad(rows, meta) > calidad(pick, meta) + 0.05) { pick = rows; metodo = name; }
    }
    consider(byLine, "lineas");
    consider(byCsv, "csv");
    if (calidad(pick, meta) < 0.55) consider(parseMcorAnchored(text), "mcor");
    return { lineas: pick, meta: meta, calidad: calidad(pick, meta), metodo: metodo };
  }

  function parserOk(result, kind) {
    if (kind === "image") return false;
    if (!result || !result.lineas || !result.lineas.length) return false;
    if (result.calidad < 0.7) return false;
    var n = result.lineas.length;
    var keys = result.lineas.filter(function (r) { return r.mcor || r.codigo; }).length;
    if (keys < n * 0.5) return false;
    if (result.meta && result.meta.items_declarados && n < result.meta.items_declarados * 0.8) return false;
    return true;
  }

  // Old parser (Kluane-only, one physical line) — for regression contrast in tests, not used live.
  function parsearViejo(text) {
    var out = [];
    String(text || "").split(/\n/).forEach(function (line) {
      var raw = line.replace(/\bMINECORE\b/ig, " ").replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
      if (!raw || /^[—\-_=.\s]+$/.test(raw)) return;
      var m = raw.match(/([0-9OQDSBILZG]{2}[.\s][0-9OQDSBILZG]{2}[.\s][A-Z0-9]{3}[.\s][0-9OQDSBILZG]{4})/i), code = "", rest = raw;
      if (m) { code = m[1]; rest = (raw.slice(0, m.index) + " " + raw.slice(m.index + m[1].length)).replace(/\s+/g, " ").trim(); }
      var qty = null, qm = code ? rest.match(/(?:^|\s)(\d{1,4})\s*$/) : null;
      if (qm) { qty = +qm[1]; rest = rest.slice(0, qm.index).trim(); }
      if (!code && !rest) return;
      if (!code && /^(c[oó]digo|descripci[oó]n|cantidad|cant\.?)$/i.test(rest)) return;
      out.push({ codigo: code, descripcion: rest, qty: qty });
    });
    return out;
  }

  return { parseSolicitud: parseSolicitud, parsear: function (t) { return parseSolicitud(t).lineas; }, parserOk: parserOk, normMcor: normMcor, parseQty: parseQty, extractMeta: extractMeta, parsearViejo: parsearViejo, calidad: calidad };
});
