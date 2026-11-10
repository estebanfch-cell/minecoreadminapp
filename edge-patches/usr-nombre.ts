// Nombre completo de un usuario del portal. Solo EFCH lo cambia.
// No reescribe actas, entregas ni avisos ya guardados: el portal resuelve el nombre al mostrarlo.
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
function limpio(s) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, 120);
}
function valido(s) {
  if (!s) return true;
  return s.length >= 5 && s.length <= 120 && /\s/.test(s) && /^[\p{L}][\p{L}\p{M} .'-]+$/u.test(s);
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
    if (b.op === "mapa") {
      const filas = await q`select nombre u, trim(perfil->>'nombreCompleto') n
        from app.portal_users
        where coalesce(trim(perfil->>'nombreCompleto'),'')<>'' and coalesce(origen,'')<>'borrado'`;
      return out(req, { ok: true, nombres: filas.map((x) => ({ u: x.u, n: x.n })) });
    }
    if (b.op === "login") {
      if (c.imp || c.pvw) return out(req, { ok: false, error: "No se cambia el usuario desde una vista previa." });
      const [me] = await q`select nombre, rol, coalesce(activo,true) activo from app.portal_users where lower(nombre)=lower(${c.u}) limit 1`;
      if (!me || me.activo === false || me.rol !== "admin" || String(me.nombre).toUpperCase() !== "EFCH") return out(req, { ok: false, error: "Solo EFCH" });
      const viejo = String(b.usuario || "").trim().slice(0, 40);
      const nuevo = String(b.nuevo || "").trim().slice(0, 40);
      if (!/^[\p{L}0-9 ._-]{2,40}$/u.test(nuevo)) return out(req, { ok: false, error: "El usuario debe tener de 2 a 40 letras, números, punto o guion." });
      const [u] = await q`select nombre from app.portal_users where lower(nombre)=lower(${viejo}) and coalesce(origen,'')<>'borrado' limit 1`;
      if (!u) return out(req, { ok: false, error: "Usuario no encontrado" });
      if (u.nombre.toLowerCase() === nuevo.toLowerCase()) return out(req, { ok: true, nombre: u.nombre, igual: true });
      const [ocupado] = await q`select 1 as x from app.portal_users where lower(nombre)=lower(${nuevo}) limit 1`;
      if (ocupado) return out(req, { ok: false, error: "Ese usuario ya existe." });
      await q`update app.portal_users set nombre=${nuevo} where nombre=${u.nombre}`;
      await q`update app.portal_refresh set nombre=${nuevo} where nombre=${u.nombre}`;
      await q`update app.portal_login_log set nombre=${nuevo} where nombre=${u.nombre}`;
      await q`insert into app.portal_perm_log(actor,nombre,accion,antes,despues) values (${me.nombre},${nuevo},'username',${q.json({ nombre: u.nombre })},${q.json({ nombre: nuevo })})`;
      return out(req, { ok: true, nombre: nuevo });
    }
    if (b.op !== "guardar") return out(req, { ok: false, error: "Operación no válida" });
    if (c.imp || c.pvw) return out(req, { ok: false, error: "No se cambia el nombre desde una vista previa." });
    const [me] = await q`select nombre, rol, coalesce(activo,true) activo from app.portal_users where lower(nombre)=lower(${c.u}) limit 1`;
    if (!me || me.activo === false || me.rol !== "admin" || String(me.nombre).toUpperCase() !== "EFCH") return out(req, { ok: false, error: "Solo EFCH" });
    const quien = String(b.usuario || "").trim().slice(0, 40);
    const nuevo = limpio(b.nombre);
    if (!valido(nuevo)) return out(req, { ok: false, error: "Escribe el nombre y el apellido." });
    const [u] = await q`select nombre, coalesce(trim(perfil->>'nombreCompleto'),'') actual from app.portal_users where lower(nombre)=lower(${quien}) and coalesce(origen,'')<>'borrado' limit 1`;
    if (!u) return out(req, { ok: false, error: "Usuario no encontrado" });
    if (u.actual === nuevo) return out(req, { ok: true, nombre: nuevo, igual: true });
    if (nuevo) await q`update app.portal_users set perfil=jsonb_set(coalesce(perfil,'{}'::jsonb), '{nombreCompleto}', to_jsonb(${nuevo}::text), true), updated_at=now() where nombre=${u.nombre}`;
    else await q`update app.portal_users set perfil=coalesce(perfil,'{}'::jsonb) - 'nombreCompleto', updated_at=now() where nombre=${u.nombre}`;
    await q`insert into app.portal_perm_log(actor,nombre,accion,antes,despues) values (${me.nombre},${u.nombre},'nombre_completo',${q.json({ nombreCompleto: u.actual })},${q.json({ nombreCompleto: nuevo })})`;
    return out(req, { ok: true, nombre: nuevo });
  } catch (e) {
    return out(req, { ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});
