-- Liquidación: oleada por cliente. El token viejo no se reutiliza.
-- Oferta: historial de compra del cliente (hasta 20) y, aparte, stock parado
-- (sin venta en 180 días, hasta 12). Solo Bodega principal, disponible > 0,
-- precio de la lista del cliente (si no hay, la lista por defecto).

create table if not exists app.liq_oleadas (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  codigo text not null,
  customer_id uuid not null references app.customers(id),
  creada timestamptz not null default now(),
  expira timestamptz not null,
  estado text not null default 'activa',
  dias int not null default 30,
  creada_por text,
  constraint liq_oleadas_estado check (estado in ('activa','reemplazada','vencida'))
);

create index if not exists liq_oleadas_cliente on app.liq_oleadas (customer_id, estado);

create table if not exists app.liq_items (
  id bigint generated always as identity primary key,
  oleada_id uuid not null references app.liq_oleadas(id) on delete cascade,
  product_id uuid not null,
  sku text not null,
  nombre text,
  categoria text,
  precio_snap numeric,
  stock_snap numeric,
  orden int,
  origen text
);

create index if not exists liq_items_oleada on app.liq_items (oleada_id);

create or replace function app.liq_oferta(p_customer uuid)
returns table (
  product_id uuid,
  sku text,
  nombre text,
  categoria text,
  stock numeric,
  precio numeric,
  origen text,
  orden int
)
language sql
stable
security definer
set search_path = app, public, extensions
as $fn$
with bodega as (
  select 'a4b0d9f6-9544-4200-aefa-43ed6c027484'::uuid as id
),
lista as (
  select coalesce(
    (select pricing_scheme_id from app.customers where id = p_customer),
    (select id from app.price_lists where is_default and is_active order by name limit 1)
  ) as id
),
oh as (
  select sl.product_id, sum(sl.quantity) q
  from app.stock_levels sl
  where sl.location_id = (select id from bodega)
  group by sl.product_id
),
picked as (
  select pk.sales_order_id, pk.product_id, sum(pk.quantity) q
  from app.so_pick_lines pk
  where pk.location_id is null or pk.location_id = (select id from bodega)
  group by pk.sales_order_id, pk.product_id
),
abiertas as (
  select l.product_id, sum(greatest(l.q - coalesce(pk.q, 0), 0)) q
  from (
    select o.id so_id, ln.product_id, sum(ln.quantity) q
    from app.sales_order_lines ln
    join app.sales_orders o on o.id = ln.sales_order_id
    where o.inventory_status in ('unfulfilled', 'started')
      and coalesce(o.is_cancelled, false) = false
      and coalesce(o.is_quote, false) = false
      and coalesce(o.doc_type, '') <> 'PQ'
    group by o.id, ln.product_id
  ) l
  left join picked pk on pk.sales_order_id = l.so_id and pk.product_id = l.product_id
  group by l.product_id
),
disp as (
  select oh.product_id, greatest(oh.q - coalesce(abiertas.q, 0), 0) d
  from oh
  left join abiertas on abiertas.product_id = oh.product_id
  where greatest(oh.q - coalesce(abiertas.q, 0), 0) > 0
),
precio as (
  select d.product_id, d.d as stock,
    coalesce(
      (select pp.unit_price from app.product_prices pp
        where pp.product_id = d.product_id and pp.price_list_id = (select id from lista) and pp.unit_price > 0
        limit 1),
      (select pp.unit_price from app.product_prices pp
        join app.price_lists pl on pl.id = pp.price_list_id
        where pp.product_id = d.product_id and pl.is_default and pl.is_active and pp.unit_price > 0
        limit 1)
    ) as precio
  from disp d
),
base as (
  select p.id as product_id, p.sku, p.name as nombre, coalesce(c.name, 'Otros') as categoria,
    pr.stock, round(pr.precio, 2) as precio
  from precio pr
  join app.products p on p.id = pr.product_id
  left join app.categories c on c.id = p.category_id
  where pr.precio > 0
    and coalesce(p.is_active, true)
    and coalesce(p.sku, '') <> ''
),
hist as (
  select ln.product_id, max(o.order_date) as ultima, count(distinct o.id) as veces
  from app.sales_orders o
  join app.sales_order_lines ln on ln.sales_order_id = o.id
  where o.customer_id = p_customer
    and o.inventory_status = 'fulfilled'
    and coalesce(o.is_cancelled, false) = false
    and coalesce(o.is_quote, false) = false
    and coalesce(o.doc_type, '') <> 'PQ'
    and ln.quantity > 0
    and coalesce(ln.venta_puntual, false) = false
    and coalesce(o.tipo_demanda, '') !~* '^puntual'
    and coalesce(o.custom_fields->>'custom10', '') !~* '^puntual'
  group by ln.product_id
),
propios as (
  select b.product_id, b.sku, b.nombre, b.categoria, b.stock, b.precio,
    'historial'::text as origen,
    row_number() over (order by h.ultima desc nulls last, h.veces desc, b.sku) as rn
  from base b
  join hist h on h.product_id = b.product_id
),
propios_top as (
  select * from propios where rn <= 20
),
lento as (
  select b.product_id, max(o.order_date) as ultima
  from base b
  left join app.sales_order_lines ln on ln.product_id = b.product_id and ln.quantity > 0
  left join app.sales_orders o on o.id = ln.sales_order_id
    and o.inventory_status = 'fulfilled'
    and coalesce(o.is_cancelled, false) = false
    and coalesce(o.is_quote, false) = false
  group by b.product_id
),
relleno as (
  select b.product_id, b.sku, b.nombre, b.categoria, b.stock, b.precio,
    'liquidacion'::text as origen,
    row_number() over (order by b.stock desc, b.sku) as rn
  from base b
  join lento s on s.product_id = b.product_id
  where not exists (select 1 from propios_top t where t.product_id = b.product_id)
    and (s.ultima is null or s.ultima < ((now() at time zone 'America/Guayaquil')::date - 180))
)
select product_id, sku, nombre, categoria, stock, precio, origen, rn::int as orden
from propios_top
union all
select product_id, sku, nombre, categoria, stock, precio, origen, (1000 + rn)::int as orden
from relleno
where rn <= 12;
$fn$;

