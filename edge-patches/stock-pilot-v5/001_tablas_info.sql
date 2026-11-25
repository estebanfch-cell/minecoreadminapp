-- b724 t2135u/t2137u Stock Pilot: líneas manuales + mínimo fijo por producto (genérico) + info enriquecida
create table if not exists app.stock_pilot_manual(
  usuario text not null,
  vendor_id uuid not null references app.vendors(id),
  product_id uuid not null references app.products(id),
  cant numeric not null check (cant > 0),
  precio numeric not null default 0 check (precio >= 0),
  creado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (usuario, vendor_id, product_id)
);
alter table app.stock_pilot_manual enable row level security;
revoke all on app.stock_pilot_manual from anon, authenticated;

create table if not exists app.product_stock_minimo(
  product_id uuid primary key references app.products(id),
  minimo numeric not null check (minimo >= 0),
  nota text,
  por text,
  updated_at timestamptz not null default now()
);
alter table app.product_stock_minimo enable row level security;
revoke all on app.product_stock_minimo from anon, authenticated;

create table if not exists app.product_stock_minimo_log(
  id bigserial primary key,
  product_id uuid not null,
  anterior numeric,
  nuevo numeric,
  por text,
  at timestamptz not null default now()
);
alter table app.product_stock_minimo_log enable row level security;
revoke all on app.product_stock_minimo_log from anon, authenticated;

-- Info por producto para Stock Pilot (foto, código proveedor, OH bodega principal, tránsito, comprometido, RP, rotación 365, costo, precio sugerido, cotizado 6m, mínimo fijo)
create or replace function app.stock_pilot_info(p_ids uuid[], p_vendor uuid)
returns jsonb language sql stable security definer set search_path to 'app','public' as $f$
with B as (select 'a4b0d9f6-9544-4200-aefa-43ed6c027484'::uuid b),
v as (select id, inflow_id from app.vendors where id = p_vendor),
p as (select p.* from app.products p where p.id = any(p_ids)),
opo as (select id from app.purchase_orders where not is_quote and not coalesce(is_cancelled,false) and inventory_status in ('unfulfilled','started')),
tr as (select l.product_id pid, sum(greatest(0, l.quantity - coalesce((select sum(r.quantity) from app.po_receive_lines r where r.purchase_order_id = l.purchase_order_id and r.product_id = l.product_id),0))) q
       from app.po_lines l where l.purchase_order_id in (select id from opo) and l.product_id = any(p_ids) group by 1),
oso as (select s.id from app.sales_orders s where not coalesce(s.is_cancelled,false) and not s.is_quote and s.inventory_status in ('unfulfilled','started')),
cl as (select l.sales_order_id sid, l.product_id pid, sum(l.quantity) q from app.sales_order_lines l join oso on oso.id = l.sales_order_id
       where l.product_id = any(p_ids) and not coalesce(l.is_discarded,false) and not coalesce(l.venta_puntual,false) group by 1,2),
cp as (select sales_order_id sid, product_id pid, sum(quantity) q from app.so_pick_lines where product_id = any(p_ids) and sales_order_id in (select id from oso) group by 1,2),
com as (select cl.pid, sum(greatest(0, cl.q - coalesce(cp.q,0))) q from cl left join cp on cp.sid = cl.sid and cp.pid = cl.pid group by 1),
sold as (select l.product_id pid, sum(l.quantity) u, count(distinct so.id) n, max((so.order_date at time zone 'America/Guayaquil')::date) ult
         from app.sales_order_lines l join app.sales_orders so on so.id = l.sales_order_id
         where l.product_id = any(p_ids) and not so.is_quote and not coalesce(so.is_cancelled,false) and so.inventory_status = 'fulfilled'
           and so.order_date > now() - interval '365 days' and not coalesce(l.is_discarded,false) and l.quantity > 0 group by 1),
quo as (select l.product_id pid, sum(l.quantity) q, count(distinct coalesce(so.root_number, so.order_number)) n
        from app.sales_order_lines l join app.sales_orders so on so.id = l.sales_order_id
        where l.product_id = any(p_ids) and (so.is_quote or so.quote_number is not null) and so.order_date > now() - interval '6 months'
          and not coalesce(l.is_discarded,false) and l.quantity > 0 group by 1),
