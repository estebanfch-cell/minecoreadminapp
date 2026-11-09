// Traslado interno dentro de Bodega principal. No toca consignación ni inFlow.
// Solo quien tiene ~inv.e.ubicar=1. Registra el documento, el stock y la auditoría con el nombre completo.
import postgres from "npm:postgres@3.4.4";
const SECRET = Deno.env.get("SHEETS_SECRET");
const BP = "a4b0d9f6-9544-4200-aefa-43ed6c027484";
let SQL = null;
const db = ()=>SQL ??= postgres(String(Deno.env.get("SUPABASE_DB_URL") || "").replace(/:5432\//, ":6543/"), {
  prepare: false, max: 1, idle_timeout: 5, connect_timeout: 10
});
const enc = new TextEncoder();
const unb64u = (s)=>Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c)=>c.charCodeAt(0));
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
  return {
    "access-control-allow-origin": ORIG.has(o) ? o : "https://portal.minecore.ec",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "POST, OPTIONS",
    "content-type": "application/json"
  };
}
function out(req, body, st = 200) {
  return new Response(JSON.stringify(body), { status: st, headers: cors(req) });
}
function nomDe(me) {
  const p = me.perfil || {};
  const n = String(p.nombreCompleto || p.nombre_completo || "").trim();
  return n || String(me.nombre || "");
}
function subDe(s) {
  return String(s || "").trim().toUpperCase().replace(/\s+/g, " ").slice(0, 40);
}
function consign(s) {
  return /CONSIG/i.test(String(s || ""));
}
function tsEC(d) {
  try {
    return new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d)).replace(",", "") + " (EC)";
  } catch {
    return new Date(d).toISOString();
  }
}
async function detalle(q, id) {
  const [p] = await q`select p.id::text id, p.sku, p.name, coalesce(p.track_serials,false) series from app.products p where p.id=${id}::uuid`;
  if (!p) return null;
  const filas = await q`select upper(trim(coalesce(s.sublocation,''))) sub, sum(s.quantity)::float q, max(s.updated_at) at
    from app.stock_levels s where s.product_id=${id}::uuid and s.location_id=${BP}::uuid and s.serial=''
    group by 1 having sum(s.quantity)<>0 order by 2 desc, 3 desc nulls last`;
  const catalogo = await q`select upper(trim(code)) code from app.sublocations where location_id=${BP}::uuid and coalesce(is_active,true) and coalesce(trim(code),'')<>'' order by 1`;
  const [man] = await q`select upper(trim(coalesce(default_sublocation,''))) sub from app.product_reorder where product_id=${id}::uuid and location_id=${BP}::uuid and coalesce(trim(default_sublocation),'')<>'' order by 1 limit 1`;
  const vivas = filas.filter((x)=>Number(x.q) > 0 && !consign(x.sub));
  vivas.sort((a, b)=>Number(b.q) - Number(a.q) || String(b.at || "").localeCompare(String(a.at || "")));
  const auto = vivas[0]?.sub || filas.filter((x)=>!consign(x.sub)).sort((a, b)=>String(b.at || "").localeCompare(String(a.at || "")))[0]?.sub || "";
  const manual = man && !consign(man.sub) ? man.sub : "";
  return {
    id: p.id, sku: p.sku, nombre: p.name, series: !!p.series,
    filas: filas.map((x)=>({ sub: x.sub, q: Number(x.q) })),
    subs: catalogo.map((x)=>x.code).filter((c)=>!consign(c)),
    predeterminada: manual || auto,
    manual: !!manual,
    auto
  };
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return out(req, { ok: false, error: "POST" }, 405);
  try {
    const b = await req.json().catch(()=>({}));
    const c = await verify(b.t);
    if (!c) return out(req, { ok: false, error: "Sesión vencida. Vuelve a entrar." }, 401);
    const q = db();
    const [rv] = await q`select extract(epoch from max(at))::float x from app.portal_revocations where nombre in (${c.u}, '*')`;
    if (rv?.x && rv.x >= c.iat) return out(req, { ok: false, error: "Sesión revocada" }, 401);
    const [me] = await q`select nombre, rol, modulos, perfil, coalesce(activo,true) activo from app.portal_users where lower(nombre)=lower(${c.u}) limit 1`;
    if (!me || me.activo === false || me.rol === "cliente" || me.rol === "proveedor") return out(req, { ok: false, error: "Sin permiso" });
    const mods = me.modulos || [];
    if (!mods.includes("~inv.e.ubicar=1")) return out(req, { ok: false, error: "Sin permiso para cambiar ubicación" });
    const actor = String(me.nombre);
    const nombre = nomDe(me);
    if (b.op === "buscar") {
      const qq = String(b.q || "").trim();
      if (qq.length < 2) return out(req, { ok: true, productos: [] });
      const rows = await q`select p.id::text id, p.sku, p.name from app.products p
        where coalesce(p.is_active,true) and (
          upper(p.sku)=upper(${qq})
          or exists (select 1 from app.product_barcodes bc where bc.product_id=p.id and upper(bc.barcode)=upper(${qq}))
          or p.sku ilike ${"%" + qq + "%"} or p.name ilike ${"%" + qq + "%"}
          or exists (select 1 from app.product_barcodes bc where bc.product_id=p.id and bc.barcode ilike ${"%" + qq + "%"})
        )
        order by (upper(p.sku)=upper(${qq})) desc, p.sku limit 12`;
      return out(req, { ok: true, productos: rows });
    }
    if (b.op === "ver") {
      const id = String(b.id || "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return out(req, { ok: false, error: "Producto no válido" });
      const d = await detalle(q, id);
      if (!d) return out(req, { ok: false, error: "Producto no existe" });
      return out(req, { ok: true, producto: d, nombre });
    }
    if (b.op !== "mover") return out(req, { ok: false, error: "Operación no válida" });
    const id = String(b.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return out(req, { ok: false, error: "Producto no válido" });
    const desde = subDe(b.desde);
    const hasta = subDe(b.hasta);
    const qty = Number(b.qty);
    const fijar = !!b.predeterminada;
    if (!hasta) return out(req, { ok: false, error: "Elige o escribe la sububicación destino" });
    if (consign(hasta)) return out(req, { ok: false, error: "Consignación no es una sububicación de Bodega principal" });
    if (desde === hasta) return out(req, { ok: false, error: "El destino es el mismo lugar" });
    if (!(qty > 0)) return out(req, { ok: false, error: "Escribe la cantidad" });
    const ahora = new Date();
    const res = await q.begin(async (t)=>{
      const [p] = await t`select id, sku, name, coalesce(track_serials,false) series from app.products where id=${id}::uuid for update`;
      if (!p) throw new Error("Producto no existe");
      const [ser] = await t`select 1 from app.stock_levels where product_id=${id}::uuid and location_id=${BP}::uuid and upper(trim(coalesce(sublocation,'')))=${desde} and serial<>'' and quantity>0 limit 1`;
      if (p.series || ser) throw new Error("Este producto tiene series. El traslado rápido no lo mueve.");
      const [orig] = await t`select coalesce(sum(quantity),0)::float q from app.stock_levels where product_id=${id}::uuid and location_id=${BP}::uuid and upper(trim(coalesce(sublocation,'')))=${desde} and serial=''`;
      if (Number(orig?.q || 0) + 1e-9 < qty) throw new Error("No hay suficiente stock en " + (desde || "sin sububicación"));
      await t`insert into app.sublocations (location_id, code, is_active)
        select ${BP}::uuid, ${hasta}, true
        where not exists (select 1 from app.sublocations where location_id=${BP}::uuid and upper(trim(code))=${hasta})`;
      const u = await t`update app.stock_levels set quantity=quantity-${qty}, updated_at=now()
        where product_id=${id}::uuid and location_id=${BP}::uuid and upper(trim(coalesce(sublocation,'')))=${desde} and serial=''
        returning quantity::float q`;
      if (!u.length || u.some((x)=>Number(x.q) < -1e-6)) throw new Error("No se pudo descontar el origen");
      const d = await t`update app.stock_levels set quantity=quantity+${qty}, updated_at=now()
        where product_id=${id}::uuid and location_id=${BP}::uuid and upper(trim(coalesce(sublocation,'')))=${hasta} and serial='' returning 1`;
      if (!d.length) await t`insert into app.stock_levels (product_id, location_id, sublocation, serial, quantity, updated_at)
        values (${id}::uuid, ${BP}::uuid, ${hasta}, '', ${qty}, now())`;
      const [num] = await t`select app.doc_next('ST') n`;
      const [doc] = await t`insert into app.inv_docs (tipo, number, location_id, to_location_id, remarks, estado, sync_status, created_by, created_at, completed_at)
        values ('transfer', ${num.n}, ${BP}::uuid, ${BP}::uuid, ${"Cambio de ubicación · " + nombre}, 'completado', 'solo_minecore', ${actor}, ${ahora}, ${ahora})
        returning id`;
      await t`insert into app.inv_doc_lines (doc_id, line_num, product_id, quantity, from_sub, to_sub)
        values (${doc.id}, 1, ${id}::uuid, ${qty}, ${desde}, ${hasta})`;
      await t`insert into app.stock_local_moves (actor, product_id, location_id, sublocation, delta, kind, doc_id, status, nota)
        values (${actor}, ${id}::uuid, ${BP}::uuid, ${desde}, ${-qty}, 'transfer', ${doc.id}, 'aplicado', ${nombre})`;
      await t`insert into app.stock_local_moves (actor, product_id, location_id, sublocation, delta, kind, doc_id, status, nota)
        values (${actor}, ${id}::uuid, ${BP}::uuid, ${hasta}, ${qty}, 'transfer', ${doc.id}, 'aplicado', ${nombre})`;
      if (fijar) {
        const upd = await t`update app.product_reorder set default_sublocation=${hasta} where product_id=${id}::uuid and location_id=${BP}::uuid returning product_id`;
        if (!upd.length) await t`insert into app.product_reorder (product_id, location_id, default_sublocation) values (${id}::uuid, ${BP}::uuid, ${hasta})`;
        await t`update app.products set default_sublocation=${hasta}, default_location_id=coalesce(default_location_id, ${BP}::uuid), updated_at=now()
          where id=${id}::uuid and (default_location_id is null or default_location_id=${BP}::uuid)`;
      }
      await t`insert into app.audit_log (actor, accion, tabla, ref_id, detalle)
        values (${actor}, 'ubicar', 'inv_docs', ${doc.id}, ${t.json({ nombre, sku: p.sku, desde, hasta, qty, predeterminada: fijar, number: num.n })})`;
      return { number: num.n };
    });
    const d = await detalle(q, id);
    return out(req, { ok: true, number: res.number, nombre, at: tsEC(ahora), desde, hasta, qty, predeterminada: fijar, producto: d });
  } catch (e) {
    return out(req, { ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});