create or replace function app.liq_vivo(p_customer uuid, p_ids uuid[])
returns table (
  product_id uuid,
  sku text,
  nombre text,
  categoria text,
  stock numeric,
  precio numeric
)
language sql
stable
security definer
set search_path = app, public, extensions
as $fn$
with bodega as (
  select 'a4b0d9f6-9544-4200-aefa-43ed6c027484'::uuid as id
),
lista as (
  select coalesce(
    (select pricing_scheme_id from app.customers where id = p_customer),
    (select id from app.price_lists where is_default and is_active order by name limit 1)
  ) as id
),
oh as (
  select sl.product_id, sum(sl.quantity) q
  from app.stock_levels sl
  where sl.location_id = (select id from bodega)
    and sl.product_id = any (p_ids)
  group by sl.product_id
),
picked as (
  select pk.sales_order_id, pk.product_id, sum(pk.quantity) q
  from app.so_pick_lines pk
  where (pk.location_id is null or pk.location_id = (select id from bodega))
    and pk.product_id = any (p_ids)
  group by pk.sales_order_id, pk.product_id
),
abiertas as (
  select l.product_id, sum(greatest(l.q - coalesce(pk.q, 0), 0)) q
  from (
    select o.id so_id, ln.product_id, sum(ln.quantity) q
    from app.sales_order_lines ln
    join app.sales_orders o on o.id = ln.sales_order_id
    where ln.product_id = any (p_ids)
      and o.inventory_status in ('unfulfilled', 'started')
      and coalesce(o.is_cancelled, false) = false
      and coalesce(o.is_quote, false) = false
      and coalesce(o.doc_type, '') <> 'PQ'
    group by o.id, ln.product_id
  ) l
  left join picked pk on pk.sales_order_id = l.so_id and pk.product_id = l.product_id
  group by l.product_id
)
select p.id, p.sku, p.name, coalesce(c.name, 'Otros'),
  greatest(oh.q - coalesce(abiertas.q, 0), 0),
  round(coalesce(
    (select pp.unit_price from app.product_prices pp
      where pp.product_id = p.id and pp.price_list_id = (select id from lista) and pp.unit_price > 0 limit 1),
    (select pp.unit_price from app.product_prices pp
      join app.price_lists pl on pl.id = pp.price_list_id
      where pp.product_id = p.id and pl.is_default and pl.is_active and pp.unit_price > 0 limit 1)
  ), 2)
