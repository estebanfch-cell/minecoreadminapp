// Lista de verificación al entregar. No toca stock ni el alta de la entrega.
// Sesión = el mismo token de portal-api. El interruptor ~ent.checklist=1 se lee de la base, no del token.
import postgres from "npm:postgres@3.4.4";
const SB = Deno.env.get("SUPABASE_URL"), SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), SECRET = Deno.env.get("SHEETS_SECRET");
const BUCKET = "inflow";
let SQL = null;
const db = ()=>SQL ??= postgres(String(Deno.env.get("SUPABASE_DB_URL") || "").replace(/:5432\//, ":6543/"), {
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10
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
function vePrecios(me) {
  const m = me.modulos || [];
  if (m.includes("$precios=0")) return false;
  if (me.rol === "admin") return true;
  return true;
}
async function firmar(path) {
  const r = await fetch(`${SB}/storage/v1/object/sign/${BUCKET}`, {
    method: "POST",
    headers: { Authorization: "Bearer " + SK, apikey: SK, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 3600, paths: [path] })
  });
  const j = await r.json().catch(()=>[]);
  const x = Array.isArray(j) ? j.find((z)=>z && z.signedURL) : null;
  return x ? SB + "/storage/v1" + x.signedURL : "";
}
function tsEC(d) {
  try {
    return new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d)).replace(",", "") + " (EC)";
  } catch {
    return new Date(d).toISOString();
  }
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
    const checklist = (me.modulos || []).includes("~ent.checklist=1");
    if (!checklist) return out(req, { ok: true, checklist: false });
    const id = String(b.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return out(req, { ok: false, error: "Orden no válida" });
    const rows = await q`select l.line_num, coalesce(nullif(l.sku,''), p.sku, '') sku, coalesce(nullif(p.name,''), nullif(l.description,''), '') nombre,
      coalesce(nullif((select v.code_raw from app.product_vendor_codes v where v.product_id=p.id and v.kind='base' order by v.first_seen_at nulls last, v.id limit 1), ''), case when regexp_replace(coalesce(l.description,''), '\\s', '', 'g') ~ '^[0-9]{5,}$' then nullif(trim(l.description),'') else '' end, '') parte,
      l.quantity::float cantidad,
      (select i.storage_path from app.product_images i where i.product_id=p.id order by i.is_default desc nulls last limit 1) img,
      coalesce(
        nullif((select string_agg(s, ' ') from (select distinct nullif(trim(k.sublocation),'') s from app.so_pick_lines k where k.sales_order_id=l.sales_order_id and k.product_id=l.product_id) z where s is not null), ''),
        nullif(trim(p.default_sublocation), '')
      ) sub
      from app.sales_order_lines l left join app.products p on p.id=l.product_id
      where l.sales_order_id=${id}::uuid and not coalesce(l.is_discarded,false)
      order by l.line_num, l.id`;
    const foto = (p)=>!p ? "" : /^products\//.test(String(p)) ? `${SB}/storage/v1/object/public/fotos/${p}` : String(p);
    const L = rows.map((x, i)=>({
      k: String(x.line_num) + "|" + String(x.sku || "") + "|" + i,
      sku: String(x.sku || ""),
      nombre: String(x.nombre || ""),
      parte: String(x.parte || ""),
      cantidad: x.cantidad,
      img: foto(x.img),
      sub: String(x.sub || "")
    }));
    const keys = new Set(L.map((x)=>x.k));
    const precios = vePrecios(me);
    if (b.op === "marcar") {
      const ped = Array.isArray(b.lineas) ? [...new Set(b.lineas.map(String).filter((k)=>keys.has(k)))] : [];
      const listo = L.length > 0 && ped.length === L.length;
      const por = listo ? String(me.nombre) : null;
      const porNombre = listo ? nomDe(me) : null;
      const cuando = listo ? new Date() : null;
      await q`insert into app.so_entrega_verif (sales_order_id, lineas, por, por_nombre, listo_at, updated_at)
        values (${id}::uuid, ${q.json(ped)}::jsonb, ${por}, ${porNombre}, ${cuando}, now())
        on conflict (sales_order_id) do update set lineas=excluded.lineas, por=excluded.por, por_nombre=excluded.por_nombre, listo_at=excluded.listo_at, updated_at=now()`;
      if (listo) await q`update app.so_entregas set verif_por=${por}, verif_nombre=${porNombre}, verif_at=coalesce(verif_at, now()) where sales_order_id=${id}::uuid and estado in ('borrador','entregado')`;
      else await q`update app.so_entregas set verif_por=null, verif_nombre=null, verif_at=null where sales_order_id=${id}::uuid and estado='borrador'`;
    }
    const [v] = await q`select lineas, por, por_nombre, listo_at from app.so_entrega_verif where sales_order_id=${id}::uuid`;
    let crudas = v?.lineas;
    if (typeof crudas === "string") { try { crudas = JSON.parse(crudas); } catch { crudas = []; } }
    const marcadas = (Array.isArray(crudas) ? crudas : []).map(String).filter((k)=>keys.has(k));
    const listo = L.length > 0 && marcadas.length === L.length;
    if (listo && v?.por) await q`update app.so_entregas set verif_por=${v.por}, verif_nombre=${v.por_nombre}, verif_at=coalesce(verif_at, ${v.listo_at}) where sales_order_id=${id}::uuid and estado in ('borrador','entregado') and verif_at is null`;
    let factura = null;
    if (precios) {
      const [f] = await q`select storage_path, nombre from app.doc_attachments where tipo='so' and order_id=${id}::uuid and (nombre ilike 'FAC%' or nombre ilike '%factura%') and nombre ilike '%.pdf' order by id desc limit 1`;
      if (f?.storage_path) {
        const url = await firmar(f.storage_path).catch(()=>"");
        if (url) factura = { nombre: f.nombre, url };
      }
    }
    return out(req, {
      ok: true,
      checklist: true,
      precios,
      lineas: L,
      marcadas,
      n: L.length,
      listo,
      por: listo ? v?.por || null : null,
      por_nombre: listo ? v?.por_nombre || null : null,
      at: listo && v?.listo_at ? tsEC(v.listo_at) : null,
      factura
    });
  } catch (e) {
    return out(req, { ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});
