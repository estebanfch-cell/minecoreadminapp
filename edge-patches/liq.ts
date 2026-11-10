// Liquidación pública (token) y generación solo para EFCH.
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
function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization, apikey",
    "access-control-allow-methods": "POST, OPTIONS",
    "content-type": "application/json"
  };
}
function out(body, st = 200) {
  return new Response(JSON.stringify(body), { status: st, headers: cors() });
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return out({ ok: false, error: "POST" }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const action = String(b.action || b.op || "");
    const q = db();
    if (action === "liqGet" || action === "liqSubmit") {
      const token = String(b.token || "").trim().toLowerCase();
      if (action === "liqGet") {
        const [row] = await q`select app.liq_get(${token}) j`;
        return out(row?.j || { ok: false, error: "Enlace no válido." });
      }
      if (String(b.hp_x9 || "").trim()) return out({ ok: true, n: 0, total: 0 });
      const lineas = Array.isArray(b.lineas) ? b.lineas : [];
      const [row] = await q`select app.liq_submit(${token}, ${q.json(lineas)}, ${String(b.contacto || "").slice(0, 80)}) j`;
      return out(row?.j || { ok: false, error: "No se pudo enviar." });
    }
    const c = await verify(b.t);
    if (!c) return out({ ok: false, error: "Sesión vencida. Vuelve a entrar." }, 401);
    const [rv] = await q`select extract(epoch from max(at))::float x from app.portal_revocations where nombre in (${c.u}, '*')`;
    if (rv?.x && rv.x >= c.iat) return out({ ok: false, error: "Sesión revocada" }, 401);
    const [me] = await q`select nombre, rol, coalesce(activo,true) activo from app.portal_users where lower(nombre)=lower(${c.u}) limit 1`;
    if (!me || me.activo === false) return out({ ok: false, error: "Sin permiso" }, 403);
    if (String(me.nombre).toUpperCase() !== "EFCH") return out({ ok: false, error: "Generar el enlace de liquidación está solo para EFCH." }, 403);
    if (action !== "generar" && action !== "refrescar") return out({ ok: false, error: "Acción desconocida" }, 400);
    const nombre = String(b.cliente || "").trim();
    if (!nombre) return out({ ok: false, error: "Falta el cliente" }, 400);
    const dias = Math.max(1, Math.min(365, parseInt(b.dias, 10) || 30));
    const clientes = await q`select id::text id from app.customers where lower(trim(name))=lower(${nombre})`;
    if (clientes.length !== 1) return out({ ok: false, error: clientes.length ? "Hay más de un cliente con ese nombre." : "Cliente no encontrado." }, 404);
    const [row] = action === "refrescar"
      ? await q`select app.liq_refrescar(${clientes[0].id}::uuid) j`
      : await q`select app.liq_generar(${clientes[0].id}::uuid, ${dias}, ${me.nombre}) j`;
    if (action === "refrescar" && row?.j && row.j.sin_oleada) {
      const [g] = await q`select app.liq_generar(${clientes[0].id}::uuid, ${dias}, ${me.nombre}) j`;
      return out(g?.j || { ok: false, error: "Sin respuesta" });
    }
    const j = row?.j || { ok: false, error: "Sin respuesta" };
    if (j && typeof j === "object") delete j.precios;
    return out(j);
  } catch (e) {
    return out({ ok: false, error: String(e?.message || e) }, 500);
  }
});
