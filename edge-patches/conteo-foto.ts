// Foto del esperado al enviar cada sección. No mueve stock: el ajuste, si luego se aprueba,
// sigue siendo la diferencia contra esta foto (el conteo de ventas-api no se redeploya).
// Solo quien tiene ~co.e.foto=1. Las secciones aprobadas no se reabren.
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
const UUID = (s)=>/^[0-9a-f-]{36}$/i.test(String(s || ""));
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
    const [me] = await q`select nombre, rol, modulos, coalesce(activo,true) activo from app.portal_users where lower(nombre)=lower(${c.u}) limit 1`;
    if (!me || me.activo === false || me.rol === "cliente" || me.rol === "proveedor") return out(req, { ok: false, error: "Sin permiso" });
    const mods = me.modulos || [];
    if (!mods.includes("~co.e.foto=1")) return out(req, { ok: false, error: "Sin permiso para la foto del conteo" });
    if (!UUID(b.id)) return out(req, { ok: false, error: "Sección no válida" });
    const [s] = await q`select s.id, s.estado, s.iniciado_at, s.cerrado_at, z.nombre zona, d.id doc_id, d.number, d.estado doc_estado, d.asignado_a, d.location_id
      from app.conteo_secciones s join app.conteo_zonas z on z.id=s.zona_id join app.inv_docs d on d.id=s.doc_id
      where s.id=${b.id}::uuid and d.tipo='conteo'`;
    if (!s) return out(req, { ok: false, error: "Sección no existe" });
    const dueno = me.rol === "admin" || String(s.asignado_a || "").toLowerCase() === String(me.nombre).toLowerCase();
    if (!dueno) return out(req, { ok: false, error: "Este conteo está asignado a otra persona" });
    if (b.op === "detalle") {
      const lines = await q`select x.id::text id, x.product_id, p.sku, x.from_sub sub, x.esperado::float esperado, x.foto_at, coalesce(x.recontar_movs,'[]'::jsonb) movs
        from app.inv_doc_lines x join app.products p on p.id=x.product_id where x.seccion_id=${s.id} order by x.from_sub, p.sku`;
      if (s.estado === "en_conteo" && s.iniciado_at) {
        for (const ln of lines) {
          const mv = await q`select m.at, m.delta::float delta, m.kind, m.actor, left(coalesce(m.nota,''),160) nota
            from app.stock_local_moves m
            where m.product_id=${ln.product_id}
              and m.location_id=${s.location_id}
              and upper(trim(coalesce(m.sublocation,'')))=upper(trim(coalesce(${ln.sub},'')))
              and m.status<>'anulado' and m.at>=${s.iniciado_at}
            order by m.at limit 20`;
          ln.movs = mv.map((m)=>({ at: m.at, delta: Number(m.delta), kind: m.kind, actor: m.actor, nota: m.nota, sku: ln.sku, sub: ln.sub || "" }));
          ln.esperado = null;
          ln.foto_at = null;
        }
      } else {
        for (const ln of lines) {
          let arr = ln.movs;
          if (typeof arr === "string") { try { arr = JSON.parse(arr); } catch { arr = []; } }
          ln.movs = Array.isArray(arr) ? arr.slice(0, 20) : [];
        }
      }
      return out(req, { ok: true, estado: s.estado, lineas: lines.map((ln)=>({ id: ln.id, esperado: ln.esperado, foto_at: ln.foto_at, movs: ln.movs })) });
    }
    if (b.op !== "cerrar") return out(req, { ok: false, error: "Operación no válida" });
    if (s.estado === "aprobada") return out(req, { ok: false, error: "Esa sección ya está aprobada. No se reabre." });
    if (s.estado !== "en_conteo") return out(req, { ok: false, error: "La sección no está en conteo" });
    if (s.doc_estado !== "borrador") return out(req, { ok: false, error: "El conteo general no está abierto" });
    await q`update app.inv_doc_lines x set buscar=true where x.seccion_id=${s.id} and x.contado is null and x.otra_qty is not null and x.extras @> '[{"hallazgo":true}]'::jsonb and x.otra_qty < coalesce((select sum(quantity) from app.stock_levels sl where sl.product_id=x.product_id and sl.location_id=${s.location_id} and upper(trim(coalesce(sl.sublocation,'')))=upper(trim(coalesce(x.from_sub,''))) and sl.serial=''),0)`;
    const [bq] = await q`select count(*)::int n from app.inv_doc_lines where seccion_id=${s.id} and buscar`;
    if (bq.n) return out(req, { ok: false, error: bq.n + " producto(s) en «Buscar después»: encuéntralos antes de terminar la sección" });
    const [faltan] = await q`select count(*)::int n from app.inv_doc_lines where seccion_id=${s.id} and contado is null`;
    if (faltan.n && !b.forzar) return out(req, { ok: true, faltan: faltan.n });
    const ahora = new Date();
    const lines = await q`select x.id, x.product_id, x.from_sub, p.sku from app.inv_doc_lines x join app.products p on p.id=x.product_id where x.seccion_id=${s.id}`;
    let nRec = 0;
    await q.begin(async (t)=>{
      for (const ln of lines) {
        const [st] = await t`select coalesce(sum(quantity),0)::float q from app.stock_levels where product_id=${ln.product_id} and location_id=${s.location_id} and upper(trim(coalesce(sublocation,'')))=upper(trim(coalesce(${ln.from_sub},''))) and serial=''`;
        const mv = s.iniciado_at ? await t`select m.at, m.delta::float delta, m.kind, m.actor, left(coalesce(m.nota,''),160) nota
          from app.stock_local_moves m
          where m.product_id=${ln.product_id} and m.location_id=${s.location_id}
            and upper(trim(coalesce(m.sublocation,'')))=upper(trim(coalesce(${ln.from_sub},'')))
            and m.status<>'anulado' and m.at>=${s.iniciado_at} and m.at<=${ahora}
          order by m.at limit 20` : [];
        const movs = mv.map((m)=>({ at: m.at, delta: Number(m.delta), kind: m.kind, actor: m.actor, nota: m.nota, sku: ln.sku, sub: ln.from_sub || "" }));
        if (movs.length) nRec++;
        await t`update app.inv_doc_lines set esperado=${Number(st?.q || 0)}, foto_at=${ahora}, recontar=${movs.length > 0}, recontar_movs=${t.json(movs)} where id=${ln.id}`;
      }
      const upd = await t`update app.conteo_secciones set estado='en_revision', cerrado_at=${ahora}, cerrado_por=${String(me.nombre)}, revision_nota=null where id=${s.id} and estado='en_conteo' returning id`;
      if (!upd.length) throw new Error("Esa sección ya no está en conteo. No se volvió a tomar la foto.");
      await t`insert into app.audit_log(actor, accion, tabla, ref_id, detalle) values (${String(me.nombre)}, 'conteo_foto', 'conteo_secciones', ${String(s.id)}, ${t.json({ number: s.number, zona: s.zona, recontar: nRec, stock: false })})`;
      if (nRec) {
        const texto = "Recontar: hubo movimientos durante el conteo · " + s.number + " · " + s.zona + " · " + nRec + (nRec === 1 ? " sububicación" : " sububicaciones");
        const paras = [String(s.asignado_a || "").trim(), "EFCH"].filter(Boolean);
        const vistos = new Set();
        for (const nombre of paras) {
          const key = nombre.toLowerCase();
          if (vistos.has(key)) continue;
          vistos.add(key);
          await t`insert into app.avisos(tipo, ref, texto, destino, para, estado) values ('conteo_recontar', ${String(s.id)}, ${texto}, 'misconteos', ${"u:" + key}, 'abierto')`;
        }
      }
    });
    return out(req, { ok: true, recontar: nRec, foto_at: ahora.toISOString() });
  } catch (e) {
    return out(req, { ok: false, error: String(e?.message || e).slice(0, 300) }, 500);
  }
});
