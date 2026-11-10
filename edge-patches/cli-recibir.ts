// Órdenes por recibir del portal cliente. Solo su organización y con ~cli.e.recibir=1.
// La firma reutiliza firma-api (el mismo enlace de entrega). No toca stock.
import postgres from "npm:postgres@3.4.4";
const SB = Deno.env.get("SUPABASE_URL"), SECRET = Deno.env.get("SHEETS_SECRET");
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
function tok() {
  const a = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return out(req, { ok: false, error: "POST" }, 405);
  try {
    const b = await req.json().catch(()=>({}));
    const c = await verify(b.t);
    if (!c) return out(req, { ok: false, error: "Sesión vencida. Vuelve a entrar." }, 401);
    const q = db();
    const vista = /^Vista previa · /.test(String(c.u || ""));
    const nombre = vista ? String(c.u).split(" · ")[1] || "" : c.u;
    if (vista && b.op !== "lista") return out(req, { ok: false, error: "Vista previa: no se firma ni se crea un acta." });
    const [rv] = await q`select extract(epoch from max(at))::float x from app.portal_revocations where nombre in (${nombre}, '*')`;
    if (rv?.x && rv.x >= c.iat) return out(req, { ok: false, error: "Sesión revocada" }, 401);
    const [me] = await q`select nombre, rol, modulos, perfil, coalesce(activo,true) activo from app.portal_users where lower(nombre)=lower(${nombre}) limit 1`;
    if (!me || me.activo === false || me.rol !== "cliente") return out(req, { ok: true, activo: false });
    const mods = me.modulos || [];
    if (!mods.includes("~cli.e.recibir=1")) return out(req, { ok: true, activo: false });
    const empresa = String(me.perfil?.empresa || "").trim();
    if (!empresa) return out(req, { ok: false, error: "Sin organización" });
    const propias = async (id)=> {
      const [s] = await q`select s.id::text id, s.order_number, s.entregado_at from app.sales_orders s join app.customers c on c.id=s.customer_id
        where s.id=${id}::uuid and not s.is_quote and not coalesce(s.is_cancelled,false) and lower(trim(c.name))=lower(trim(${empresa})) limit 1`;
      return s || null;
    };
    if (b.op === "lista") {
      const rows = await q`select s.id::text id, s.order_number, s.order_date::text fecha,
          case
            when coalesce(e.entregado_at, s.entregado_at) is not null then 'entregada'
            when v.pack_estado='completo' or v.ship_estado='enviado' then 'lista'
            else 'pendiente'
          end estado,
          nullif(trim(e.receptor), '') receptor,
          coalesce(nullif(trim(u.perfil->>'nombreCompleto'), ''), nullif(trim(u.perfil->>'nombre_completo'), ''), nullif(trim(e.entregado_por), ''), nullif(trim(s.entregado_por), '')) entrego,
          (e.pdf_att is not null) tiene_acta
        from app.sales_orders s
        join app.customers c on c.id=s.customer_id
        left join app.v_so_status v on v.sales_order_id=s.id
        left join app.so_entregas e on e.sales_order_id=s.id
        left join app.portal_users u on lower(u.nombre)=lower(coalesce(e.entregado_por, s.entregado_por))
        where not s.is_quote and not coalesce(s.is_cancelled, false)
          and lower(trim(c.name))=lower(trim(${empresa}))
        order by s.order_date desc nulls last
        limit 80`;
      return out(req, { ok: true, activo: true, ordenes: rows });
    }
    const id = String(b.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return out(req, { ok: false, error: "Orden no válida" });
    const s = await propias(id);
    if (!s) return out(req, { ok: false, error: "Orden no existe" });
    const rows = await q`select l.line_num, coalesce(nullif(l.sku,''), p.sku, '') sku, coalesce(nullif(l.description,''), p.name, '') nombre, l.quantity::float cantidad,
      (select i.storage_path from app.product_images i where i.product_id=p.id order by i.is_default desc nulls last limit 1) img,
      coalesce(nullif((select string_agg(z.s, ' ') from (select distinct nullif(trim(k.sublocation),'') s from app.so_pick_lines k where k.sales_order_id=l.sales_order_id and k.product_id=l.product_id) z where z.s is not null), ''), nullif(trim(p.default_sublocation), '')) sub
      from app.sales_order_lines l left join app.products p on p.id=l.product_id
      where l.sales_order_id=${id}::uuid and not coalesce(l.is_discarded,false) order by l.line_num, l.id`;
    const foto = (p)=>!p ? "" : /^products\//.test(String(p)) ? `${SB}/storage/v1/object/public/fotos/${p}` : String(p);
    const L = rows.map((x, i)=>({ k: String(x.line_num) + "|" + String(x.sku || "") + "|" + i, sku: String(x.sku || ""), nombre: String(x.nombre || ""), cantidad: x.cantidad, img: foto(x.img), sub: String(x.sub || "") }));
    const keys = new Set(L.map((x)=>x.k));
    if (b.op === "marcar") {
      const ped = Array.isArray(b.lineas) ? [...new Set(b.lineas.map(String).filter((k)=>keys.has(k)))] : [];
      const listo = L.length > 0 && ped.length === L.length;
      const nom = String(me.perfil?.nombreCompleto || me.perfil?.nombre_completo || me.nombre || "").trim();
      await q`insert into app.so_entrega_verif (sales_order_id, lineas, por, por_nombre, listo_at, updated_at)
        values (${id}::uuid, ${q.json(ped)}::jsonb, ${listo ? me.nombre : null}, ${listo ? nom : null}, ${listo ? new Date() : null}, now())
        on conflict (sales_order_id) do update set lineas=excluded.lineas, por=excluded.por, por_nombre=excluded.por_nombre, listo_at=excluded.listo_at, updated_at=now()`;
    }
    if (b.op === "anotar") {
      const nom = String(b.nombre || "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (nom.length < 5 || !nom.includes(" ")) return out(req, { ok: false, error: "Escribe tu nombre completo" });
      await q`update app.so_entrega_verif set por=${me.nombre}, por_nombre=${nom}, listo_at=coalesce(listo_at, now()), updated_at=now() where sales_order_id=${id}::uuid`;
      await q`update app.so_entregas set verif_por=${me.nombre}, verif_nombre=${nom}, verif_at=coalesce(verif_at, now()) where sales_order_id=${id}::uuid`;
      return out(req, { ok: true, nombre: nom });
    }
    const [v] = await q`select lineas, por_nombre, listo_at from app.so_entrega_verif where sales_order_id=${id}::uuid`;
    let crudas = v?.lineas;
    if (typeof crudas === "string") { try { crudas = JSON.parse(crudas); } catch { crudas = []; } }
    const marcadas = (Array.isArray(crudas) ? crudas : []).map(String).filter((k)=>keys.has(k));
    const listo = L.length > 0 && marcadas.length === L.length;
    let token = "";
    if (!s.entregado_at) {
      const [ya] = await q`select token from app.firma_remota where sales_order_id=${id}::uuid and estado='pendiente' and expira_at>now() and orden_ids is null order by creado_at desc limit 1`;
      if (ya?.token) token = ya.token;
      else {
        token = tok();
        await q`insert into app.firma_remota (token, sales_order_id, order_number, creado_por, expira_at) values (${token}, ${id}::uuid, ${s.order_number}, ${me.nombre}, now() + interval '10 days')`;
      }
    }
    return out(req, { ok: true, activo: true, orden: s.order_number, id: s.id, entregada: !!s.entregado_at, lineas: L, marcadas, n: L.length, listo, token, por_nombre: v?.por_nombre || null });
  } catch (e) {
    return out(req, { ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});
