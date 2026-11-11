// Cruce de códigos del cliente. No crea órdenes ni mueve stock.
// El interruptor ~cot.codcli=1 se lee de la base. Un cliente solo recibe sus propios códigos.
import postgres from "npm:postgres@3.4.4";
const SECRET = Deno.env.get("SHEETS_SECRET");
let SQL = null;
const db = () => SQL ??= postgres(String(Deno.env.get("SUPABASE_DB_URL") || "").replace(/:5432\//, ":6543/"), {
  prepare: false, max: 1, idle_timeout: 5, connect_timeout: 10
});
const enc = new TextEncoder();
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
let KEY = null;
async function key() {
  if (KEY) return KEY;
  const k0 = await crypto.subtle.importKey("raw", enc.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const raw = new Uint8Array(await crypto.subtle.sign("HMAC", k0, enc.encode("minecore-portal-session-v1")));
  KEY = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return KEY;
}
async function verify(t) {
  const [p, s] = String(t || "").split(".");
  if (!p || !s) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify("HMAC", await key(), unb64u(s), enc.encode(p)); } catch { ok = false; }
  if (!ok) return null;
  const c = JSON.parse(new TextDecoder().decode(unb64u(p)));
  if (c.v !== 1 || !c.u || !c.r || !Array.isArray(c.m) || !(c.exp > Date.now() / 1000) || c.exp - c.iat > 3600) return null;
  return c;
}
const ORIG = new Set(["https://portal.minecore.ec", "https://clientes.minecore.ec", "https://estebanfch-cell.github.io"]);
function cors(req) {
  const o = req.headers.get("origin") || "";
  return { "access-control-allow-origin": ORIG.has(o) ? o : "https://portal.minecore.ec", "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "POST, OPTIONS", "content-type": "application/json" };
}
function out(req, body, st = 200) { return new Response(JSON.stringify(body), { status: st, headers: cors(req) }); }
async function quien(c) {
  const rows = await db()`select nombre, rol, modulos, coalesce(nullif(trim(perfil->>'nombreCompleto'),''), nullif(trim(perfil->>'nombre_completo'),''), nombre) completo, nullif(trim(perfil->>'empresa'),'') empresa from app.portal_users where upper(nombre)=upper(${c.u}) and coalesce(activo,true) limit 1`;
  const u = rows[0];
  if (!u) return null;
  const mods = Array.isArray(u.modulos) ? u.modulos : [];
  return { nombre: u.nombre, rol: u.rol, on: mods.indexOf("~cot.codcli=1") >= 0, completo: u.completo || u.nombre, empresa: u.empresa || "" };
}
const STOP = new Set("de la el los las del con por una uno para en al y o x mm plg inch ft m serie minecore fmc tubo the of balin plastico cabeza interior pescador muestra acero bronce".split(" "));
const FAM = [["bushing", ["bushing"]], ["packing", ["packing"]], ["cylinder", ["cylinder", "cilindro"]], ["laina", ["laina", "split"]], ["piston", ["piston"]], ["pin", ["spiral", "espiral"]], ["zapata", ["zapata"]], ["spring", ["spring", "resorte"]], ["ball", ["ball", "esfera"]], ["nut", ["nut", "tuerca"]]];
function base(t) {
  return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/(\d)\s*ft\b/g, "$1ft").replace(/[^a-z0-9]+/g, " ").trim();
}
function sizeNorm(s) { return (" " + s + " ").replace(/\b([bhnpt])q([0-9rwt]*)\b/g, "$1o$2").replace(/\s+/g, " ").trim(); }
function expand(t) {
  let s = " " + sizeNorm(base(t)) + " ";
  [[/\blaina\b/g, "laina split"], [/\bcilindro\b/g, "cilindro cylinder"], [/\bceramica\b/g, "ceramica ceramic"], [/\besfera\b/g, "esfera ball"], [/\btuerca\b/g, "tuerca nut"], [/\bespiral\b/g, "espiral spiral"], [/\bresorte\b/g, "resorte spring"], [/\b5ft\b/g, "5"], [/\b10ft\b/g, "10"], [/\bup 2 4\b/g, "up24"]].forEach(([a, b]) => { s = s.replace(a, " " + b + " "); });
  return s.replace(/\s+/g, " ").trim();
}
function hasWord(name, w) { return (" " + expand(name) + " ").includes(" " + w + " "); }
function families(text) {
  const w = new Set(expand(text).split(" "));
  return FAM.filter(([, ws]) => ws.some((x) => w.has(x))).map(([id]) => id);
}
function primary(text) {
  for (const w of expand(text).split(" ")) {
    const f = FAM.find(([, ws]) => ws.includes(w));
    if (f) return f[0];
  }
  return "";
}
function sizes(text) {
  const s = expand(text), found = [];
  const re = /\b(ho3|no3|po3|bo3|hor|nor|por|hwt|ntw|htw|btw|420|435|up24)\b/g;
  let m; while ((m = re.exec(s))) found.push(m[1]);
  if (!found.some((x) => /3$|r$/.test(x))) { const re2 = /\b(ho|no|po|bo)\b/g; while ((m = re2.exec(s))) found.push(m[1]); }
  if (/\b5\b/.test(s) && /split|laina/.test(s)) found.push("5");
  if (/\b10\b/.test(s) && /split|laina/.test(s)) found.push("10");
  return [...new Set(found)];
}
function scoreDesc(req, name) {
  const fam = primary(req);
  if (!fam || !families(name).includes(fam)) return 0;
  const rs = sizes(req), ps = new Set(sizes(name));
  const hard = rs.filter((x) => /3$|r$/.test(x) || ["hwt", "420", "435", "up24", "5", "10"].includes(x));
  if (hard.length && !hard.every((x) => ps.has(x))) return 0;
  const soft = rs.filter((x) => !hard.includes(x));
  const softUse = soft.length >= 2 ? [] : soft;
  if (!hard.length && softUse.length === 1 && !ps.has(softUse[0])) return 0;
  let hit = 1, tot = 1;
  hard.forEach((x) => { tot++; if (ps.has(x)) hit++; });
  softUse.forEach((x) => { tot++; if (ps.has(x)) hit++; });
  ["ceramic", "cylinder", "packing", "split", "spiral", "up24"].forEach((w) => { if (hasWord(req, w)) { tot++; if (hasWord(name, w)) hit++; } });
  ["plug", "latch", "case", "slotted", "broached", "pin", "ball"].forEach((w) => {
    if (hasWord(name, w) && !hasWord(req, w) && fam !== w && !(fam === "pin" && w === "pin") && !(fam === "ball" && w === "ball")) hit -= 0.55;
  });
  families(name).forEach((f) => { if (f !== fam && !families(req).includes(f)) hit -= 0.35; });
  return Math.max(0, Math.min(1, hit / tot));
}
function trozos(s) { return String(s || "").toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 4); }
function nums(s) { return (String(s || "").match(/\d[\d-]{4,}/g) || []).map((x) => x.replace(/-/g, "")).filter((x) => x.length >= 6); }
function parteHit(a, b) {
  const A = trozos(a), B = trozos(b);
  for (const x of A) if (B.includes(x)) return true;
  const na = nums(a), nb = nums(b);
  for (const x of na) for (const y of nb) if (x.includes(y) || y.includes(x)) return true;
  return false;
}
function scoreQuote(L, q, i) {
  const req = L.descripcion || "";
  let s = 0;
  if (parteHit(req, (q.codigo || "") + " " + (q.name || ""))) s += 0.72;
  s += scoreDesc(req, q.name || "") * 0.85;
  if (+L.qty && Math.abs(+q.qty - +L.qty) < 0.01) s += 0.14;
  s += Math.max(0, 0.06 - Math.abs((q.pos ?? 0) - i) * 0.008);
  return s;
}
function buscarCatalogo(q, prods) {
  const raw = String(q || "").trim().toUpperCase();
  const n = sizeNorm(base(q)).replace(/[^a-z0-9]+/g, "");
  if (n.length < 2 && raw.length < 2) return [];
  return prods.map((p) => {
    const sku = String(p.sku || "").toUpperCase();
    const bag = sizeNorm(base((p.name || "") + " " + (p.codigo || ""))).replace(/[^a-z0-9]+/g, "");
    let s = 0;
    if (sku === raw || sku.replace(/[^A-Z0-9]/g, "") === raw.replace(/[^A-Z0-9]/g, "")) s = 1;
    else if (raw && sku.includes(raw)) s = 0.92;
    else if (parteHit(raw, (p.codigo || "") + " " + (p.name || ""))) s = 0.86;
    else if (n && bag.includes(n)) s = 0.7;
    return { id: p.id, sku: p.sku, nombre: p.name, codigo: p.codigo || "", s };
  }).filter((p) => p.s > 0).sort((a, b) => b.s - a.s).slice(0, 12);
}
function proponer(lineas, quote, prods, ya) {
  const bySku = new Map(prods.map((p) => [p.sku, p]));
  const qlines = quote.map((q, n) => {
    const p = bySku.get(q.sku);
    return { sku: q.sku, name: q.name || p?.name || q.sku, id: q.product_id || p?.id, qty: +q.qty || 0, pos: q.pos ?? n, linea: q.line_num || n + 1, codigo: q.codigo || p?.codigo || "" };
  });
  const pairs = [];
  lineas.forEach((L, i) => {
    if (ya.get(String(L.codigo || "").toUpperCase())) return;
    qlines.forEach((q) => { const s = scoreQuote(L, q, i); if (s >= 0.35) pairs.push({ i, q, s }); });
  });
  pairs.sort((a, b) => b.s - a.s);
  const usedL = new Set(), usedQ = new Set(), pick = new Map();
  pairs.forEach((p) => { if (usedL.has(p.i) || usedQ.has(p.q.sku)) return; usedL.add(p.i); usedQ.add(p.q.sku); pick.set(p.i, p); });
  const altDe = (topSku) => qlines.filter((q) => q.sku !== topSku).slice(0, 6).map((q) => ({ sku: q.sku, nombre: q.name, product_id: q.id, confianza: 0, en_cotizacion: true, linea: q.linea }));
  return lineas.map((L, i) => {
    const prev = ya.get(String(L.codigo || "").toUpperCase());
    const en = (sku) => qlines.find((q) => q.sku === sku);
    if (prev) { const ql = en(prev.sku); return { i, codigo: L.codigo, descripcion: L.descripcion || "", qty: L.qty, ya: true, confianza: 100, sku: prev.sku, nombre: prev.nombre || prev.sku, product_id: prev.product_id, confirmado_por: prev.confirmado_por || "", confirmado_at: prev.confirmado_at || "", en_cotizacion: !!ql, linea: ql ? ql.linea : 0, alternativas: [] }; }
    const got = pick.get(i);
    if (got) {
      const q = got.q;
      const alt = [{ sku: q.sku, nombre: q.name, product_id: q.id, confianza: Math.round(Math.min(99, got.s * 100)), en_cotizacion: true, linea: q.linea }].concat(altDe(q.sku));
      return { i, codigo: L.codigo, descripcion: L.descripcion || "", qty: L.qty, ya: false, confianza: alt[0].confianza, sku: q.sku, nombre: q.name, product_id: q.id, en_cotizacion: true, linea: q.linea, alternativas: alt };
    }
    const ranked = prods.map((p) => ({ sku: p.sku, name: p.name, id: p.id, s: scoreDesc(L.descripcion || "", p.name) })).filter((p) => p.s > 0 && !usedQ.has(p.sku)).sort((a, b) => b.s - a.s);
    const top = ranked[0];
    const alt = ranked.slice(0, 8).map((p) => ({ sku: p.sku, nombre: p.name, product_id: p.id, confianza: Math.round(p.s * 100), en_cotizacion: false, linea: 0 }));
    return { i, codigo: L.codigo, descripcion: L.descripcion || "", qty: L.qty, ya: false, confianza: top ? Math.round(top.s * 100) : 0, sku: top?.sku || "", nombre: top?.name || "", product_id: top?.id || "", en_cotizacion: false, linea: 0, alternativas: alt };
  });
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return out(req, { ok: false, error: "método" }, 405);
  let b = {};
  try { b = await req.json(); } catch { b = {}; }
  const c = await verify(b.t);
  if (!c) return out(req, { ok: false, error: "sesión" }, 401);
  const q = await quien(c);
  if (!q) return out(req, { ok: false, error: "sesión" }, 401);
  const sql = db();
  if (b.op === "mios" || b.op === "mapa") {
    let customer = "";
    if (q.rol === "cliente") {
      const cs = await sql`select id::text id from app.customers where lower(trim(name))=lower(trim(${q.empresa})) limit 2`;
      if (cs.length !== 1) return out(req, { ok: true, codigos: [] });
      customer = cs[0].id;
    } else {
      if (!q.on) return out(req, { ok: false, error: "sin permiso" }, 403);
      customer = String(b.customer_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(customer)) return out(req, { ok: false, error: "cliente" }, 400);
    }
    const rows = await sql`select id::text, sku, codigo, descripcion, product_id::text, confirmado_por, confirmado_at, (select name from app.products p where p.id=product_id) nombre from app.cliente_codigo where customer_id=${customer}::uuid and sku is not null order by codigo`;
    return out(req, { ok: true, codigos: rows });
  }
  if (!q.on) return out(req, { ok: false, error: "sin permiso" }, 403);
  if (b.op === "proponer" || b.op === "buscar") {
    const texto = String(b.q || b.descripcion || "");
    if (b.op === "buscar") {
      const prods = await sql`select p.id::text id, p.sku, p.name, coalesce(v.codigo,'') codigo from app.products p left join lateral (select codigo from app.v_inventario_portal v where v.sku=p.sku limit 1) v on true where coalesce(p.is_active, true)`;
      return out(req, { ok: true, productos: buscarCatalogo(texto, prods).map((p) => ({ id: p.id, sku: p.sku, nombre: p.nombre, confianza: Math.round(p.s * 100) })) });
    }
    const id = String(b.id || "");
    const customerIn = String(b.customer_id || "");
    let ord = null;
    if (/^[0-9a-f-]{36}$/i.test(id)) {
      const [row] = await sql`select id::text, customer_id::text cid, order_number, is_quote from app.sales_orders where id=${id}::uuid limit 1`;
      if (!row || !row.is_quote) return out(req, { ok: false, error: "abre una cotización" }, 400);
      ord = row;
    } else if (/^[0-9a-f-]{36}$/i.test(customerIn)) ord = { id: "", cid: customerIn, order_number: "", is_quote: true };
    else return out(req, { ok: false, error: "cotización" }, 400);
    const lineas = (Array.isArray(b.lineas) ? b.lineas : []).slice(0, 80).map((x) => ({ codigo: String(x.codigo || "").trim().toUpperCase().slice(0, 40), descripcion: String(x.descripcion || "").slice(0, 240), qty: +x.qty || 0 })).filter((x) => x.codigo || x.descripcion);
    const ql = ord.id ? await sql`select l.product_id::text, l.sku, l.description as name, l.quantity::float qty, l.line_num, coalesce((select v.codigo from app.v_inventario_portal v where v.sku=l.sku limit 1),'') codigo from app.sales_order_lines l where l.sales_order_id=${ord.id}::uuid and coalesce(l.is_discarded,false)=false order by l.line_num` : [];
    const quote = ql.map((r, i) => ({ ...r, pos: i }));
    const codes = lineas.map((x) => x.codigo);
    const saved = codes.length ? await sql`select codigo, product_id::text, sku, confirmado_por, confirmado_at, (select name from app.products p where p.id=product_id) nombre from app.cliente_codigo where customer_id=${ord.cid}::uuid and upper(codigo) = any(${codes})` : [];
    const ya = new Map(saved.map((r) => [String(r.codigo).toUpperCase(), r]));
    const prods = await sql`select p.id::text id, p.sku, p.name, coalesce(v.codigo,'') codigo from app.products p left join lateral (select codigo from app.v_inventario_portal v where v.sku=p.sku limit 1) v on true where coalesce(p.is_active, true)`;
    return out(req, { ok: true, orden: ord.order_number, customer_id: ord.cid, lineas: proponer(lineas, quote, prods, ya) });
  }
  if (b.op === "confirmar") {
    const customer = String(b.customer_id || "");
    const codigo = String(b.codigo || "").trim().toUpperCase().slice(0, 40);
    const pid = String(b.product_id || "");
    const so = String(b.sales_order_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(customer) || !/^[0-9a-f-]{36}$/i.test(pid) || !codigo) return out(req, { ok: false, error: "datos" }, 400);
    const [p] = await sql`select id::text, sku, name from app.products where id=${pid}::uuid limit 1`;
    if (!p) return out(req, { ok: false, error: "ese producto no está en el inventario" }, 404);
    await sql`insert into app.cliente_codigo (customer_id, codigo, descripcion, product_id, sku, sales_order_id, confirmado_por)
      values (${customer}::uuid, ${codigo}, ${String(b.descripcion || "").slice(0, 240)}, ${pid}::uuid, ${p.sku}, ${/^[0-9a-f-]{36}$/i.test(so) ? so : null}::uuid, ${q.completo})
      on conflict (customer_id, codigo) do update set descripcion=excluded.descripcion, product_id=excluded.product_id, sku=excluded.sku, sales_order_id=excluded.sales_order_id, confirmado_por=excluded.confirmado_por, confirmado_at=now()`;
    await sql`insert into app.cliente_codigo_audit (actor, op, customer_id, codigo, data) values (${q.completo}, 'confirmar', ${customer}::uuid, ${codigo}, ${sql.json({ sku: p.sku, nombre: p.name, descripcion: String(b.descripcion || "").slice(0, 240) })})`;
    return out(req, { ok: true, sku: p.sku, nombre: p.name, codigo });
  }
  if (b.op === "borrar") {
    if (q.rol !== "admin") return out(req, { ok: false, error: "solo un administrador quita un cruce" }, 403);
    const customer = String(b.customer_id || "");
    const codigo = String(b.codigo || "").trim().toUpperCase().slice(0, 40);
    if (!/^[0-9a-f-]{36}$/i.test(customer) || !codigo) return out(req, { ok: false, error: "datos" }, 400);
    const prev = await sql`delete from app.cliente_codigo where customer_id=${customer}::uuid and upper(codigo)=${codigo} returning sku, product_id::text`;
    if (!prev.length) return out(req, { ok: false, error: "ese código no estaba guardado" }, 404);
    await sql`insert into app.cliente_codigo_audit (actor, op, customer_id, codigo, data) values (${q.completo}, 'borrar', ${customer}::uuid, ${codigo}, ${sql.json({ sku: prev[0].sku })})`;
    return out(req, { ok: true, codigo });
  }
  const admin = q.rol === "admin" && q.on;
  if (b.op === "ficha" || b.op === "indice" || b.op === "por_producto" || b.op === "editar") {
    if (!admin) return out(req, { ok: false, error: "sin permiso" }, 403);
  }
  if (b.op === "ficha") {
    const customer = String(b.customer_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(customer)) return out(req, { ok: false, error: "cliente" }, 400);
    const rows = await sql`select k.codigo, k.sku, k.descripcion, k.confirmado_por, k.confirmado_at, k.product_id::text, p.name nombre, (select order_number from app.sales_orders s where s.id=k.sales_order_id) cotizacion from app.cliente_codigo k left join app.products p on p.id=k.product_id where k.customer_id=${customer}::uuid order by k.codigo`;
    return out(req, { ok: true, codigos: rows });
  }
  if (b.op === "indice") {
    const rows = await sql`select k.codigo, k.sku, c.name cliente, coalesce(c.ruc,'') ruc from app.cliente_codigo k join app.customers c on c.id=k.customer_id where k.sku is not null order by k.codigo`;
    return out(req, { ok: true, codigos: rows });
  }
  if (b.op === "por_producto") {
    const pid = String(b.product_id || "");
    const sku = String(b.sku || "").trim();
    const rows = await sql`select c.name cliente, coalesce(c.ruc,'') ruc, k.codigo, k.sku from app.cliente_codigo k join app.customers c on c.id=k.customer_id where (${/^[0-9a-f-]{36}$/i.test(pid)} and k.product_id=${/^[0-9a-f-]{36}$/i.test(pid) ? pid : "00000000-0000-0000-0000-000000000000"}::uuid) or (${sku} <> '' and k.sku=${sku}) order by c.name, k.codigo`;
    return out(req, { ok: true, clientes: rows });
  }
  if (b.op === "editar") {
    const customer = String(b.customer_id || "");
    const antes = String(b.codigo || "").trim().toUpperCase().slice(0, 40);
    const nuevo = String(b.codigo_nuevo || antes).trim().toUpperCase().slice(0, 40);
    const pid = String(b.product_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(customer) || !antes || !nuevo) return out(req, { ok: false, error: "datos" }, 400);
    const [p] = /^[0-9a-f-]{36}$/i.test(pid) ? await sql`select id::text, sku, name from app.products where id=${pid}::uuid limit 1` : [null];
    if (pid && !p) return out(req, { ok: false, error: "ese producto no está en el inventario" }, 404);
    const desc = b.descripcion == null ? null : String(b.descripcion).slice(0, 240);
    const n = p
      ? await sql`update app.cliente_codigo set codigo=${nuevo}, descripcion=coalesce(${desc}, descripcion), product_id=${p.id}::uuid, sku=${p.sku}, confirmado_por=${q.completo}, confirmado_at=now() where customer_id=${customer}::uuid and upper(codigo)=${antes} returning sku`
      : await sql`update app.cliente_codigo set codigo=${nuevo}, descripcion=coalesce(${desc}, descripcion), confirmado_por=${q.completo}, confirmado_at=now() where customer_id=${customer}::uuid and upper(codigo)=${antes} returning sku`;
    if (!n.length) return out(req, { ok: false, error: "ese código no estaba guardado" }, 404);
    await sql`insert into app.cliente_codigo_audit (actor, op, customer_id, codigo, data) values (${q.completo}, 'editar', ${customer}::uuid, ${nuevo}, ${sql.json({ antes, sku: n[0].sku })})`;
    return out(req, { ok: true, codigo: nuevo, sku: n[0].sku });
  }
  return out(req, { ok: false, error: "op" }, 400);
});
