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
const STOP = new Set("de la el los las del con por una uno para en al y o x mm plg inch ft m serie minecore fmc tubo the of".split(" "));
const STRONG = /^(bushing|packing|ceramic|cylinder|split|piston|spiral|pin|zapata|lifter|ball|valve|seat|nut|plunger|ho3|no3|hwt|420|435|up24|5|10)$/;
function norm(t) {
  return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/(\d)\s*ft\b/g, "$1ft").replace(/[^a-z0-9]+/g, " ").trim();
}
function expand(t) {
  let s = " " + norm(t) + " ";
  const rep = [[/\bhq3\b/g, "ho3"], [/\bnq3\b/g, "no3"], [/\bpq3\b/g, "po3"], [/\bhq\b/g, "ho"], [/\bnq\b/g, "no"], [/\blaina\b/g, "laina split tube"], [/\bceramica\b/g, "ceramica ceramic"], [/\bcilindro\b/g, "cilindro cylinder"], [/\besfera\b/g, "esfera ball"], [/\btuerca\b/g, "tuerca nut plunger"], [/\bcanastillas?\b/g, "canastilla valve seat"], [/\bresorte\b/g, "resorte core lifter"], [/\bcasita\b/g, "casita core lifter case"], [/\bespiral\b/g, "espiral spiral"], [/\b5ft\b/g, "5ft 5"], [/\b10ft\b/g, "10ft 10"], [/\bup 2 4\b/g, "up24"]];
  rep.forEach(([a, b]) => { s = s.replace(a, " " + b + " "); });
  return s.replace(/\s+/g, " ").trim();
}
function toks(t) {
  const out = [];
  expand(t).split(" ").forEach((w) => {
    if (!w || STOP.has(w) || w.length < 2) return;
    if (/^\d+$/.test(w) && w !== "5" && w !== "10" && w.length !== 3) return;
    if (/^[a-z]\d{3,}$/.test(w)) return;
    out.push(w);
  });
  return [...new Set(out)];
}
function has(name, t) {
  const h = " " + norm(name) + " ";
  const hx = " " + expand(name) + " ";
  return h.includes(" " + t + " ") || hx.includes(" " + t + " ");
}
function scoreOne(tokens, name, qty, qline, reqPos) {
  const strong = tokens.filter((t) => STRONG.test(t));
  const sh = strong.filter((t) => has(name, t));
  const any = tokens.some((t) => has(name, t));
  if (!sh.length && !any) return 0;
  let s = strong.length ? sh.length / strong.length : 0.3;
  const extra = norm(name);
  const bag = " " + tokens.join(" ") + " ";
  ["plug", "ball", "case", "slotted"].forEach((w) => { if (extra.includes(w) && !bag.includes(" " + w + " ")) s -= 0.18; });
  if (qline && sh.length) {
    if (Math.abs(+qline.qty - +qty) < 0.01) s += 0.2;
    if (Math.abs(qline.pos - reqPos) <= 2) s += 0.08;
  }
  return Math.max(0, Math.min(0.99, s));
}
function proponer(lineas, quote, prods, ya) {
  const bySku = new Map(prods.map((p) => [p.sku, p]));
  const map = new Map();
  prods.forEach((p) => map.set(p.sku, { id: p.id, sku: p.sku, name: p.name, q: null }));
  quote.forEach((q) => {
    const p = bySku.get(q.sku);
    map.set(q.sku, { id: q.product_id || p?.id, sku: q.sku, name: q.name || p?.name || q.sku, q });
  });
  const cands = [...map.values()];
  const pairs = [];
  lineas.forEach((L, i) => {
    const tokens = toks(L.descripcion || "");
    cands.forEach((p) => {
      const s = scoreOne(tokens, p.name, L.qty, p.q, i);
      if (s >= 0.28) pairs.push({ i, sku: p.sku, name: p.name, id: p.id, s, on: !!p.q, qty: p.q ? +p.q.qty : null, pos: p.q ? p.q.pos : null });
    });
  });
  const used = new Set();
  return lineas.map((L, i) => {
    const prev = ya.get(String(L.codigo || "").toUpperCase());
    if (prev) {
      used.add(prev.sku);
      return { i, codigo: L.codigo, descripcion: L.descripcion || "", qty: L.qty, ya: true, confianza: 100, sku: prev.sku, nombre: prev.nombre || prev.sku, product_id: prev.product_id, en_cotizacion: quote.some((q) => q.sku === prev.sku), alternativas: [] };
    }
    const opts = pairs.filter((p) => p.i === i && !used.has(p.sku)).sort((a, b) => b.s - a.s);
    let pick = opts[0] || null;
    const q = opts.find((p) => p.on && Math.abs(+p.qty - +L.qty) < 0.01 && pick && p.s >= pick.s - 0.12);
    if (q) pick = q;
    if (pick) used.add(pick.sku);
    const alt = opts.filter((p) => !pick || p.sku !== pick.sku).slice(0, 3).map((p) => ({ sku: p.sku, nombre: p.name, product_id: p.id, confianza: Math.round(p.s * 100), en_cotizacion: p.on }));
    return { i, codigo: L.codigo, descripcion: L.descripcion || "", qty: L.qty, ya: false, confianza: pick ? Math.round(pick.s * 100) : 0, sku: pick?.sku || "", nombre: pick?.name || "", product_id: pick?.id || "", en_cotizacion: !!pick?.on, alternativas: alt };
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
    const rows = await sql`select sku, codigo from app.cliente_codigo where customer_id=${customer}::uuid and sku is not null order by codigo`;
    return out(req, { ok: true, codigos: rows });
  }
  if (!q.on) return out(req, { ok: false, error: "sin permiso" }, 403);
  if (b.op === "proponer" || b.op === "buscar") {
    const texto = String(b.q || b.descripcion || "");
    if (b.op === "buscar") {
      const prods = await sql`select id::text id, sku, name from app.products where coalesce(is_active, true)`;
      const tokens = toks(texto);
      const top = prods.map((p) => ({ id: p.id, sku: p.sku, nombre: p.name, s: scoreOne(tokens, p.name, 0, null, 99) })).filter((p) => p.s >= 0.28).sort((a, b) => b.s - a.s).slice(0, 8);
      return out(req, { ok: true, productos: top.map((p) => ({ id: p.id, sku: p.sku, nombre: p.nombre, confianza: Math.round(p.s * 100) })) });
    }
    const id = String(b.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return out(req, { ok: false, error: "cotización" }, 400);
    const [ord] = await sql`select id::text, customer_id::text cid, order_number, is_quote from app.sales_orders where id=${id}::uuid limit 1`;
    if (!ord || !ord.is_quote) return out(req, { ok: false, error: "abre una cotización" }, 400);
    const lineas = (Array.isArray(b.lineas) ? b.lineas : []).slice(0, 80).map((x) => ({ codigo: String(x.codigo || "").trim().toUpperCase().slice(0, 40), descripcion: String(x.descripcion || "").slice(0, 240), qty: +x.qty || 0 })).filter((x) => x.codigo);
    const ql = await sql`select product_id::text, sku, description as name, quantity::float qty from app.sales_order_lines where sales_order_id=${id}::uuid and coalesce(is_discarded,false)=false order by line_num`;
    const quote = ql.map((r, i) => ({ ...r, pos: i }));
    const codes = lineas.map((x) => x.codigo);
    const saved = codes.length ? await sql`select codigo, product_id::text, sku, (select name from app.products p where p.id=product_id) nombre from app.cliente_codigo where customer_id=${ord.cid}::uuid and upper(codigo) = any(${codes})` : [];
    const ya = new Map(saved.map((r) => [String(r.codigo).toUpperCase(), r]));
    const prods = await sql`select id::text id, sku, name from app.products where coalesce(is_active, true)`;
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
    return out(req, { ok: true, sku: p.sku, nombre: p.name, codigo });
  }
  return out(req, { ok: false, error: "op" }, 400);
});
