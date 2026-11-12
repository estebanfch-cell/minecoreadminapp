// Usuarios de la organización del máster. Nunca otra empresa, nunca un módulo que el máster no tiene.
import postgres from "npm:postgres@3.4.4";
const SECRET = Deno.env.get("SHEETS_SECRET");
// v2 (b682 t1922): mismo registro que el portal (CMODS_REG + CMODS_EXTRA). on = token si encendido, off = token si apagado, campo = perfil.
// Un módulo nuevo del portal: agregar UNA línea aquí (k, on[, off]). El máster solo da lo que él tiene; nunca otra organización.
const REG = [
  { k: "inventario", on: "inventario" }, { k: "cotizaciones", on: "cotizaciones" }, { k: "estadocuenta", on: "estadocuenta" },
  { k: "consignacion", on: "consignacion" }, { k: "liquidacion", on: "liquidacion" },
  { k: "entregas", on: "~cli.e.recibir=1" }, { k: "cdash", on: "@cdash=1", off: "@cdash=0" },
  { k: "proyectos", on: "@proyectos=1", off: "@proyectos=0" }, { k: "master", campo: "master" },
];
const MODULOS = REG.filter((r) => !r.campo).map((r) => r.k); // compatibilidad
const RK = (k) => REG.find((r) => r.k === k);
const tiene = (u, r) => r.campo ? !!u?.perfil?.[r.campo] : (u?.modulos || []).some((t) => t === r.on || t === r.on + "+");
const claves = (u) => REG.filter((r) => tiene(u, r)).map((r) => r.k);
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
function quienPreview(u) {
  const m = String(u || "").match(/^Vista previa ·\s*(.+?)\s·/);
  return m ? m[1].trim() : "";
}
async function maestro(q, c) {
  const nombre = c.pvw ? quienPreview(c.u) : String(c.u || "");
  if (!nombre) return { error: "Solo el máster de la organización puede ver Usuarios." };
  const [me] = await q`select nombre, rol, coalesce(activo,true) activo, modulos, perfil
    from app.portal_users where lower(nombre)=lower(${nombre}) limit 1`;
  const emp = String(me?.perfil?.empresa || "").trim();
  if (!me || me.activo === false || me.rol !== "cliente" || !me.perfil?.master || !emp) {
    return { error: "Solo el máster de la organización puede ver Usuarios." };
  }
  if (c.pvw && emp.toLowerCase() !== String(c.pvw.emp || "").trim().toLowerCase()) {
    return { error: "La vista previa no corresponde a esta organización." };
  }
  const propios = claves(me);
  return { me, emp, propios, preview: !!c.pvw };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return out(req, { ok: false, error: "POST" }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const c = await verify(b.t);
    if (!c) return out(req, { ok: false, error: "Sesión vencida. Vuelve a entrar." }, 401);
    const q = db();
    const yo = await maestro(q, c);
    if (yo.error) return out(req, { ok: false, error: yo.error });
    if (b.op === "ver") {
      const usuarios = await q`select nombre, coalesce(perfil->>'nombreCompleto','') completo, modulos, perfil,
        coalesce((perfil->>'master')::boolean,false) master, coalesce(activo,true) activo
        from app.portal_users
        where rol='cliente' and coalesce(origen,'')<>'borrado'
          and lower(trim(perfil->>'empresa'))=lower(trim(${yo.emp}))
        order by nombre`;
      const invites = await q`select token, modulos, creador, creada
        from app.portal_invites
        where rol='cliente' and usada_por is null and not revocada
          and lower(trim(coalesce(empresa,'')))=lower(trim(${yo.emp}))
        order by creada desc limit 20`;
      return out(req, {
        ok: true, v: 2, preview: yo.preview, empresa: yo.emp, modulos: yo.propios,
        usuarios: usuarios.map((u) => ({
          nombre: u.nombre, completo: u.completo || "",
          modulos: claves(u),
          master: !!u.master, activo: u.activo !== false,
          esYo: u.nombre.toLowerCase() === yo.me.nombre.toLowerCase()
        })),
        invitaciones: invites.map((v) => ({
          token: String(v.token).slice(0, 6),
          modulos: REG.filter((r) => !r.campo && (v.modulos || []).includes(r.on)).map((r) => r.k),
          creador: v.creador || ""
        }))
      });
    }
    if (yo.preview) return out(req, { ok: false, error: "Vista previa: solo lectura. No se crean invitaciones ni se cambian permisos." });
    if (b.op === "modulo") {
      const nombre = String(b.usuario || "").trim().slice(0, 40);
      const r = RK(String(b.modulo || "").trim());
      if (!r) return out(req, { ok: false, error: "Módulo no válido." });
      if (b.on && !yo.propios.includes(r.k)) return out(req, { ok: false, error: "No puedes dar un módulo que tú no tienes." });
      const [u] = await q`select nombre, modulos, perfil from app.portal_users
        where rol='cliente' and lower(nombre)=lower(${nombre})
          and lower(trim(perfil->>'empresa'))=lower(trim(${yo.emp})) limit 1`;
      if (!u) return out(req, { ok: false, error: "Ese usuario no es de tu organización." });
      if (r.campo === "master" && !b.on && u.nombre.toLowerCase() === yo.me.nombre.toLowerCase()) return out(req, { ok: false, error: "No puedes quitarte el Máster a ti mismo." });
      if (r.campo) {
        await q`update app.portal_users set perfil = jsonb_set(coalesce(perfil,'{}'::jsonb), ${"{" + r.campo + "}"}::text[], ${b.on ? "true" : "false"}::jsonb), updated_at=now() where nombre=${u.nombre}`;
      } else {
        const quitar = [r.on, r.on + "+", ...(r.off ? [r.off] : [])];
        const poner = b.on ? [r.on] : (r.off ? [r.off] : []);
        await q`update app.portal_users set modulos = array(select x from unnest(coalesce(modulos,'{}'::text[])) x where not (x = any(${quitar}::text[]))) || ${poner}::text[], updated_at=now()
          where nombre=${u.nombre}`;
      }
      await q`insert into app.portal_perm_log(actor,nombre,accion,despues)
        values (${yo.me.nombre},${u.nombre},'equipo_modulo',${q.json({ modulo: r.k, on: !!b.on, empresa: yo.emp })})`;
      return out(req, { ok: true });
    }
    if (b.op === "invitar") {
      const mods = (Array.isArray(b.modulos) ? b.modulos : []).map((m) => RK(String(m))).filter((r) => r && !r.campo && yo.propios.includes(r.k)).map((r) => r.on);
      if (!mods.length) return out(req, { ok: false, error: "Elige al menos un módulo que tú tengas." });
      const nota = String(b.nombre || "").trim().slice(0, 40);
      const token = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
      await q`insert into app.portal_invites(token,rol,modulos,creador,empresa,aprobado)
        values (${token},'cliente',${mods},${yo.me.nombre},${yo.emp},true)`;
      await q`insert into app.avisos(tipo,texto,destino,ref,para,estado)
        values ('equipo', ${yo.me.nombre + " (" + yo.emp + ") creó una invitación para su organización" + (nota ? " (" + nota + ")" : "") + "."}, 'users', ${token}, 'admin', 'abierto')`;
      return out(req, { ok: true, token, empresa: yo.emp });
    }
    return out(req, { ok: false, error: "Operación no válida" });
  } catch (e) {
    return out(req, { ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});