lc as (select distinct on (l.product_id) l.product_id pid, round(l.unit_price*(1-coalesce(l.discount_pct,0)/100), 4) pu, (o.vendor_id = p_vendor) mine
       from app.po_lines l join app.purchase_orders o on o.id = l.purchase_order_id
       where l.product_id = any(p_ids) and not coalesce(o.is_quote,false) and not coalesce(o.is_cancelled,false) and l.unit_price > 0
       order by l.product_id, (o.vendor_id = p_vendor) desc, o.order_date desc nulls last, o.order_number desc)
select coalesce(jsonb_object_agg(p.id::text, jsonb_build_object(
  'product_id', p.id, 'sku', p.sku, 'nombre', p.name, 'codigo', nullif(vi.codigo,''), 'img', vi.img,
  'oh', coalesce((select sum(s.quantity) from app.stock_levels s, B where s.product_id = p.id and s.location_id = B.b),0),
  'oh_total', coalesce((select sum(s.quantity) from app.stock_levels s where s.product_id = p.id),0),
  'transito', coalesce(tr.q,0), 'comprometido', coalesce(com.q,0),
  'rp', coalesce(pr.reorder_point,0), 'roq', coalesce(pr.reorder_qty,0),
  'f365', coalesce(sold.n,0), 'u365', coalesce(sold.u,0), 'ultima_venta', sold.ult,
  'cot6_q', coalesce(quo.q,0), 'cot6_n', coalesce(quo.n,0),
  'costo', round(coalesce(p.unit_cost,0), 4),
  'precio', round(coalesce(lc.pu,
      (select min(pv.cost) from app.product_vendors pv, v where pv.product_id = p.id and pv.cost > 0 and pv.vendor_inflow_id in (v.id, v.inflow_id)),
      (select min(pv.cost) from app.product_vendors pv where pv.product_id = p.id and pv.cost > 0),
      nullif((p.cost_prov_data->>'precio')::numeric, 0), 0), 4),
  'precio_ref', case when lc.pu is not null and lc.mine then 'ultimo_proveedor' when lc.pu is not null then 'ultimo' else 'catalogo' end,
  'minimo', sm.minimo,
  'activo', coalesce(p.is_active, true)
)), '{}'::jsonb)
from p
left join app.v_inventario_portal vi on vi.sku = p.sku
left join app.product_reorder pr on pr.product_id = p.id and pr.location_id = (select b from B)
left join tr on tr.pid = p.id left join com on com.pid = p.id left join sold on sold.pid = p.id
left join quo on quo.pid = p.id left join lc on lc.pid = p.id
left join app.product_stock_minimo sm on sm.product_id = p.id;
$f$;
revoke all on function app.stock_pilot_info(uuid[], uuid) from public, anon, authenticated;

-- Búsqueda de catálogo: nombre, código MCOR y código del proveedor; por defecto solo productos del proveedor
create or replace function app.stock_pilot_buscar(p_q text, p_vendor uuid, p_todos boolean default false)
returns uuid[] language sql stable security definer set search_path to 'app','public' as $f$
with v as (select id, inflow_id, name, nullif(substring(upper(name) from '^([A-ZÁÉÍÓÚÑ]{4,})'),'') w from app.vendors where id = p_vendor),
t as (select array_agg(x) a from (select x from regexp_split_to_table(upper(btrim(coalesce(p_q,''))), '\s+') x where x <> '' limit 6) z)
select coalesce(array_agg(id order by act desc, sku), '{}') from (
  select p.id, p.sku, coalesce(p.is_active,true) act
  from app.products p
  left join app.v_inventario_portal vi on vi.sku = p.sku, t
  where t.a is not null
    and (select bool_and(upper(concat_ws(' ', p.sku, p.name, vi.codigo,
           (select string_agg(pv.vendor_item_code, ' ') from app.product_vendors pv where pv.product_id = p.id))) like '%'||x||'%') from unnest(t.a) x)
    and (coalesce(p_todos,false) or p_vendor is null or exists (select 1 from v where
          p.last_vendor_id in (v.id, v.inflow_id)
          or exists (select 1 from app.product_vendors pv where pv.product_id = p.id and pv.vendor_inflow_id in (v.id, v.inflow_id))
          or exists (select 1 from app.po_lines l join app.purchase_orders o on o.id = l.purchase_order_id where l.product_id = p.id and o.vendor_id = v.id)
          or (v.w is not null and upper(p.name) like '%'||v.w||'%')))
  order by coalesce(p.is_active,true) desc, p.sku
  limit 40) s;
$f$;
revoke all on function app.stock_pilot_buscar(text, uuid, boolean) from public, anon, authenticated;