from oh
join app.products p on p.id = oh.product_id
left join abiertas on abiertas.product_id = oh.product_id
left join app.categories c on c.id = p.category_id
where greatest(oh.q - coalesce(abiertas.q, 0), 0) > 0
  and coalesce(p.is_active, true);
$fn$;

create or replace function app.liq_generar(p_customer uuid, p_dias int, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = app, public, extensions
as $fn$
declare
  v_dias int := least(greatest(coalesce(p_dias, 30), 1), 365);
  v_id uuid;
  v_token text;
  v_codigo text;
  v_nombre text;
  v_n int;
  v_exp timestamptz;
begin
  select trim(name) into v_nombre from app.customers where id = p_customer;
  if v_nombre is null then
    return jsonb_build_object('ok', false, 'error', 'Cliente no encontrado');
  end if;
  if not exists (select 1 from app.liq_oferta(p_customer)) then
    return jsonb_build_object('ok', false, 'error', 'Este cliente no tiene productos con stock y precio de lista en Bodega principal.');
  end if;
  update app.liq_oleadas set estado = 'reemplazada'
   where customer_id = p_customer and estado = 'activa';
  v_token := encode(gen_random_bytes(12), 'hex');
  v_exp := now() + make_interval(days => v_dias);
  v_codigo := 'LIQ-' || to_char(now() at time zone 'America/Guayaquil', 'YYYYMMDD') || '-' || substr(v_token, 1, 6);
  insert into app.liq_oleadas (token, codigo, customer_id, expira, estado, dias, creada_por)
  values (v_token, v_codigo, p_customer, v_exp, 'activa', v_dias, coalesce(nullif(p_actor, ''), 'EFCH'))
  returning id into v_id;
  insert into app.liq_items (oleada_id, product_id, sku, nombre, categoria, precio_snap, stock_snap, orden, origen)
  select v_id, o.product_id, o.sku, o.nombre, o.categoria, o.precio, o.stock, o.orden, o.origen
  from app.liq_oferta(p_customer) o;
  get diagnostics v_n = row_count;
  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'url', 'https://liq.minecore.ec/?t=' || v_token,
    'n', v_n,
    'expira', v_exp,
    'dias', v_dias,
    'cliente', v_nombre,
    'codigo', v_codigo
  );
end;
$fn$;

create or replace function app.liq_get(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = app, public, extensions
as $fn$
declare
  v app.liq_oleadas%rowtype;
  v_nombre text;
  v_items jsonb;
  v_cats jsonb;
begin
  if coalesce(trim(p_token), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Enlace no válido.');
  end if;
  select * into v from app.liq_oleadas where token = lower(trim(p_token));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Enlace no válido.');
  end if;
  if v.estado <> 'activa' or v.expira <= now() then
    if v.estado = 'activa' and v.expira <= now() then
      update app.liq_oleadas set estado = 'vencida' where id = v.id;
    end if;
    return jsonb_build_object('ok', false, 'error', 'Esta liquidación expiró');
  end if;
  select trim(name) into v_nombre from app.customers where id = v.customer_id;
  with ids as (
    select array_agg(product_id) a from app.liq_items where oleada_id = v.id
  ),
  vivo as (
    select i.orden, z.sku, z.nombre, z.categoria, z.stock, z.precio
    from app.liq_items i
    join app.liq_vivo(v.customer_id, coalesce((select a from ids), '{}')) z on z.product_id = i.product_id
    where i.oleada_id = v.id and z.precio > 0
  ),
  cats as (
    select categoria as nombre, count(*)::int n,
      round(sum(stock * precio), 2) lista_total,
      round(sum(stock * precio), 2) liq_base
    from vivo
    group by categoria
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object(
      'sku', sku, 'nombre', nombre, 'categoria', categoria,
      'stock', stock, 'precio_lista', precio, 'precio_liq', precio
    ) order by orden) from vivo), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
      'nombre', nombre, 'n', n, 'lista_total', lista_total, 'liq_base', liq_base
    ) order by nombre) from cats), '[]'::jsonb)
  into v_items, v_cats;
  return jsonb_build_object(
    'ok', true,
    'oleadaId', v.codigo,
    'cliente', jsonb_build_object('nombre', v_nombre),
    'instruccion', 'Marcá lo que te interesa y la cantidad. El stock y el precio son los de hoy en Bodega principal (lista vigente). Minecore revisa tu selección como pre-cotización.',
    'items', v_items,
    'categorias', v_cats
  );
