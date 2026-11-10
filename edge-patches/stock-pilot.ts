// Stock Pilot: propuesta solo EFCH. Venta puntual: admin, no toca stock ni precios.
import postgres from "npm:postgres@3.4.4";
const SECRET = Deno.env.get("SHEETS_SECRET");
let SQL = null;
const db = () => SQL ??= postgres(String(Deno.env.get("SUPABASE_DB_URL") || "").replace(/:5432\//, ":6543/"), {
  prepare: false, max: 1, idle_timeout: 5, connect_timeout: 30
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
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return out(req, { ok: false, error: "POST" }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const c = await verify(b.t);
    if (!c) return out(req, { ok: false, error: "Sesión vencida. Vuelve a entrar." }, 401);
    const q = db();
    const [rv] = await q`select extract(epoch from max(at))::float x from app.portal_revocations where nombre in (${c.u}, '*')`;
    if (rv?.x && rv.x >= c.iat) return out(req, { ok: false, error: "Sesión revocada" }, 401);
    const [me] = await q`select nombre, rol, coalesce(activo,true) activo from app.portal_users where lower(nombre)=lower(${c.u}) limit 1`;
    if (!me || me.activo === false || me.rol === "cliente" || me.rol === "proveedor") return out(req, { ok: false, error: "Sin permiso" }, 403);
    const op = String(b.op || "propuesta");
    if (op === "propuesta") {
      if (String(me.nombre).toUpperCase() !== "EFCH") return out(req, { ok: false, error: "Stock Pilot está solo para EFCH." }, 403);
      const vid = /^[0-9a-f-]{36}$/i.test(String(b.vendor_id || "")) ? String(b.vendor_id) : null;
      const regla = b.regla_tuberia === false ? false : true;
      const [row] = vid
        ? await q`select app.stock_pilot_propuesta(${vid}::uuid, ${regla}) j`
        : await q`select app.stock_pilot_propuesta(null, ${regla}) j`;
      const j = row?.j || {};
      return out(req, Object.assign({ ok: true }, j));
    }
    if (me.rol !== "admin") return out(req, { ok: false, error: "Solo un administrador puede marcar venta puntual." }, 403);
    if (op === "flags") {
      const id = String(b.id || "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return out(req, { ok: false, error: "Orden no válida" }, 400);
      const rows = await q`select id::text id, coalesce(venta_puntual,false) venta_puntual from app.sales_order_lines where sales_order_id=${id}::uuid`;
      const flags = {};
      for (const r of rows) flags[r.id] = !!r.venta_puntual;
      return out(req, { ok: true, flags });
    }
    if (op === "set") {
      const lid = String(b.line_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(lid)) return out(req, { ok: false, error: "Línea no válida" }, 400);
      const valor = !!b.valor;
      const [ln] = await q`update app.sales_order_lines set venta_puntual=${valor}, venta_puntual_por=${me.nombre}, venta_puntual_at=now() where id=${lid}::uuid returning id::text id, sales_order_id, venta_puntual, sku, quantity`;
      if (!ln) return out(req, { ok: false, error: "Línea no encontrada" }, 404);
      await q`insert into app.so_audit(actor, op, sales_order_id, data) values (${me.nombre}, 'venta_puntual', ${ln.sales_order_id}, ${q.json({ line_id: ln.id, sku: ln.sku, cantidad: ln.quantity, venta_puntual: valor })})`;
      return out(req, { ok: true, venta_puntual: ln.venta_puntual, line_id: ln.id });
    }
    return out(req, { ok: false, error: "Acción desconocida" }, 400);
  } catch (e) {
    return out(req, { ok: false, error: String(e?.message || e) }, 500);
  }
});
