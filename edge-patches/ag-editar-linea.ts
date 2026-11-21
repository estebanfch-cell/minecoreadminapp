// ag_editar_linea_ov — SECRE cuadra el precio de una línea de OV.
// dry_run no escribe. Aplicar exige aprobado_por EFCH, solo OV sin facturar,
// y el guardado es el de ventas-api (recalcula totales y audita). No mueve stock.
import postgres from "npm:postgres@3.4.4";

const SECRET = Deno.env.get("SHEETS_SECRET") || "";
const AGT = Deno.env.get("AGENT_SECRE_TOKEN") || "";
let SQL = null;
const db = () => SQL ??= postgres(String(Deno.env.get("SUPABASE_DB_URL") || "").replace(/:5432\//, ":6543/"), {
  prepare: false, max: 1, idle_timeout: 5, connect_timeout: 15
});

function mcRound(v) {
  const x = Number(v) || 0;
  const a = Number(Math.abs(x).toPrecision(15));
  const r = Math.floor(a + 0.5);
  return x < 0 ? -r : r;
}
function r2(n) { return mcRound((Number(n) || 0) * 100) / 100; }

function json(body, st = 200) {
  return new Response(JSON.stringify(body), { status: st, headers: { "content-type": "application/json" } });
}

async function ventas(body) {
  const r = await fetch((Deno.env.get("SUPABASE_URL") || "") + "/functions/v1/ventas-api", {
    method: "POST",
    headers: { "content-type": "application/json", "x-sheets-secret": SECRET },
    body: JSON.stringify(body)
  });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { j = { ok: false, error: t.slice(0, 300) }; }
  if (!r.ok || !j || j.ok === false) throw new Error((j && j.error) || ("ventas-api " + r.status));
  return j;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("no", { status: 405 });
  if (!(AGT.length >= 32) || req.headers.get("x-agent-token") !== AGT) return json({ ok: false, error: "no autorizado" }, 403);
  const b = await req.json().catch(() => ({}));
  if (b.op !== "ag_editar_linea_ov") return json({ ok: false, error: "operación desconocida" }, 400);
  const dry = b.dry_run === true || b.dry_run === "true" || b.dry_run === 1;
  const sql = db();
  try {
    const key = String(b.order_number || b.id || "").trim();
    if (!key) throw new Error("Falta la orden");
    const id = /^[0-9a-f-]{36}$/i.test(key) ? key : null;
    const [s] = await sql`select s.id, s.order_number, s.version, s.is_quote, s.is_cancelled, s.is_invoiced, s.factura_sri,
      s.customer_id, s.location_id, s.order_date, s.payment_terms_id, s.contact_name, s.email, s.phone, s.tax1_rate::float tax,
      s.freight::float freight, s.subtotal::float base, s.tax1::float iva, s.total::float total
      from app.sales_orders s where s.id=${id}::uuid or s.order_number=${key}`;
    if (!s) throw new Error("Orden no existe");
    if (s.is_quote) throw new Error("Es una cotización, no una orden de venta");
    if (s.is_cancelled) throw new Error("La orden está cancelada");
    if (s.is_invoiced || s.factura_sri) throw new Error("Esa OV ya está facturada. No se edita.");
    const precio = Number(b.unit_price);
    if (!(precio >= 0) || !Number.isFinite(precio)) throw new Error("Precio inválido");
    const lineas = await sql`select id, line_num, product_id, sku, description, quantity::float quantity, unit_price::float unit_price,
      discount_pct::float discount_pct, subtotal::float subtotal, plazo_entrega, entrega
      from app.sales_order_lines where sales_order_id=${s.id} and not coalesce(is_discarded,false) order by line_num, id`;
    const sku = String(b.sku || "").trim().toUpperCase();
    let hit = null;
    if (b.line_id) hit = lineas.find((l) => l.id === b.line_id) || null;
    else {
      const cands = lineas.filter((l) => String(l.sku || "").toUpperCase() === sku && (b.cantidad == null || b.cantidad === "" || Number(l.quantity) === Number(b.cantidad)));
      if (cands.length !== 1) throw new Error(cands.length ? "Hay más de una línea con ese código. Indica la cantidad o el id." : "Esa línea no está en la orden");
      hit = cands[0];
    }
    if (!hit) throw new Error("Esa línea no está en la orden");
    if (sku && String(hit.sku || "").toUpperCase() !== sku) throw new Error("El código no coincide con la línea");
    const desc = Number(hit.discount_pct) || 0;
    const neto = r2(Number(hit.quantity) * precio * (1 - desc / 100));
    const netoAntes = r2(Number(hit.quantity) * Number(hit.unit_price) * (1 - desc / 100));
    let base = 0;
    for (const l of lineas) base += l.id === hit.id ? neto : Number(l.subtotal);
    base = r2(base);
    const tax = Number(s.tax) || 0;
    const freight = Number(s.freight) || 0;
    const [tot] = await sql`select round(${base}::numeric * ${tax}::numeric / 100, 2)::float iva,
      round(${base}::numeric + ${base}::numeric * ${tax}::numeric / 100 + ${freight}::numeric, 2)::float total`;
    const preview = {
      ok: true,
      dry_run: true,
      order_number: s.order_number,
      sku: hit.sku,
      cantidad: Number(hit.quantity),
      descuento: desc,
      antes: { unit_price: Number(hit.unit_price), neto: netoAntes, base: Number(s.base), iva: Number(s.iva), total: Number(s.total) },
      despues: { unit_price: precio, neto, base, iva: Number(tot.iva), total: Number(tot.total) }
    };
    if (dry) return json(preview);
    if (String(b.aprobado_por || "").trim().toUpperCase() !== "EFCH") throw new Error("Hace falta la aprobación de EFCH");
    const picksAntes = await sql`select id, product_id, quantity::float q from app.so_pick_lines where sales_order_id=${s.id} order by id`;
    const orden = {
      id: s.id,
      version: Number(s.version),
      customer_id: s.customer_id,
      location_id: s.location_id,
      order_date: s.order_date,
      payment_terms_id: s.payment_terms_id,
      contact_name: s.contact_name,
      email: s.email,
      phone: s.phone,
      tax1_rate: tax,
      freight,
      is_quote: false
    };
    const payloadLineas = lineas.map((l) => ({
      id: l.id,
      product_id: l.product_id,
      sku: l.sku,
      description: l.description,
      quantity: Number(l.quantity),
      unit_price: l.id === hit.id ? precio : Number(l.unit_price),
      discount_pct: Number(l.discount_pct) || 0,
      plazo_entrega: l.plazo_entrega,
      entrega: l.entrega || null
    }));
    const saved = await ventas({ op: "save", actor: "Esteban Ferlito", orden, lineas: payloadLineas });
    const [now] = await sql`select subtotal::float base, tax1::float iva, total::float total, is_invoiced from app.sales_orders where id=${s.id}`;
    const picks = await sql`select id, product_id, quantity::float q from app.so_pick_lines where sales_order_id=${s.id} order by id`;
    const firma = (rows) => rows.map((r) => r.id + "|" + Number(r.q)).join(",");
    const mismo = (a, b) => mcRound(Number(a) * 100) === mcRound(Number(b) * 100);
    const stockIgual = firma(picksAntes) === firma(picks);
    const cuadra = mismo(now.base, base) && mismo(now.iva, tot.iva) && mismo(now.total, tot.total);
    if (!stockIgual || !cuadra || now.is_invoiced) {
      const back = payloadLineas.map((l) => l.id === hit.id ? { ...l, unit_price: Number(hit.unit_price) } : l);
      const [v2] = await sql`select version from app.sales_orders where id=${s.id}`;
      await ventas({ op: "save", actor: "Esteban Ferlito", orden: { ...orden, version: Number(v2.version) }, lineas: back });
      throw new Error(!stockIgual ? "El guardado iba a tocar el stock. Se revirtió." : "Los totales no cuadraron con la vista previa. Se revirtió.");
    }
    await sql`insert into app.agent_audit(agent,op,doc,request,result,ok) values ('SECRE','ag_editar_linea_ov',${s.order_number},${sql.json({
      sku: hit.sku, cantidad: Number(hit.quantity), unit_price: precio, aprobado_por: "EFCH", dry_run: false
    })},${sql.json({ base: now.base, iva: now.iva, total: now.total, outbox: saved.outbox || null })},true)`.catch(() => null);
    return json({ ...preview, dry_run: false, aplicado: true, actor: "Esteban Ferlito", aprobado_por: "EFCH", stock_devuelto: saved.stock_devuelto || [], facturada: false });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e).slice(0, 400) }, 200);
  }
});
