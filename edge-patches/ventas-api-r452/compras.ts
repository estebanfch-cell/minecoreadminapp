import { codClean, codPersistir } from "./codigos.ts";
import { mcRound } from './round.ts';
import { listarAdjuntos, guardarAdjunto } from "./adjuntos.ts";
// compras.ts — Compras nativo Minecore (Supabase original; inFlow espejo por app.po_outbox).
// OC/cotización de compra, recepción (entra stock local al instante como movimiento 'po_receive'), pagos (cierre ≤ $0.05) y cancelación.
import { moduloOn } from "./emisor.ts";
const r2 = (n)=>mcRound((Number(n) || 0) * 100) / 100;
const U = (x)=>/^[0-9a-f-]{36}$/i.test(String(x || "")) ? String(x) : null;
export async function compras(op, b, sql, actor, LOC_PRINCIPAL, signPaths) {
  if (op === "po_receive" && b.undo) op = "po_receive_undo";
  else if (op === "po_receive" && b.devolucion) op = "po_return"; // b296: van por po_receive (permitido en portal-api)
  if (!/^po_/.test(op)) return null;
  const enqueue = async (kind, id, payload)=>{
    const on = moduloOn(kind);
    const [o] = await sql`insert into app.po_outbox(actor,op,po_id,payload,status,mode) values (${actor},${kind},${id}::uuid,${sql.json(payload || {})},${on ? "pendiente" : "simulado"},${on ? "real" : "prueba"}) returning id`;
    await sql`update app.purchase_orders set sync_status=${on ? "pendiente" : "local"} where id=${id}::uuid`;
    return o.id;
  };
  const getPo = async (id)=>{
    const [p] = await sql`select * from app.purchase_orders where id=${U(id) || null}::uuid or order_number=${String(id || "")}`;
    if (!p) throw new Error("OC no existe");
    return p;
  };
  const recalc = async (id)=>{
    await sql`update app.purchase_orders p set tax1=round(x.st*(case when v.cobra_iva then coalesce(v.iva_pct,(select rate from app.tax_schemes where is_default and is_active limit 1),15) else 0 end)/100,2)
      from (select coalesce(sum(subtotal),0) st from app.po_lines where purchase_order_id=${id}::uuid) x, app.vendors v where p.id=${id}::uuid and p.source='minecore' and v.id=p.vendor_id`; // b292: IVA de OC nativa según proveedor / esquema predeterminado
    await sql`update app.purchase_orders p set subtotal=x.st, total=round(x.st+coalesce(p.tax1,0)+coalesce(p.freight,0),2) from (select coalesce(sum(subtotal),0) st from app.po_lines where purchase_order_id=${id}::uuid) x where p.id=${id}::uuid`;
    await sql`update app.purchase_orders p set amount_paid=y.a, balance=case when y.a<>0 and abs(p.total-y.a)<=0.05 then 0 else round(p.total-y.a,2) end,
      payment_status=case when p.is_quote then 'quote' when y.a>=p.total-0.05 and p.total>0 then 'paid' when y.a>0 then 'partial' else 'unpaid' end,
      inventory_status=case when r.q<=0 then 'unfulfilled' when r.q>=o.q then 'fulfilled' else 'started' end,
      estado=case when p.is_cancelled then 'cancelada' when p.is_quote then 'cotizacion' when r.q>=o.q and o.q>0 then 'recibida' when r.q>0 then 'parcial' else 'abierta' end, updated_at=now()
      from (select coalesce(sum(amount),0) a from app.po_payments where purchase_order_id=${id}::uuid) y,
           (select coalesce(sum(quantity),0) q from app.po_receive_lines where purchase_order_id=${id}::uuid) r,
           (select coalesce(sum(quantity),0) q from app.po_lines where purchase_order_id=${id}::uuid) o where p.id=${id}::uuid`;
  };
  // r547: espejo inFlow de costos adicionales manuales (freight / nonVendorCosts por la cola normal upsertPO)
  if (op === "po_costos_extra_enqueue") return {
    outbox: await enqueue("upsertPO", String(b.id), {
      motivo: "costos_extra"
    })
  };
  if (op === "po_vendors") {
    const q = "%" + String(b.q || "").trim() + "%";
    return {
      vendors: await sql`select id, name, ruc, contact_name, email, phone, lead_time_days, discount::float discount, credit_days, payment_method, tipo, cobra_iva, iva_pct::float iva_pct, currency_id from app.vendors where is_active and app.mc_tokens_in(concat_ws(' ', name), ${String(b.q || "").trim()}) /* r521 palabra completa AND */ order by name limit 200`
    };
  }
  if (op === "po_productos") {
    // r531 EFCH: mismo selector que ventas (foto, código) + referencias de COMPRA: más bajo comprado (predeterminado), último comprado, último a este proveedor, costo actual
    const ids = (Array.isArray(b.product_ids) ? b.product_ids : []).map(U).filter(Boolean).slice(0, 200);
    const w = String(b.q || "").trim().split(/\s+/).filter(Boolean).slice(0, 5);
    if (!w.length && !ids.length) return {
      productos: []
    };
    let rows = ids.length ? await sql`select p.id, p.sku, p.name, p.unit_cost::float costo, (p.cost_prov_data->>'precio')::float prov_precio, p.last_vendor_id::text def_vid, v.img img_pub, coalesce((select sum(quantity) from app.stock_levels s where s.product_id=p.id),0)::float stock, v.codigo, v.categoria, v.img_storage from app.products p left join app.v_inventario_portal v on v.sku=p.sku where p.id = any(${ids}::uuid[])`.catch(()=>[]) : await sql`select p.id, p.sku, p.name, p.unit_cost::float costo, (p.cost_prov_data->>'precio')::float prov_precio, p.last_vendor_id::text def_vid, v.img img_pub, coalesce((select sum(quantity) from app.stock_levels s where s.product_id=p.id),0)::float stock, v.codigo, v.categoria, v.img_storage from app.products p join app.mc_prod_buscar(${w.join(' ')}) sq on sq.id=p.id left join app.v_inventario_portal v on v.sku=p.sku where p.is_active is not false and p.item_type<>'service' order by sq.score desc, p.sku limit 30`/* b459 ranking */ .catch(()=>[]);
    rows = rows.slice(0, ids.length ? 200 : 30);
    const vid = U(b.vendor_id);
    const R = {};
    if (rows.length) {
      const h = await sql`select l.product_id::text pid, round(l.unit_price*(1-coalesce(l.discount_pct,0)/100),4)::float p, o.order_number n, o.order_date::text f, o.vendor_id::text vid, vd.name prov
        from app.po_lines l join app.purchase_orders o on o.id=l.purchase_order_id left join app.vendors vd on vd.id=o.vendor_id
        where l.product_id = any(${rows.map((r)=>r.id)}::uuid[]) and not o.is_quote and not coalesce(o.is_cancelled,false) and l.unit_price>0 order by o.order_date desc nulls last, o.order_number desc`.catch(()=>[]);
      for (const x of h){
        const r = R[x.pid] = R[x.pid] || {
          min: null,
          ult: null,
          ultProv: null,
          n: 0,
          hist: []
        };
        const it = {
          p: x.p,
          n: x.n,
          f: String(x.f || '').slice(0, 10),
          prov: x.prov
        };
        r.n++;
        if (!r.ult) r.ult = it;
        if (vid && x.vid === vid && !r.ultProv) r.ultProv = it;
        if (!r.min || x.p < r.min.p) r.min = it;
        if (r.hist.length < 8) r.hist.push(it);
      }
    }
    // b516 EFCH 26/10: costo propuesto a una OC = más bajo comprado; si no hay compras = PRECIO PROVEEDOR (FOB): costo del proveedor (este / el por defecto / el menor) o el precio proveedor del calculador provisional. NUNCA el costo actual/landed.
    const PV = {};
    if (rows.length) for (const x of (await sql`select product_id::text pid, vendor_inflow_id::text vid, cost::float c from app.product_vendors where product_id = any(${rows.map((r)=>r.id)}::uuid[]) and cost > 0`.catch(()=>[])))(PV[x.pid] ??= []).push(x);
    const fobDe = (r)=>{
      const L = PV[r.id] || [];
      const e = vid && L.find((x)=>x.vid === vid) || r.def_vid && L.find((x)=>x.vid === r.def_vid);
      if (e) return {
        p: e.c,
        fuente: "proveedor del producto"
      };
      if (L.length) return {
        p: Math.min(...L.map((x)=>x.c)),
        fuente: "proveedor del producto"
      };
      if (r.prov_precio > 0) return {
        p: r.prov_precio,
        fuente: "calculador de costo (precio proveedor)"
      };
      return null;
    };
    const sg = await signPaths(rows.map((r)=>r.img_storage).filter(Boolean)).catch(()=>({}));
    rows = rows.map((r)=>{
      const o = {
        ...r,
        img: (r.img_storage ? sg[r.img_storage] : '') || r.img_pub || '',
        fob: fobDe(r),
        refsCompra: R[r.id] || {
          min: null,
          ult: null,
          ultProv: null,
          n: 0,
          hist: []
        }
      };
      delete o.img_storage;
      delete o.img_pub;
      delete o.prov_precio;
      delete o.def_vid;
      return o;
    });
    if (!b.permisos?.costos) rows.forEach((r)=>{
      delete r.costo;
      delete r.refsCompra;
      delete r.fob;
    });
    return {
      productos: rows
    };
  }
  // b555 (EFCH t1424u/t1425u): la demanda incluye los componentes de las listas de manufactura (kits y ensamblados) de OV abiertas, neta del stock del padre. // b341: «Pendientes» — informe de pendientes por recibir (OC) o por entregar (OV), formato Stock Pilot. URGENTE = la demanda
  // (OV abiertas sin despachar) supera el stock y lo que viene en OC; en OC marca las líneas que cubren esa falta.
  if (op === "po_pendientes" && (b.transito || b.tipo === "transito")) return await poTransito(b, sql, actor, signPaths); // b555 EFCH t1419u: «En tránsito» (va por po_pendientes: ya permitido en portal-api; permiso propio ~oc.e.transito validado aquí)
  if (op === "po_pendientes") {
    const so = b.tipo === "so";
    const pid = b.partner_id || null;
    const dem = await sql`with recursive st as (select product_id, sum(quantity)::float q from app.stock_levels group by 1),
      sod0 as (select l.product_id, sum(greatest(l.quantity - coalesce((select sum(k.quantity) from app.so_pick_lines k where k.sales_order_id=l.sales_order_id and k.product_id=l.product_id),0),0))::float q
        from app.sales_order_lines l join app.sales_orders o on o.id=l.sales_order_id where not o.is_quote and o.estado='abierta' and not coalesce(l.is_discarded,false) and l.product_id is not null group by 1),
      x(pid, q, d) as (select b.child_product_id, greatest(s.q - coalesce(st.q,0),0)*b.quantity::float, 1 from sod0 s join app.bom_lines b on b.product_id=s.product_id left join st on st.product_id=s.product_id where s.q - coalesce(st.q,0) > 0
        union all select b.child_product_id, greatest(x.q - coalesce(st.q,0),0)*b.quantity::float, x.d+1 from x join app.bom_lines b on b.product_id=x.pid left join st on st.product_id=x.pid where x.d < 4 and x.q - coalesce(st.q,0) > 0),
      sod as (select product_id, sum(q)::float q from (select product_id, q from sod0 union all select pid, q from x) t group by 1),
      pod as (select l.product_id, sum(greatest(l.quantity - coalesce((select sum(r.quantity) from app.po_receive_lines r where r.purchase_order_id=l.purchase_order_id and r.product_id=l.product_id),0),0))::float q
        from app.po_lines l join app.purchase_orders o on o.id=l.purchase_order_id where not o.is_quote and o.estado in ('abierta','parcial') and l.product_id is not null group by 1)
      select coalesce(sod.product_id,pod.product_id,st.product_id) product_id, coalesce(st.q,0) stock, coalesce(sod.q,0) demanda, coalesce(pod.q,0) en_oc from sod full join pod on pod.product_id=sod.product_id left join st on st.product_id=coalesce(sod.product_id,pod.product_id)`;
    const D = {};
    for (const r of dem)D[r.product_id] = r;
    const rows = so ? await sql`select o.id oid, o.order_number num, o.order_date::text fecha, c.name socio, l.product_id, p.sku, coalesce(p.name,l.description) nombre, cg.name categoria, l.quantity::float pedido,
          coalesce((select sum(k.quantity) from app.so_pick_lines k where k.sales_order_id=o.id and k.product_id=l.product_id),0)::float recibido, (l.subtotal/nullif(l.quantity,0))::float precio, l.plazo_entrega,
          (select i.storage_path from app.product_images i where i.product_id=l.product_id order by i.is_default desc nulls last, i.id limit 1) img_path
          from app.sales_orders o join app.sales_order_lines l on l.sales_order_id=o.id left join app.products p on p.id=l.product_id left join app.categories cg on cg.id=p.category_id left join app.customers c on c.id=o.customer_id
          where not o.is_quote and o.estado='abierta' and not coalesce(l.is_discarded,false) and l.product_id is not null and coalesce(p.item_type,'')<>'service' and (${pid}::text is null or o.customer_id::text=${pid}) order by o.order_date, o.order_number, l.line_num` : await sql`select o.id oid, o.order_number num, o.order_date::text fecha, v.name socio, l.product_id, p.sku, coalesce(p.name,l.description) nombre, cg.name categoria, l.vendor_item_code codigo, l.quantity::float pedido,
          coalesce((select sum(r.quantity) from app.po_receive_lines r where r.purchase_order_id=o.id and r.product_id=l.product_id),0)::float recibido, (l.subtotal/nullif(l.quantity,0))::float precio,
          (select i.storage_path from app.product_images i where i.product_id=l.product_id order by i.is_default desc nulls last, i.id limit 1) img_path
          from app.purchase_orders o join app.po_lines l on l.purchase_order_id=o.id left join app.products p on p.id=l.product_id left join app.categories cg on cg.id=p.category_id left join app.vendors v on v.id=o.vendor_id
          where not o.is_quote and o.estado in ('abierta','parcial') and l.product_id is not null and (${pid}::text is null or o.vendor_id::text=${pid}) order by o.order_date, o.order_number, l.line_num`;
    // b555 EFCH t1419u: Pendientes (OC) = pendiente de fábrica: se descuenta lo que ya viene en un costeo con packing (en tránsito)
    const TR = {};
    if (!so) for (const t of (await transitoRows(sql, pid)))TR[t.po_id + "|" + t.product_id] = (TR[t.po_id + "|" + t.product_id] || 0) + t.transito;
    const out = rows.map((r)=>{
      const k = r.oid + "|" + r.product_id, tq = Math.min(TR[k] || 0, Math.max(0, r.pedido - r.recibido));
      if (TR[k]) TR[k] -= tq; // misma OC con el producto en dos líneas: no descontar dos veces
      const pend = Math.max(0, r.pedido - r.recibido - tq);
      const d = D[r.product_id] || {
        stock: 0,
        demanda: 0,
        en_oc: 0
      };
      const urg = so ? pend > 0 && d.stock + d.en_oc < d.demanda && d.stock < pend : pend > 0 && d.demanda > d.stock;
      return {
        ...r,
        pendiente: pend,
        en_transito: tq,
        valor: mcRound(pend * (r.precio || 0) * 100) / 100,
        urgente: urg,
        stock: d.stock,
        demanda: d.demanda,
        en_oc: d.en_oc
      };
    }).filter((r)=>r.pendiente > 0);
    if (signPaths) {
      const sg = await signPaths(out.map((r)=>r.img_path).filter(Boolean));
      for (const r of out){
        r.img = sg[r.img_path] || "";
        delete r.img_path;
      }
    }
    return {
      tipo: so ? "so" : "po",
      lineas: out,
      generado: new Date().toISOString()
    };
  }
  if (op === "po_list") {
    const q = "%" + String(b.q || "").trim() + "%";
    return {
      ordenes: await sql`select p.id, p.order_number, p.is_quote, p.estado, p.order_date, p.due_date, p.total::float, p.balance::float, p.inventory_status, p.payment_status, p.sync_status, p.vendor_order_number, v.name proveedor,
        concat_ws(' ', v.name, p.vendor_order_number, (select string_agg(i.numero,' ') from app.po_invoices i where i.purchase_order_id=p.id), (select string_agg(coalesce(pr.sku,'')||' '||coalesce(pr.name,''),' ') from app.po_lines l join app.products pr on pr.id=l.product_id where l.purchase_order_id=p.id)) busca
      from app.purchase_orders p left join app.vendors v on v.id=p.vendor_id where app.mc_tokens_in(concat_ws(' ', p.order_number, v.name, p.vendor_order_number, (select string_agg(coalesce(pr.sku,'')||' '||coalesce(pr.name,'')||' '||coalesce(pr.busca,''),' ') from app.po_lines l join app.products pr on pr.id=l.product_id where l.purchase_order_id=p.id), (select string_agg(i.numero,' ') from app.po_invoices i where i.purchase_order_id=p.id)), ${String(b.q || "").trim()}) /* r521 palabra completa AND */
      and (${b.estado || null}::text is null or p.estado=${b.estado || null}) order by app.mc_fdoc(p.order_date) desc nulls last, app.mc_ndoc(p.order_number) desc, p.order_number desc, p.id limit ${Math.min(Number(b.limit) || 100, 5000)}`
    };
  }
  if (op === "po_get" && b.next_number) return {
    numero: (await sql`select app.doc_next(${b.next_number === "PQ" ? "PQ" : "PO"}) n`)[0].n
  }; // b313
  if (op === "po_get") {
    const p = await getPo(b.id);
    const [v] = p.vendor_id ? await sql`select * from app.vendors where id=${p.vendor_id}` : [
      null
    ];
    const lineas = await sql`select l.*, l.quantity::float quantity, l.unit_price::float unit_price, l.subtotal::float subtotal, pr.sku, pr.name nombre,
      coalesce((select sum(r.quantity) from app.po_receive_lines r where r.purchase_order_id=l.purchase_order_id and r.product_id=l.product_id),0)::float recibido,
      (select i.storage_path from app.product_images i where i.product_id=l.product_id order by i.is_default desc nulls last limit 1) img_path,
      coalesce((select nullif(trim(r9.default_sublocation),'') from app.product_reorder r9 where r9.product_id=l.product_id and r9.location_id=${p.location_id || LOC_PRINCIPAL}::uuid and coalesce(r9.default_sublocation,'')<>'' limit 1), (select nullif(trim(p9.default_sublocation),'') from app.products p9 where p9.id=l.product_id and (p9.default_location_id=${p.location_id || LOC_PRINCIPAL}::uuid or (p9.default_location_id is null and ${p.location_id || LOC_PRINCIPAL}::uuid='a4b0d9f6-9544-4200-aefa-43ed6c027484'::uuid))),'') sub_default /* b440: predeterminada por bodega */, (select rs.default_location_id from app.products rs where rs.id=l.product_id) loc_default,
      coalesce((select json_agg(json_build_object('sub',x.sublocation,'q',x.q) order by x.q desc) from (select s.sublocation, sum(s.quantity)::float q from app.stock_levels s where s.product_id=l.product_id and s.location_id=${p.location_id || LOC_PRINCIPAL} and s.sublocation<>'' group by 1) x),'[]') subs
      from app.po_lines l left join app.products pr on pr.id=l.product_id where l.purchase_order_id=${p.id} order by l.line_num`;
    const recepciones = await sql`select r.*, r.quantity::float quantity, pr.sku, pr.name nombre, (select i.storage_path from app.product_images i where i.product_id=r.product_id order by i.is_default desc nulls last limit 1) img_path, lo.name bodega from app.po_receive_lines r left join app.products pr on pr.id=r.product_id left join app.locations lo on lo.id=r.location_id where r.purchase_order_id=${p.id} order by r.receive_date`;
    const pagos = await sql`select *, amount::float amount from app.po_payments where purchase_order_id=${p.id} order by date_paid`;
    const facturas = await sql`select id, slot, numero, fecha::text fecha, monto::float monto, link, fuente from app.po_invoices where purchase_order_id=${p.id} order by slot nulls last, id`;
    // número de factura citado en la referencia/nota del pago (exacto contra facturas de la OC o patrón SRI 001-002-000000286)
    for (const g of pagos){
      const t = `${g.reference_number || ""} ${g.remarks || ""}`;
      const f = facturas.find((x)=>t.includes(x.numero));
      const m = t.match(/\b\d{3}-\d{3}-\d{3,9}\b/);
      g.factura = f?.numero || m?.[0] || null;
    }
    const cola = await sql`select id, op, status, error, attempts, created_at from app.po_outbox where po_id=${p.id} order by id desc limit 20`;
    if (signPaths) {
      const sg = await signPaths([
        ...lineas.map((l)=>l.img_path),
        ...recepciones.map((r)=>r.img_path)
      ]);
      for (const x of [
        ...lineas,
        ...recepciones
      ]){
        x.img = sg[x.img_path] || "";
        delete x.img_path;
      }
    }
    const [lo] = await sql`select name from app.locations where id=${p.location_id || LOC_PRINCIPAL}`;
    const subsB = (await sql`select distinct sublocation s from app.stock_levels where location_id=${p.location_id || LOC_PRINCIPAL} and sublocation<>'' order by 1 limit 2000`).map((x)=>x.s);
    const adjuntos = await listarAdjuntos(sql, p.id, signPaths);
    // r535: factura ↔ adjunto por número normalizado (serie + secuencial: F001-00050279 = 001-00050279 = 20100060311-01-F001-00050279.pdf)
    const fkey = (t)=>{
      let x = String(t || "").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/^\d{10,13}-\d{2}-/, "");
      const g = (x.match(/\d+/g) || []).filter((d)=>!/^20\d{6}$/.test(d));
      if (!g.length) return null;
      const m = x.match(/(\d{3})-(\d{3,9})\D*$/);
      return m ? {
        s: m[1],
        n: +m[2]
      } : {
        s: null,
        n: +g[g.length - 1]
      };
    };
    const noFac = /swift|pago|ret-|retenc/i;
    for (const f of facturas){
      const k = fkey(f.numero);
      const a = adjuntos.find((x)=>x.nombre.includes(f.numero)) || k && adjuntos.find((x)=>{
        if (noFac.test(x.nombre)) return false;
        const j = fkey(x.nombre);
        return j && j.n === k.n && (!j.s || !k.s || j.s === k.s);
      });
      if (a) {
        f.adj_url = a.url;
        f.adj_nombre = a.nombre;
        f.adj_mime = a.mime || "";
        f.adj_id = a.id;
      }
    }
    const devoluciones = await sql`select r.*, r.quantity::float quantity, pr.sku, pr.name nombre, lo.name bodega from app.po_return_lines r left join app.products pr on pr.id=r.product_id left join app.locations lo on lo.id=r.location_id where r.purchase_order_id=${p.id} order by r.return_date`; // b296
    return {
      orden: p,
      proveedor: v,
      lineas,
      recepciones,
      devoluciones,
      pagos,
      facturas,
      adjuntos,
      cola,
      bodega: lo?.name || "",
      subsBodega: subsB,
      bodegas: await sql`select id, name from app.locations where coalesce(is_active,true) order by name`
    };
  }
  if (op === "po_recomendaciones") {
    const [r] = await sql`select app.po_recomendaciones(${U(b.vendor_id)}::uuid, ${b.estricto === false ? false : true}) r`;
    return r.r;
  }
  if (op === "po_reco_cotizar") {
    const vid = U(b.vendor_id);
    if (!vid) throw new Error("Elige el proveedor");
    const L = (b.lineas || []).filter((l)=>U(l.product_id) && Number(l.quantity) > 0);
    if (!L.length) throw new Error("No hay líneas con cantidad");
    const nota = String(b.nota || "").trim().slice(0, 1000) || null;
    return await compras("po_save", {
      orden: {
        vendor_id: vid,
        is_quote: true,
        payment_terms_id: U(b.payment_terms_id),
        order_remarks: nota
      },
      lineas: L.map((l)=>({
          product_id: l.product_id,
          quantity: Number(l.quantity),
          unit_price: Math.max(0, Number(l.unit_price) || 0),
          description: l.description || null,
          vendor_item_code: l.vendor_item_code || null
        }))
    }, sql, actor, LOC_PRINCIPAL, signPaths);
  }
  if (op === "po_save") {
    if (b.renombrar) {
      const nv = String(b.nuevo || "").trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9\-_.\/]{2,40}$/.test(nv)) throw new Error("Número inválido: solo letras, números y - _ . /");
      const [p0] = await sql`select id, order_number from app.purchase_orders where id=${String(b.id)}::uuid`;
      if (!p0) throw new Error("OC no existe");
      if (p0.order_number === nv) return {
        ok: true,
        id: p0.id,
        order_number: nv,
        sin_cambio: true
      };
      const [d] = await sql`select 1 from app.purchase_orders where upper(order_number)=${nv} and id<>${p0.id} union all select 1 from app.sales_orders where upper(order_number)=${nv} union all select 1 from app.document_numbers where upper(number)=${nv} and doc_id is distinct from ${p0.id}::uuid limit 1`;
      if (d) throw new Error("El número " + nv + " ya existe. Usa otro.");
      await sql`update app.purchase_orders set order_number=${nv} where id=${p0.id}`;
      await sql`update app.document_numbers set number=${nv} where doc_id=${p0.id}::uuid and number=${p0.order_number}`;
      const ob = await enqueue("setPONumber", p0.id, {
        antes: p0.order_number,
        nuevo: nv
      });
      return {
        ok: true,
        id: p0.id,
        order_number: nv,
        antes: p0.order_number,
        outbox: ob
      };
    }
    const o = b.orden || {};
    const L = b.lineas || [];
    if (!L.length) throw new Error("La OC no tiene líneas");
    for (const l of L){
      if (!U(l.product_id)) throw new Error("Línea sin producto");
      if (!(Number(l.quantity) > 0)) throw new Error("Cantidad inválida");
      if (Number(l.unit_price) < 0) throw new Error("Precio inválido");
    }
    if (!U(o.vendor_id)) throw new Error("Elige el proveedor");
    let id = U(o.id);
    let docNum = null; // r452 t2146u: número del documento para codPersistir (antes `num` no existía → «num is not defined» al guardar líneas con código de proveedor)
    const revPO = [];
    const prevIds = new Set();
    const prevInf = {};
    const antesPO = id ? await sql`select product_id, quantity::float q, unit_price::float pu, discount_pct::float d from app.po_lines where purchase_order_id=${id} order by line_num` : [];
    // t1976 (EFCH t1976u «si yo cambio algo, toca cambiar»): costo final por producto ANTES de editar; al guardar, la diferencia va al stock que queda y a las OV que ya vendieron ese lote.
    const landedAntes = id ? await sql`select product_id::text pid, unit_landed::float u from app.v_po_landed_mc where po=${id}::uuid` : [];
    await sql.begin(async (t)=>{
      if (id) {
        const [p] = await t`select * from app.purchase_orders where id=${id} for update`;
        if (!p) throw new Error("OC no existe");
        if (p.is_cancelled) throw new Error("OC cancelada");
        docNum = p.order_number;
        // b310: si se quita o baja una línea ya recibida, se descuenta el stock de donde se recibió (la recepción más reciente primero); si ya no está ahí, se bloquea con mensaje claro
        const nq = {};
        for (const l of L)nq[l.product_id] = (nq[l.product_id] || 0) + Number(l.quantity);
        const rcv = await t`select product_id, sum(quantity)::float q from app.po_receive_lines where purchase_order_id=${id} group by 1`;
        for (const r of rcv){
          const [rt] = await t`select coalesce(sum(quantity),0)::float q from app.po_return_lines where purchase_order_id=${id} and product_id=${r.product_id}`;
          let exc = Math.round((r.q - rt.q - (nq[r.product_id] || 0)) * 1e6) / 1e6;
          if (!(exc > 1e-9)) continue;
          const rl = await t`select r.id, r.location_id, r.sublocation, r.quantity::float q, pr.sku, lo.name bodega from app.po_receive_lines r left join app.products pr on pr.id=r.product_id left join app.locations lo on lo.id=r.location_id where r.purchase_order_id=${id} and r.product_id=${r.product_id} order by r.receive_date desc nulls last, r.id desc`;
          for (const x of rl){
            if (exc <= 1e-9) break;
            const d = Math.min(exc, x.q);
            const sub = x.sublocation || "";
            const [s0] = await t`select coalesce(sum(quantity),0)::float q from app.stock_levels where product_id=${r.product_id} and location_id=${x.location_id} and sublocation=${sub} and serial=''`;
            if (s0.q + 1e-9 < d) throw new Error(`No se puede bajar ${x.sku}: se recibieron ${d} en ${x.bodega || "bodega"} ${sub || "(sin sububicación)"} y ahí solo quedan ${s0.q}. Mueve el stock de vuelta o haz una devolución.`);
            await t`update app.stock_levels set quantity=quantity-${d}, updated_at=now() where product_id=${r.product_id} and location_id=${x.location_id} and sublocation=${sub} and serial=''`;
            await t`insert into app.stock_local_moves ${t({
              actor,
              product_id: r.product_id,
              location_id: x.location_id,
              sublocation: sub,
              delta: -d,
              kind: "po_receive",
              po_id: id,
              status: "pendiente",
              nota: "edición de líneas · " + p.order_number + " " + x.id
            })}`;
            if (d >= x.q - 1e-9) await t`delete from app.po_receive_lines where id=${x.id}`;
            else await t`update app.po_receive_lines set quantity=quantity-${d} where id=${x.id}`;
            revPO.push({
              sku: x.sku,
              product_id: r.product_id,
              location_id: x.location_id,
              sublocation: sub,
              q: d
            });
            exc -= d;
          }
        }
        if (revPO.length || JSON.stringify(antesPO) !== "[]") await t`insert into app.audit_log(actor, accion, tabla, ref_id, detalle) values (${actor}, 'editar_lineas', 'purchase_orders', ${id}, ${t.json({
          antes: antesPO,
          despues: L.map((l)=>({
              product_id: l.product_id,
              q: Number(l.quantity),
              pu: Number(l.unit_price),
              d: Number(l.discount_pct) || 0
            })),
          stock_descontado: revPO
        })})`;
        await t`update app.purchase_orders set vendor_id=${o.vendor_id}, location_id=${U(o.location_id) || p.location_id}, due_date=${o.due_date || null}, vendor_order_number=${o.vendor_order_number || null},
          order_remarks=${o.order_remarks || null}, version=version+1, updated_at=now() where id=${id}`;
        for (const r of (await t`select id, inflow_id from app.po_lines where purchase_order_id=${id}`)){
          prevIds.add(r.id);
          prevInf[r.id] = r.inflow_id;
        } // b310: conservar IDs de línea (= IDs de inFlow)
        await t`delete from app.po_lines where purchase_order_id=${id}`;
      } else {
        const quote = o.is_quote === true;
        const pre = quote ? "MCOR-PQ-" : "MCOR-PO-";
        await t`select pg_advisory_xact_lock(hashtext(${pre}))`;
        const [mx] = await t`select app.doc_next(${quote ? "PQ" : "PO"}) n`; // b290
        let num1 = mx.n;
        const cust = String(o.order_number || "").trim().toUpperCase(); // b313: número editable
        if (cust && cust !== num1) {
          if (!/^[A-Z0-9][A-Z0-9\-_.\/]{2,40}$/.test(cust)) throw new Error("Número inválido: solo letras, números y - _ . /");
          const [d] = await t`select 1 from app.purchase_orders where upper(order_number)=${cust} union all select 1 from app.sales_orders where upper(order_number)=${cust} limit 1`;
          if (d) throw new Error("El número " + cust + " ya existe. Usa otro.");
          num1 = cust;
        }
        const [vd] = await t`select contact_name, email, phone, default_payment_terms_id, default_carrier from app.vendors where id=${o.vendor_id}`; // b279: valores del proveedor (editables)
        const [p] = await t`insert into app.purchase_orders ${t({
          contact_name: vd?.contact_name || null,
          email: vd?.email || null,
          phone: vd?.phone || null,
          payment_terms_id: U(o.payment_terms_id) || vd?.default_payment_terms_id || null,
          carrier: vd?.default_carrier || null,
          order_number: num1,
          is_quote: quote,
          vendor_id: o.vendor_id,
          location_id: U(o.location_id) || LOC_PRINCIPAL,
          due_date: o.due_date || null,
          vendor_order_number: o.vendor_order_number || null,
          order_remarks: o.order_remarks || null,
          estado: quote ? "cotizacion" : "abierta",
          payment_status: quote ? "quote" : "unpaid",
          source: "minecore",
          sync_status: "local",
          created_by: actor
        })} returning id`;
        id = p.id;
        docNum = num1;
      }
      let n = 0;
      for (const l of L){
        const st = r2(Number(l.quantity) * Number(l.unit_price) * (1 - (Number(l.discount_pct) || 0) / 100));
        const vic = l.vendor_item_code ? codClean(l.vendor_item_code) : null;
        await t`insert into app.po_lines ${t({
          ...U(l.id) && prevIds.has(U(l.id)) ? {
            id: U(l.id),
            inflow_id: prevInf[U(l.id)] || null
          } : {},
          purchase_order_id: id,
          line_num: ++n,
          product_id: l.product_id,
          description: l.description || null,
          vendor_item_code: vic,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price) || 0,
          discount_pct: Number(l.discount_pct) || 0,
          subtotal: st
        })}`;
        if (l.product_id && vic) await codPersistir(t, {
          productId: l.product_id,
          vendorId: o.vendor_id,
          codeRaw: vic,
          source: "po_line_save",
          sourceRef: docNum,
          actor
        });
      }
    });
    if (o.non_vendor_costs !== undefined || o.freight !== undefined) {
      const nv = o.non_vendor_costs;
      const v = nv == null || nv === "" ? null : Number(nv.value ?? nv);
      if (v != null && (isNaN(v) || v < 0)) throw new Error("Costo no-proveedor inválido");
      const fr = o.freight === undefined ? undefined : Number(o.freight) || 0;
      if (fr != null && fr < 0) throw new Error("Flete inválido");
      await sql`update app.purchase_orders set non_vendor_costs=${v == null ? null : sql.json({
        value: v,
        isPercent: !!(nv && nv.isPercent)
      })}, freight=coalesce(${fr ?? null}::numeric, freight), updated_at=now() where id=${id}`;
    }
    await recalc(id);
    const ajustesCosto = [];
    if (landedAntes.length) {
      const [st] = await sql`select inventory_status, order_number, version from app.purchase_orders where id=${id}::uuid`;
      if (st && st.inventory_status !== "unfulfilled") {
        const desp = await sql`select product_id::text pid, unit_landed::float u, q::float q from app.v_po_landed_mc where po=${id}::uuid`;
        for (const d of desp){
          const a0 = landedAntes.find((x)=>x.pid === d.pid);
          if (!a0 || a0.u == null || d.u == null) continue;
          const du = d.u - a0.u;
          if (Math.abs(du) < 1e-6) continue;
          const [rq] = await sql`select greatest(
              coalesce((select sum(delta) from app.stock_local_moves where po_id=${id}::uuid and product_id=${d.pid}::uuid and kind='po_receive' and coalesce(status,'')<>'anulado'),0),
              coalesce((select sum(quantity) from app.po_receive_lines where purchase_order_id=${id}::uuid and product_id=${d.pid}::uuid),0))::float q`;
          const q = Math.min(rq.q, d.q);
          if (!(q > 0)) continue;
          const [r] = await sql`select app.oc_costo_cambio(${id}::uuid, ${d.pid}::uuid, ${du}, ${q}, ${"Edición de costo " + st.order_number}, ${actor}, ${"minecore edición OC " + st.order_number}, ${"editar_oc:" + id + ":v" + st.version + ":" + d.pid}) r`;
          ajustesCosto.push(r.r);
        }
        if (ajustesCosto.length) await sql`insert into app.audit_log(actor, accion, tabla, ref_id, detalle) values (${actor}, 'costo_oc_editada', 'purchase_orders', ${id}, ${sql.json({
          ajustes_costo: ajustesCosto
        })})`;
      }
    }
    const ob = await enqueue("upsertPO", id, {
      motivo: "guardar"
    });
    const [p] = await sql`select order_number from app.purchase_orders where id=${id}`;
    return {
      id,
      order_number: p.order_number,
      outbox: ob,
      stock_descontado: revPO,
      ajustes_costo: ajustesCosto
    };
  }
  if (op === "po_receive") {
    const p = await getPo(b.id);
    if (p.is_cancelled || p.is_quote) throw new Error("Solo OC abiertas");
    const L = b.lineas || [];
    if (!L.length) throw new Error("Indica qué se recibe");
    await sql.begin(async (t)=>{
      for (const x of L){
        const q = Number(x.quantity);
        if (!(q > 0)) throw new Error("Cantidad inválida");
        const [ol] = await t`select coalesce(sum(quantity),0)::float q from app.po_lines where purchase_order_id=${p.id} and product_id=${x.product_id}`;
        const [rc] = await t`select coalesce(sum(quantity),0)::float q from app.po_receive_lines where purchase_order_id=${p.id} and product_id=${x.product_id}`;
        if (rc.q + q > ol.q + 1e-9) throw new Error(`Recibes más de lo pedido (pedido ${ol.q}, ya recibido ${rc.q})`);
        const loc = U(x.location_id) || p.location_id || LOC_PRINCIPAL;
        let sub = String(x.sublocation || "").trim().toUpperCase();
        if (x.sublocation == null) {
          const [d] = await t`select coalesce((select nullif(trim(r9.default_sublocation),'') from app.product_reorder r9 where r9.product_id=${x.product_id}::uuid and r9.location_id=${loc}::uuid and coalesce(r9.default_sublocation,'')<>'' limit 1),
            (select nullif(trim(p9.default_sublocation),'') from app.products p9 where p9.id=${x.product_id}::uuid and (p9.default_location_id=${loc}::uuid or (p9.default_location_id is null and ${loc}::uuid=${LOC_PRINCIPAL}::uuid))),'') d`;
          sub = String(d?.d || "").toUpperCase();
        }
        const [r] = await t`insert into app.po_receive_lines ${t({
          purchase_order_id: p.id,
          product_id: x.product_id,
          quantity: q,
          location_id: loc,
          sublocation: sub,
          serials: x.serials || [],
          created_by: actor
        })} returning id`;
        const u = await t`update app.stock_levels set quantity=quantity+${q}, updated_at=now() where product_id=${x.product_id} and location_id=${loc} and sublocation=${sub} and serial='' returning 1`;
        if (!u.length) await t`insert into app.stock_levels(product_id,location_id,sublocation,serial,quantity) values (${x.product_id},${loc},${sub},'',${q})`;
        await t`insert into app.stock_local_moves ${t({
          actor,
          product_id: x.product_id,
          location_id: loc,
          sublocation: sub,
          delta: q,
          kind: "po_receive",
          po_id: p.id,
          status: "pendiente",
          nota: "recepción " + p.order_number + " " + r.id
        })}`;
      }
    });
    await recalc(p.id);
    const ob = await enqueue("upsertPO", p.id, {
      motivo: "recibir",
      lineas: L
    });
    return {
      outbox: ob
    };
  }
  if (op === "po_facturas_save") {
    const p = await getPo(b.id);
    const fs = (Array.isArray(b.facturas) ? b.facturas : []).map((f)=>({
        numero: String(f.numero || "").trim().slice(0, 60),
        fecha: /^\d{4}-\d{2}-\d{2}$/.test(f.fecha || "") ? f.fecha : null,
        monto: f.monto === "" || f.monto == null || isNaN(Number(f.monto)) ? null : r2(f.monto),
        link: /^https:\/\//.test(f.link || "") ? String(f.link).slice(0, 500) : null,
        fuente: String(f.fuente || "Minecore").slice(0, 80)
      })).filter((f)=>f.numero);
    if (fs.length > 5) throw new Error("Máximo 5 facturas por OC (campos Factura proveedor 1-5)");
    if (new Set(fs.map((f)=>f.numero)).size !== fs.length) throw new Error("Factura repetida");
    await sql.begin(async (t)=>{
      await t`delete from app.po_invoices where purchase_order_id=${p.id}`;
      for (const [i, f] of fs.entries())await t`insert into app.po_invoices ${t({
        purchase_order_id: p.id,
        slot: i + 1,
        ...f,
        created_by: actor
      })}`;
      await t`update app.purchase_orders set factura_proveedor=${fs[0]?.numero || null} where id=${p.id}`;
    });
    const ob = p.is_cancelled ? null : await enqueue("upsertPO", p.id, {
      motivo: "facturas",
      n: fs.length
    });
    return {
      facturas: await sql`select id, slot, numero, fecha::text fecha, monto::float monto, link, fuente from app.po_invoices where purchase_order_id=${p.id} order by slot`,
      outbox: ob
    };
  }
  if (op === "po_adjuntar") {
    const p = await getPo(b.id);
    return await guardarAdjunto(sql, "po", p.id, b.nombre, b.base64, actor);
  }
  if (op === "po_payment") {
    const p = await getPo(b.id);
    if (p.is_quote) throw new Error("Solo OC");
    const a = r2(b.amount);
    if (!a) throw new Error("Monto inválido");
    await sql`insert into app.po_payments ${sql({
      purchase_order_id: p.id,
      amount: a,
      date_paid: b.fecha || new Date().toISOString(),
      payment_method: b.metodo || null,
      payment_type: a < 0 ? "Refund" : "Payment",
      reference_number: b.referencia || null,
      remarks: b.nota || null,
      created_by: actor
    })}`;
    const [rs] = await sql`select round(p.total - coalesce((select sum(amount) from app.po_payments where purchase_order_id=p.id),0),2)::float r from app.purchase_orders p where p.id=${p.id}`;
    if (rs && rs.r !== 0 && Math.abs(rs.r) <= 0.05) await sql`insert into app.po_payments ${sql({
      purchase_order_id: p.id,
      amount: rs.r,
      payment_method: "Ajuste redondeo",
      payment_type: rs.r < 0 ? "Refund" : "Payment",
      remarks: "Cierre automático de saldo ≤ $0.05",
      created_by: actor
    })}`;
    await recalc(p.id);
    const ob = await enqueue("upsertPO", p.id, {
      motivo: "pago",
      amount: a
    });
    const [x] = await sql`select amount_paid::float, balance::float, payment_status from app.purchase_orders where id=${p.id}`;
    return {
      ...x,
      outbox: ob
    };
  }
  if (op === "po_payment_edit" || op === "po_payment_delete") {
    const p = await getPo(b.id);
    const [x] = await sql`select * from app.po_payments where id=${U(b.pay_id) || null}::uuid and purchase_order_id=${p.id}`;
    if (!x) throw new Error("Pago no existe");
    let borrar = [];
    if (op === "po_payment_delete") {
      borrar = [
        x.inflow_id || x.id
      ];
      await sql`delete from app.po_payments where id=${x.id}`;
    } else {
      const a = r2(b.amount ?? x.amount);
      if (!a) throw new Error("Monto inválido");
      const [ot] = await sql`select round(coalesce(sum(amount),0),2)::float o, (select total::float from app.purchase_orders where id=${p.id}) tot from app.po_payments where purchase_order_id=${p.id} and id<>${x.id}`;
      if (ot.o + a > ot.tot + 0.05) throw new Error("Los pagos (" + r2(ot.o + a) + ") superarían el total de la OC (" + ot.tot + ")");
      const f = b.fecha ? new Date(String(b.fecha).length <= 10 ? b.fecha + "T12:00:00-05:00" : b.fecha).toISOString() : x.date_paid;
      await sql`update app.po_payments set amount=${a}, date_paid=${f}, payment_method=${b.metodo ?? x.payment_method}, payment_type=${a < 0 ? "Refund" : "Payment"}, reference_number=${b.referencia ?? x.reference_number}, remarks=${b.nota ?? x.remarks} where id=${x.id}`;
    }
    await recalc(p.id);
    const ob = await enqueue("upsertPO", p.id, {
      motivo: op,
      pago: x.id,
      borrar
    });
    const [y] = await sql`select amount_paid::float, balance::float, payment_status from app.purchase_orders where id=${p.id}`;
    return {
      ...y,
      outbox: ob
    };
  }
  if (op === "po_aprobar") {
    const p = await getPo(b.id);
    if (p.is_cancelled) throw new Error("OC cancelada");
    if (!p.is_quote) return {
      ya: true,
      order_number: p.order_number
    };
    await sql`update app.purchase_orders set is_quote=false, version=version+1, updated_at=now() where id=${p.id}`;
    await recalc(p.id);
    const ob = await enqueue("upsertPO", p.id, {
      motivo: "aprobar"
    });
    return {
      order_number: p.order_number,
      outbox: ob
    };
  }
  if (op === "po_receive_undo" || op === "po_return") {
    const p = await getPo(b.id);
    if (p.is_cancelled || p.is_quote) throw new Error("Solo OC abiertas");
    if (!b.permisos?.costos) throw new Error("Solo administración");
    await sql.begin(async (t)=>{
      const baja = async (pid, loc, sub, q, kind, nota)=>{
        const [s0] = await t`select coalesce(sum(quantity),0)::float q from app.stock_levels where product_id=${pid} and location_id=${loc} and sublocation=${sub} and serial=''`;
        if (s0.q + 1e-9 < q) throw new Error(`Stock insuficiente en ${sub || "(sin sububicación)"}: hay ${s0.q}`);
        await t`update app.stock_levels set quantity=quantity-${q}, updated_at=now() where product_id=${pid} and location_id=${loc} and sublocation=${sub} and serial=''`;
        await t`insert into app.stock_local_moves ${t({
          actor,
          product_id: pid,
          location_id: loc,
          sublocation: sub,
          delta: -q,
          kind: "po_receive",
          po_id: p.id,
          status: "pendiente",
          nota: kind + " · " + nota
        })}`;
      };
      if (op === "po_receive_undo") {
        const [r] = await t`select *, quantity::float q from app.po_receive_lines where id=${U(b.receive_line_id)} and purchase_order_id=${p.id}`;
        if (!r) throw new Error("Recepción no existe");
        const q = b.quantity == null ? r.q : Number(b.quantity);
        if (!(q > 0) || q > r.q + 1e-9) throw new Error("Cantidad inválida");
        const [rt] = await t`select coalesce(sum(quantity),0)::float q from app.po_return_lines where purchase_order_id=${p.id} and product_id=${r.product_id}`;
        const [rc] = await t`select coalesce(sum(quantity),0)::float q from app.po_receive_lines where purchase_order_id=${p.id} and product_id=${r.product_id}`;
        if (rc.q - q + 1e-9 < rt.q) throw new Error("Ya hay devoluciones de este producto; anula primero la devolución");
        await baja(r.product_id, r.location_id, r.sublocation || "", q, "po_receive_undo", "deshacer recepción " + p.order_number + " " + r.id);
        if (q >= r.q - 1e-9) await t`delete from app.po_receive_lines where id=${r.id}`;
        else await t`update app.po_receive_lines set quantity=quantity-${q} where id=${r.id}`;
      } else {
        const L = b.lineas || [];
        if (!L.length) throw new Error("Indica qué se devuelve");
        for (const x of L){
          const q = Number(x.quantity);
          if (!(q > 0) || !U(x.product_id)) throw new Error("Cantidad inválida");
          const [rc] = await t`select coalesce(sum(quantity),0)::float q from app.po_receive_lines where purchase_order_id=${p.id} and product_id=${x.product_id}`;
          const [rt] = await t`select coalesce(sum(quantity),0)::float q from app.po_return_lines where purchase_order_id=${p.id} and product_id=${x.product_id}`;
          if (rt.q + q > rc.q + 1e-9) throw new Error(`Devuelves más de lo recibido (recibido ${rc.q}, ya devuelto ${rt.q})`);
          const loc = U(x.location_id) || p.location_id || LOC_PRINCIPAL;
          const sub = String(x.sublocation || "").trim().toUpperCase();
          const [r] = await t`insert into app.po_return_lines ${t({
            purchase_order_id: p.id,
            product_id: x.product_id,
            quantity: q,
            location_id: loc,
            sublocation: sub,
            motivo: String(x.motivo || b.motivo || "").slice(0, 300) || null,
            created_by: actor
          })} returning id`;
          await baja(x.product_id, loc, sub, q, "po_return", "devolución " + p.order_number + " " + r.id);
        }
      }
    });
    await recalc(p.id);
    const ob = await enqueue("upsertPO", p.id, {
      motivo: op === "po_return" ? "devolucion" : "deshacer_recepcion"
    });
    return {
      outbox: ob
    };
  }
  if (op === "po_cancel") {
    const p = await getPo(b.id);
    if (p.is_cancelled) throw new Error("Ya está cancelada");
    await sql.begin(async (t)=>{
      await t`update app.purchase_orders set is_cancelled=true, estado='cancelada', version=version+1, updated_at=now() where id=${p.id}`;
      // la recepción se revierte en el stock local al instante (inFlow la revierte con quick-cancel)
      const mv = await t`update app.stock_local_moves set status='anulado' where po_id=${p.id} and status in ('pendiente','enviado') returning product_id, location_id, sublocation, delta`;
      for (const r of mv)await t`update app.stock_levels set quantity=quantity-${r.delta} where product_id=${r.product_id} and location_id=${r.location_id} and sublocation=${r.sublocation} and serial=''`;
      // b330: como inFlow, cancelar deja la OC sin recibir (se borran las líneas de recepción y el estado de inventario vuelve a 'unfulfilled')
      await t`delete from app.po_receive_lines where purchase_order_id=${p.id}`;
      await t`update app.purchase_orders set inventory_status='unfulfilled' where id=${p.id}`;
    });
    const ob = await enqueue("cancelPO", p.id, {});
    return {
      outbox: ob
    };
  }
  return null;
}
// b555 EFCH t1419u/t1420u: líneas en tránsito = costeos con packing (no anulados, no cerrados, no prueba) aún no recibidas
async function transitoRows(sql, pid) {
  return await sql`select l.id, i.codigo costeo, i.estado costeo_estado, i.fecha::text costeo_fecha, l.po_id, o.order_number num, o.order_date::text fecha, o.vendor_id, coalesce(v.name, l.proveedor) socio,
      l.product_id, coalesce(p.sku, l.sku) sku, coalesce(p.name, l.descripcion) nombre, cg.name categoria, l.codigo_proveedor codigo, l.factura, l.qty_packing::float packing, coalesce(l.qty_recibida,0)::float recibido,
      greatest(l.qty_packing - coalesce(l.qty_recibida,0), 0)::float transito, l.valor_u::float precio, l.estado linea_estado,
      (select pl.quantity from app.po_lines pl where pl.purchase_order_id=l.po_id and pl.product_id=l.product_id order by pl.line_num limit 1)::float pedido_oc,
      (select im.storage_path from app.product_images im where im.product_id=l.product_id order by im.is_default desc nulls last, im.id limit 1) img_path
    from app.costeo_lines l join app.costeo_imports i on i.id=l.import_id left join app.purchase_orders o on o.id=l.po_id left join app.vendors v on v.id=coalesce(o.vendor_id, l.vendor_id)
      left join app.products p on p.id=l.product_id left join app.categories cg on cg.id=p.category_id
    where l.qty_packing is not null and l.qty_packing - coalesce(l.qty_recibida,0) > 0 and coalesce(i.estado,'') not ilike 'anul%' and coalesce(i.estado,'') not ilike 'cerrad%' and not coalesce(i.prueba,false)
      and (${pid}::text is null or coalesce(o.vendor_id, l.vendor_id)::text=${pid}) order by i.codigo, o.order_date, o.order_number, l.item`;
}
export async function puedeTransito(sql, actor) {
  const [u] = await sql`select rol, modulos from app.portal_users where lower(nombre)=lower(${String(actor || "")}) and activo limit 1`;
  if (!u) return false;
  return u.rol === "admin" || (u.modulos || []).includes("~oc.e.transito=1");
}
async function poTransito(b, sql, actor, signPaths) {
  if (!await puedeTransito(sql, actor)) throw new Error("Tu usuario no tiene permiso para «En tránsito». Pídelo en Administración → Usuarios.");
  const pid = U(b.partner_id);
  const L = await transitoRows(sql, pid);
  const ids = [
    ...new Set(L.map((l)=>l.product_id).filter(Boolean))
  ];
  const st = ids.length ? await sql`select product_id, sum(quantity)::float q from app.stock_levels where product_id = any(${ids}::uuid[]) group by 1` : [];
  const dem = ids.length ? await sql`select product_id, sum(greatest(q,0))::float q from (select l.product_id, l.quantity - coalesce((select sum(k.quantity) from app.so_pick_lines k where k.sales_order_id=l.sales_order_id and k.product_id=l.product_id),0) q
      from app.sales_order_lines l join app.sales_orders o on o.id=l.sales_order_id where not o.is_quote and o.estado='abierta' and not coalesce(l.is_discarded,false) and l.product_id = any(${ids}::uuid[])) t group by 1` : [];
  const S = {}, DM = {};
  for (const r of st)S[r.product_id] = r.q;
  for (const r of dem)DM[r.product_id] = r.q;
  const lineas = L.map((l)=>({
      ...l,
      pendiente: l.transito,
      valor: mcRound(l.transito * (l.precio || 0) * 100) / 100,
      stock: S[l.product_id] || 0,
      demanda: DM[l.product_id] || 0,
      urgente: (DM[l.product_id] || 0) > (S[l.product_id] || 0)
    }));
  // Segunda sección: OV abiertas que se surten con lo en tránsito. Orden: fecha de OV (más antigua primero); primero se usa el stock, luego lo en tránsito.
  const ovl = ids.length ? await sql`select o.id oid, o.order_number num, o.order_date::text fecha, c.name cliente, l.product_id, p.sku, coalesce(p.name,l.description) nombre,
      greatest(l.quantity - coalesce((select sum(k.quantity) from app.so_pick_lines k where k.sales_order_id=o.id and k.product_id=l.product_id),0),0)::float q
      from app.sales_orders o join app.sales_order_lines l on l.sales_order_id=o.id left join app.products p on p.id=l.product_id left join app.customers c on c.id=o.customer_id
      where not o.is_quote and o.estado='abierta' and not coalesce(l.is_discarded,false) and l.product_id is not null and coalesce(p.item_type,'')<>'service'
        and o.id in (select l2.sales_order_id from app.sales_order_lines l2 where l2.product_id = any(${ids}::uuid[]) and not coalesce(l2.is_discarded,false))
      order by app.mc_fdoc(o.order_date) nulls last, app.mc_ndoc(o.order_number), o.order_number, l.line_num` : [];
  const allIds = [
    ...new Set(ovl.map((r)=>r.product_id))
  ];
  const stAll = allIds.length ? await sql`select product_id, sum(quantity)::float q from app.stock_levels where product_id = any(${allIds}::uuid[]) group by 1` : [];
  const SA = {}, TQ = {};
  for (const r of stAll)SA[r.product_id] = Math.max(0, r.q);
  for (const l of L)TQ[l.product_id] = (TQ[l.product_id] || 0) + l.transito;
  const O = {}, ord = [];
  for (const r of ovl){
    if (!(r.q > 0)) continue;
    if (!O[r.oid]) {
      O[r.oid] = {
        num: r.num,
        fecha: r.fecha,
        cliente: r.cliente,
        cubre: [],
        faltan: [],
        con_stock: []
      };
      ord.push(r.oid);
    }
    const g = O[r.oid];
    let need = r.q;
    const s = Math.min(need, SA[r.product_id] || 0);
    SA[r.product_id] = (SA[r.product_id] || 0) - s;
    need -= s;
    const t = Math.min(need, TQ[r.product_id] || 0);
    TQ[r.product_id] = (TQ[r.product_id] || 0) - t;
    need -= t;
    const base = {
      product_id: r.product_id,
      sku: r.sku,
      nombre: r.nombre,
      pedido_pend: r.q
    };
    if (t > 0) g.cubre.push({
      ...base,
      q: t,
      de_stock: s
    });
    else if (s > 0) g.con_stock.push({
      ...base,
      q: s
    });
    if (need > 0) g.faltan.push({
      ...base,
      q: need
    });
  }
  const ovs = ord.map((k)=>O[k]).filter((g)=>g.cubre.length).map((g)=>({
      ...g,
      completa: !g.faltan.length
    }));
  if (signPaths) {
    const sg = await signPaths(lineas.map((r)=>r.img_path).filter(Boolean));
    for (const r of lineas){
      r.img = sg[r.img_path] || "";
      delete r.img_path;
    }
  }
  return {
    tipo: "transito",
    lineas,
    ovs,
    generado: new Date().toISOString()
  };
}
