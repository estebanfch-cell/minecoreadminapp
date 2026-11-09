// Solicitudes de factura ya enviadas al grupo de Conta (app.wa_conta_outbox).
// No crea solicitudes ni toca stock. La lista de OV lee quién pidió y cuándo.
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
    const [me] = await q`select nombre, rol, coalesce(activo,true) activo from app.portal_users where lower(nombre)=lower(${c.u}) limit 1`;
    if (!me || me.activo === false || me.rol === "cliente" || me.rol === "proveedor") return out(req, { ok: false, error: "Sin permiso" });
    if (b.op !== "mapa") return out(req, { ok: false, error: "Operación no válida" });
    const filas = await q`select distinct on (w.so_id) w.so_id::text id, w.requested_at at, w.requested_by por,
      coalesce(nullif(trim(u.perfil->>'nombreCompleto'),''), nullif(trim(u.perfil->>'nombre_completo'),''), nullif(trim(rn.v->>lower(w.requested_by)),''), w.requested_by) nombre
      from app.wa_conta_outbox w
      join app.sales_orders s on s.id=w.so_id
      left join app.portal_users u on lower(u.nombre)=lower(w.requested_by)
      left join app.settings rn on rn.k='rp_nombres'
      where w.status in ('sent','pending') and coalesce(w.wa_message_id,'')<>''
        and not coalesce(s.is_invoiced,false) and coalesce(trim(s.factura_sri),'')=''
        and not coalesce(s.is_quote,false) and not coalesce(s.is_cancelled,false)
      order by w.so_id, w.requested_at desc nulls last, w.id desc
      limit 2000`;
    return out(req, { ok: true, filas });
  } catch (e) {
    return out(req, { ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});