end;
$fn$;

create or replace function app.liq_submit(p_token text, p_lineas jsonb, p_contacto text)
returns jsonb
language plpgsql
security definer
set search_path = app, public, extensions
as $fn$
declare
  v app.liq_oleadas%rowtype;
  v_nombre text;
  v_items jsonb;
  v_n int;
  v_total numeric;
  v_id int;
begin
  select * into v from app.liq_oleadas where token = lower(trim(coalesce(p_token, '')));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Enlace no válido.');
  end if;
  if v.estado <> 'activa' or v.expira <= now() then
    if v.estado = 'activa' and v.expira <= now() then
      update app.liq_oleadas set estado = 'vencida' where id = v.id;
    end if;
    return jsonb_build_object('ok', false, 'error', 'Esta liquidación expiró');
  end if;
  select trim(name) into v_nombre from app.customers where id = v.customer_id;
  with ids as (
    select array_agg(product_id) a from app.liq_items where oleada_id = v.id
  ),
  vivo as (
    select z.product_id, z.sku, z.nombre, z.stock, z.precio
    from app.liq_vivo(v.customer_id, coalesce((select a from ids), '{}')) z
    where z.precio > 0
  ),
  ped as (
    select lower(trim(x.sku)) sku, sum(x.qty) qty
    from jsonb_to_recordset(coalesce(p_lineas, '[]'::jsonb)) as x(sku text, qty numeric)
    where coalesce(x.qty, 0) > 0
    group by lower(trim(x.sku))
  ),
  ok as (
    select vivo.product_id, vivo.sku, vivo.nombre, vivo.precio,
      least(ped.qty, vivo.stock) qty
    from ped
    join vivo on lower(vivo.sku) = ped.sku
    where least(ped.qty, vivo.stock) > 0
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'sku', sku, 'nombre', nombre, 'cantidad', qty, 'precio', precio, 'product_id', product_id
    )), '[]'::jsonb),
    count(*)::int,
    coalesce(round(sum(qty * precio), 2), 0)
  into v_items, v_n, v_total
  from ok;
  if coalesce(v_n, 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Esos productos ya no tienen stock en Bodega principal.');
  end if;
  perform pg_advisory_xact_lock(641202611);
  select coalesce(max(id), 0) + 1 into v_id from app.precot;
  insert into app.precot (id, fecha, usuario, empresa, contacto, n, items, estado, origen, fecha_creada, fecha_txt)
  values (
    v_id, now(), 'liquidacion', v_nombre, left(coalesce(p_contacto, ''), 80), v_n, v_items,
    'NUEVA', 'liquidacion', now(), to_char(now() at time zone 'America/Guayaquil', 'YYYY-MM-DD HH24:MI')
  );
  insert into app.avisos (tipo, texto, destino, ref, para, estado)
  values (
    'liq',
    'Liquidación de ' || v_nombre || ': ' || v_n || case when v_n = 1 then ' línea' else ' líneas' end || ', pre-cotización #' || v_id || '.',
    'vcot',
    v_id::text,
    'admin',
    'abierto'
  );
  return jsonb_build_object('ok', true, 'n', v_n, 'total', v_total, 'precot_id', v_id);
end;
$fn$;
