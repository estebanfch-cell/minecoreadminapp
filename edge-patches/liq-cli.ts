// Liquidación del portal cliente. Solo lectura de la oleada de SU organización.
// El interruptor lo cambia EFCH. Nunca devuelve motivo ni datos de otro cliente.
import postgres from "npm:postgres@3.4.4";
const SECRET = Deno.env.get("SHEETS_SECRET");
const MENSAJE = "Sin productos en liquidación por ahora";
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
function esOswaldo(n) {
  const x = String(n || "").trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  return x === "oswal" || x === "oswaldo";
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
async function deOrganizacion(q, empresa) {
  const emp = String(empresa || "").trim();
  if (!emp) return { ok: true, vacio: true, empresa: "", mensaje: MENSAJE, items: [] };
  const clientes = await q`select id::text id from app.customers where lower(trim(name))=lower(trim(${emp})) limit 2`;
  if (clientes.length !== 1) return { ok: true, vacio: true, empresa: emp, mensaje: MENSAJE, items: [] };
  const [oleada] = await q`select token from app.liq_oleadas
    where customer_id=${clientes[0].id}::uuid and estado='activa' and tipo='cliente'
      and (expira is null or expira>now())
    order by creada desc limit 1`;
  if (!oleada) return { ok: true, vacio: true, empresa: emp, mensaje: MENSAJE, items: [] };
  const [row] = await q`select app.liq_get(${oleada.token}, false, false) j`;
  const j = row?.j || {};
  const filas = Array.isArray(j.items) ? j.items : [];
  if (!filas.length) return { ok: true, vacio: true, empresa: emp, mensaje: MENSAJE, items: [] };
  return {
    ok: true,
    vacio: false,
    empresa: emp,
    mensaje: j.instruccion || "",
    items: filas.map((x) => ({
      sku: x.sku || "",
      nombre: x.nombre || "",
      precio: num(x.precio_liq),
      lista: num(x.precio_lista),
      stock: num(x.stock),
      origen: x.origen || ""
    }))
  };
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
    if (b.op === "ver") {
      if (c.pvw) {
        if (String(c.pvw.r || "") !== "cliente" || esOswaldo(c.u)) return out(req, { ok: false, error: "Sin acceso a Liquidación" });
        const mods = Array.isArray(c.pvw.m) ? c.pvw.m : [];
        if (!mods.includes("liquidacion")) return out(req, { ok: false, error: "Sin acceso a Liquidación" });
        return out(req, await deOrganizacion(q, c.pvw.emp));
      }
      const [me] = await q`select nombre, rol, coalesce(activo,true) activo, modulos, coalesce(perfil->>'empresa','') empresa
        from app.portal_users where lower(nombre)=lower(${c.u}) limit 1`;
      if (!me || me.activo === false || me.rol !== "cliente" || esOswaldo(me.nombre)) return out(req, { ok: false, error: "Sin acceso a Liquidación" });
      if (!(me.modulos || []).includes("liquidacion")) return out(req, { ok: false, error: "Sin acceso a Liquidación" });
      return out(req, await deOrganizacion(q, me.empresa));
    }
    if (b.op !== "switch" && b.op !== "invite") return out(req, { ok: false, error: "Operación no válida" });
    if (c.imp || c.pvw) return out(req, { ok: false, error: "No se cambia Liquidación desde una vista previa." });
    const [me] = await q`select nombre, rol, coalesce(activo,true) activo from app.portal_users where lower(nombre)=lower(${c.u}) limit 1`;
    if (!me || me.activo === false || me.rol !== "admin" || String(me.nombre).toUpperCase() !== "EFCH") return out(req, { ok: false, error: "Solo EFCH" });
    const on = !!b.on;
    if (b.op === "switch") {
      const nombre = String(b.usuario || "").trim().slice(0, 40);
      if (esOswaldo(nombre)) {
        await q`update app.portal_users set modulos=array_remove(modulos,'liquidacion') where lower(nombre)=lower(${nombre})`;
        return out(req, { ok: false, error: "Oswaldo no tiene Liquidación." });
      }
      const [u] = await q`select nombre, rol from app.portal_users where lower(nombre)=lower(${nombre}) limit 1`;
      if (!u || u.rol !== "cliente") return out(req, { ok: false, error: "Solo se activa en un usuario cliente." });
      await q`update app.portal_users set modulos=array_remove(modulos,'liquidacion') where nombre=${u.nombre} and rol='cliente'`;
      if (on) await q`update app.portal_users set modulos=modulos || array['liquidacion']::text[] where nombre=${u.nombre} and rol='cliente' and not ('liquidacion'=any(modulos))`;
      await q`insert into app.portal_perm_log(actor,nombre,accion,despues) values (${me.nombre},${u.nombre},'liq_switch',${q.json({ on })})`;
      return out(req, { ok: true, on });
    }
    const token = String(b.token || "").trim().slice(0, 60);
    const [v] = await q`select token, rol from app.portal_invites where token=${token} and usada_por is null and not revocada limit 1`;
    if (!v || v.rol !== "cliente") return out(req, { ok: false, error: "La invitación no es de un cliente." });
    await q`update app.portal_invites set modulos=array_remove(modulos,'liquidacion') where token=${v.token}`;
    if (on) await q`update app.portal_invites set modulos=modulos || array['liquidacion']::text[] where token=${v.token} and not ('liquidacion'=any(modulos))`;
    return out(req, { ok: true, on });
  } catch (e) {
    return out(req, { ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});
