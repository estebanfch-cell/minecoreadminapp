// Indicador de atraso de la OV. Solo lee y escribe plazo_entrega_dias. No toca stock, entregas ni otras órdenes.
// Sesión = el mismo token de portal-api. El interruptor ~ov.atraso=1 se lee de la base, no del token.
import postgres from "npm:postgres@3.4.4";
const SECRET = Deno.env.get("SHEETS_SECRET");
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
async function quien(c) {
  const rows = await db()`select nombre, rol, modulos from app.portal_users where upper(nombre)=upper(${c.u}) limit 1`;
  const u = rows[0];
  if (!u) return null;
  const mods = Array.isArray(u.modulos) ? u.modulos : [];
  return { nombre: u.nombre, rol: u.rol, on: mods.indexOf("~ov.atraso=1") >= 0 };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return out(req, { ok: false, error: "método" }, 405);
  let b = {};
  try { b = await req.json(); } catch { b = {}; }
  const c = await verify(b.t);
  if (!c) return out(req, { ok: false, error: "sesión" }, 401);
  const q = await quien(c);
  if (!q || !q.on) return out(req, { ok: false, error: "sin permiso" }, 403);
  if (b.op === "ver") {
    const rows = await db()`
      select id::text as id, plazo_entrega_dias::int as dias
      from app.sales_orders
      where is_quote is not true
        and is_cancelled is not true
        and coalesce(estado,'') <> 'cancelada'
        and entregado_at is null
        and plazo_entrega_dias is not null
        and plazo_entrega_dias > 0`;
    return out(req, { ok: true, filas: rows });
  }
  if (b.op === "guardar") {
    if (q.rol !== "admin") return out(req, { ok: false, error: "solo un administrador edita el plazo" }, 403);
    const id = String(b.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return out(req, { ok: false, error: "orden" }, 400);
    let dias = b.dias;
    if (dias === "" || dias === null || dias === undefined) dias = null;
    else {
      dias = parseInt(dias, 10);
      if (!(dias >= 1 && dias <= 365)) return out(req, { ok: false, error: "el plazo va de 1 a 365 días" }, 400);
    }
    const prev = await db()`select id, order_number, plazo_entrega_dias from app.sales_orders where id=${id}::uuid and is_quote is not true limit 1`;
    if (!prev[0]) return out(req, { ok: false, error: "no es una orden de venta" }, 404);
    await db()`update app.sales_orders set plazo_entrega_dias=${dias} where id=${id}::uuid`;
    await db()`insert into app.so_audit (actor, op, sales_order_id, data)
      values (${q.nombre}, 'plazo_entrega', ${id}::uuid, ${db.json({ antes: prev[0].plazo_entrega_dias, despues: dias, numero: prev[0].order_number })})`;
    return out(req, { ok: true, dias, numero: prev[0].order_number });
  }
  return out(req, { ok: false, error: "op" }, 400);
});
