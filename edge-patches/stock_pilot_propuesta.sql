CREATE OR REPLACE FUNCTION app.stock_pilot_propuesta(p_proveedor uuid DEFAULT NULL::uuid, p_regla_tuberia boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
#variable_conflict use_variable
declare
  B constant uuid := 'a4b0d9f6-9544-4200-aefa-43ed6c027484';
  hoy date := (now() at time zone 'America/Guayaquil')::date;
  horizon date := hoy + 27;
  v record; v_boy boolean; v_terms uuid; res jsonb;
  r record;
  sale90 boolean; dbt boolean; gate_ok boolean; gate_why text;
  avail numeric; below boolean; crit boolean; stockout boolean;
  is_lock boolean; is_assy boolean; is_rod boolean; trigger boolean;
  est numeric; src text; est_re date; hi boolean; ohcrit boolean; action text; demote_pd boolean;
  qty int; sf int; motivo text; run numeric; ext numeric; force boolean; demote boolean;
  freq_txt text := 'Frecuencia de Stock Pilot, en vivo desde app.sales_orders y app.sales_order_lines, zona America/Guayaquil. Ventana: fecha de la orden > hoy-365 y <= hoy. Cuenta cada orden cumplida (inventory_status fulfilled), no cancelada, que no es cotizacion (is_quote false y doc_type distinto de PQ). Un split es otra orden. La frecuencia de ordenes es ese conteo; la de unidades es la suma de cantidades. No entra una linea con venta_puntual, ni una orden cuyo tipo_demanda o custom10 empieza por puntual, ni un cliente Rumi, ni una orden en CONSIGNACION o EN ALQUILER, ni una linea descartada o con cantidad <= 0. Las transferencias de stock no son ordenes de venta y no entran. Ultima venta: la fecha de orden mas reciente entre las lineas que cuentan. Tuberia (WIRELINE DRILL ROD, DRILL ROD X n, TUBO DE PERFORACION): con la regla encendida solo es urgente con al menos 3 ordenes en la ventana. Proyecto o liquidacion: en la ventana, un solo cliente y menos de 60 dias entre la primera y la ultima venta; eso la baja de urgente.';
begin
  if p_proveedor is null then
    select * into v from app.vendors where name ilike '%BOYLES%' order by is_active desc nulls last limit 1;
  else
    select * into v from app.vendors where id = p_proveedor;
  end if;
  if v.id is null then raise exception 'Proveedor no existe'; end if;
  v_boy := v.name ilike '%BOYLES%';
  select id into v_terms from app.payment_terms where name = case when v_boy then '90 DÍAS' end;
  if v_terms is null then v_terms := v.default_payment_terms_id; end if;
  drop table if exists _sp;
  create temp table _sp on commit drop as
  with rumi as (select id from app.customers where name ~* '\mrumi\M' or email ilike '%@rumidrilling%'),
  ev as (
    select l.product_id pid, so.id soid, so.order_number ord,
      (so.order_date at time zone 'America/Guayaquil')::date f,
      coalesce(nullif(btrim(c.name),''), '?') cust, sum(l.quantity) q
    from app.sales_order_lines l
    join app.sales_orders so on so.id = l.sales_order_id
    left join app.customers c on c.id = so.customer_id
    left join app.locations loc on loc.id = so.location_id
    where not coalesce(so.is_quote,false) and not coalesce(so.is_cancelled,false)
      and so.inventory_status = 'fulfilled' and coalesce(so.doc_type,'SO') <> 'PQ'
      and not coalesce(l.is_discarded,false) and coalesce(l.quantity,0) > 0
      and not coalesce(l.venta_puntual,false)
      and coalesce(so.tipo_demanda,'') !~* '^puntual' and coalesce(so.custom_fields->>'custom10','') !~* '^puntual'
      and (c.id is null or c.id not in (select id from rumi))
      and coalesce(loc.name,'') !~* 'consign|alquiler'
      and so.order_date is not null and l.product_id is not null
    group by 1,2,3,4,5
  ), met as (
    select pid,
      count(distinct soid) filter (where f > hoy - 365 and f <= hoy) f365,
      count(distinct soid) ffull,
      count(distinct soid) filter (where f > hoy - 90 and f <= hoy) f90,
      coalesce(sum(q) filter (where f > hoy - 365 and f <= hoy), 0) u365,
      count(distinct extract(year from f)) yrs, min(f) fs, max(f) ls,
      count(distinct cust) filter (where f > hoy - 365 and f <= hoy) ncust,
      (max(f) filter (where f > hoy - 365 and f <= hoy) - min(f) filter (where f > hoy - 365 and f <= hoy)) span
    from ev group by pid
  ), day as (
    select pid, cust, f d, sum(q) q, max(ord) ord from ev group by pid, cust, f
  ), lastd as (
    select distinct on (pid) pid, cust, d, q, ord from day order by pid, d desc, ord desc
  ), lc as (
    select d.pid, d.d, d.q, d.d - lag(d.d) over (partition by d.pid order by d.d) itv
    from day d join lastd l on l.pid = d.pid and l.cust = d.cust
  ), cad as (
    select pid, count(*) n,
      percentile_cont(0.5) within group (order by itv) filter (where itv > 0) med_int,
      percentile_cont(0.5) within group (order by q) med_q
    from lc group by pid
  ), ao as (select pid, avg(q) avg_q from day group by pid),
  opo as (select id, order_number, order_date from app.purchase_orders where not is_quote and not coalesce(is_cancelled,false) and inventory_status in ('unfulfilled','started')),
  tl as (select l.purchase_order_id po, l.product_id pid, sum(l.quantity) q from app.po_lines l join opo on opo.id = l.purchase_order_id group by 1,2),
  tr0 as (select rl.purchase_order_id po, rl.product_id pid, sum(rl.quantity) q from app.po_receive_lines rl join opo on opo.id = rl.purchase_order_id group by 1,2),
  tr as (
    select tl.pid, sum(greatest(0, tl.q - coalesce(t0.q,0))) q,
      string_agg(opo.order_number, ', ' order by opo.order_date) filter (where tl.q - coalesce(t0.q,0) > 0) refs
    from tl left join tr0 t0 on t0.po = tl.po and t0.pid = tl.pid join opo on opo.id = tl.po
    where tl.q - coalesce(t0.q,0) > 1e-9 group by tl.pid
  ), oso as (
    select s.id, s.order_number, s.order_date from app.sales_orders s
    left join app.customers c on c.id = s.customer_id
    where not coalesce(s.is_cancelled,false) and not s.is_quote and s.inventory_status in ('unfulfilled','started')
      and (c.id is null or c.id not in (select id from rumi))
  ), cl as (
    select l.sales_order_id sid, l.product_id pid, sum(l.quantity) q from app.sales_order_lines l
    join oso on oso.id = l.sales_order_id
    where l.product_id is not null and not coalesce(l.is_discarded,false) and not coalesce(l.venta_puntual,false)
    group by 1,2
  ), cp as (select sales_order_id sid, product_id pid, sum(quantity) q from app.so_pick_lines where sales_order_id in (select id from oso) group by 1,2),
  com as (
    select cl.pid, sum(cl.q - coalesce(cp.q,0)) q,
      string_agg(o.order_number, ', ' order by o.order_date) refs
    from cl join oso o on o.id = cl.sid left join cp on cp.sid = cl.sid and cp.pid = cl.pid
    where cl.q - coalesce(cp.q,0) > 0 group by cl.pid
  ), lp as (
    select distinct on (l.product_id) l.product_id pid, (o.order_date at time zone 'America/Guayaquil')::date f
    from app.po_lines l join app.purchase_orders o on o.id = l.purchase_order_id
    where not coalesce(o.is_quote,false) and not coalesce(o.is_cancelled,false) and coalesce(l.quantity,0) > 0
    order by l.product_id, o.order_date desc
  )
  select p.id pid, p.sku, p.name, coalesce(cat.name,'') categoria, coalesce(p.is_manufacturable,false) mfg,
    greatest(0, coalesce(oh.q,0)) oh, greatest(0, coalesce(tr.q,0)) tr, coalesce(tr.refs,'') tr_refs,
    coalesce(pr.reorder_point,0) rp, coalesce(pr.reorder_qty,0) roq, coalesce(pr.enabled,false) en,
    coalesce(p.unit_cost,0) cost,
    coalesce(met.f365,0)::int f365, coalesce(met.ffull,0)::int ffull, coalesce(met.f90,0)::int f90,
    coalesce(met.u365,0) u365, coalesce(met.yrs,0)::int yrs, met.fs, met.ls,
    coalesce(met.ncust,0)::int ncust, met.span,
    (coalesce(met.f365,0) > 0 and coalesce(met.ncust,0) <= 1 and coalesce(met.span,0) < 60) proyecto,
    greatest(0, coalesce(com.q,0)) unf, coalesce(com.refs,'') com_refs, lp.f lp,
    case when lp.f is null then null else round((hoy - lp.f) / 30.4375, 2) end months,
    lastd.cust ld_cust, lastd.d ld, lastd.q ld_q, coalesce(cad.n,0)::int n_purch, cad.med_int, cad.med_q, ao.avg_q,
    null::text tier, 0 qty, 0::int shortfall, 0::int qty_justas, 0::int qty_media, 0::int qty_alta, ''::text motivo, ''::text origen, ''::text dem_to, ''::text dem_why,
    false pd_demote, ''::text pd_action, null::numeric est_cover, null::date est_reorder, false cand
  from app.products p
  left join app.categories cat on cat.id = p.category_id
  left join lateral (select sum(quantity) q from app.stock_levels s where s.product_id = p.id and s.location_id = B) oh on true
  left join app.product_reorder pr on pr.product_id = p.id and pr.location_id = B
  left join met on met.pid = p.id
  left join lastd on lastd.pid = p.id
  left join cad on cad.pid = p.id
  left join ao on ao.pid = p.id
  left join tr on tr.pid = p.id
  left join com on com.pid = p.id
  left join lp on lp.pid = p.id
  where p.name ilike '%BOYLES%' or p.name ilike '%DISPLA%' or p.sku in ('MCOR000767','MCOR000769','MCOR001023','MCOR001024')
     or (v_boy and exists (select 1 from app.vendors vv where vv.id = p.last_vendor_id and vv.name ilike '%BOYLES%'));
  update _sp set cand = true where
    sku <> 'MCOR000765' and sku not in ('MCOR001122','MCOR001124')
    and name !~* 'fordia' and name !~* '\mrumi\M'
    and (categoria || ' ' || name) !~* 'alquiler|rental|env[ií]o|shipping|flete|transporte|servicio|service|mano de obra|instalaci[oó]n|honorario'
    and not (name ~* 'caja|portatestigo|core\s*box|bandeja|tapa|separador' and sku not in ('MCOR001023','MCOR001024'))
    and not (name ~* 'BP\s*SUPPLY' and sku not in ('MCOR000767','MCOR000769'))
    and name ~* 'BOYLES'
    and not (mfg and name !~* 'HEAD\s*ASS(Y|EMBLY)|WATER\s*SWIVEL\s*ASS' and not (name ~* 'OVERSHOT' and name ~* 'ASS(Y|EMBLY)'))
    and (en or f365 >= 1 or ffull >= 2 or name ~* 'LOCKING\s+COUPLING' or unf > 0 or mfg);
  if v_boy then update _sp set cand = false where name ilike '%DISPLA%' or sku in ('MCOR000767','MCOR000769','MCOR001023','MCOR001024'); end if;
  for r in select * from _sp where cand loop
    is_rod := r.name ~* '(WIRELINE\s+DRILL\s+ROD|DRILL\s+ROD\s+X\s+[0-9]|TUBO\s+DE\s+PERFORACI[OÓ]N)';
    dbt := r.yrs = 1 and (r.fs is null or (hoy - r.fs) < 365);
    sale90 := r.ls is not null and (hoy - r.ls) <= 90;
    est := null; src := 'none';
    if r.med_int is not null and coalesce(r.med_q,0) > 0 and coalesce(r.ld_q,0) > 0 and r.n_purch >= 2 then
      est := r.med_int * (r.ld_q / r.med_q); src := 'customer_median_interval';
    elsif r.f365 > 0 and coalesce(r.ld_q,0) > 0 then
      if coalesce(r.avg_q,0) > 0 then est := (365.0 / r.f365) * (r.ld_q / r.avg_q);
      elsif r.u365 > 0 then est := (365.0 / r.f365) * (r.ld_q / (r.u365 / r.f365));
      else est := 365.0 / r.f365; end if;
      src := 'sku_agg_freq_365';
    end if;
    if est is not null then est := least(540, greatest(7, est)); end if;
    est_re := case when r.ld is not null and est is not null then r.ld + round(est)::int else null end;
    hi := r.f365 >= 4 or (r.f365 >= 3 and r.u365 >= 40);
    avail := r.oh + r.tr;
    ohcrit := r.oh <= 1e-9 or (r.rp > 0 and avail < r.rp);
    demote_pd := false; action := 'keep_urgente';
    if r.unf <= 0 and r.ld is not null and coalesce(r.ld_q,0) > 0 and est_re is not null and est_re > horizon then
      demote_pd := true;
      if hi and ohcrit then action := 'to_alta'; elsif ohcrit then action := 'to_bare'; else action := 'remind_later'; end if;
    end if;
    update _sp set est_cover = est, est_reorder = est_re, pd_demote = demote_pd, pd_action = action,
      dem_why = case when demote_pd then 'post-entrega '||src||' cubre hasta '||est_re else '' end
    where pid = r.pid;
  end loop;
  for r in select * from _sp where cand and unf > 0 loop
    -- El saldo no recibido de OC abierta/parcial cubre el compromiso. Falta = max(0, OV - OH - tránsito).
    sf := greatest(0, ceil(greatest(0, r.unf - r.oh - r.tr))::int);
    if sf <= 0 then
      update _sp set shortfall = 0 where pid = r.pid;
      continue;
    end if;
    qty := sf;
    if r.en and (r.rp > 0 or r.roq > 0) then
      qty := qty + app.stock_pilot_qty('bare_minimum', greatest(0, r.oh + r.tr - r.unf), 0, r.rp, r.roq, greatest(r.f365,1), r.u365);
    end if;
    motivo := 'Falta pedir: compromiso abierto '||coalesce(r.com_refs,'');
    if coalesce(r.oh,0) <= 1e-9 and coalesce(r.tr,0) <= 1e-9 then
      motivo := motivo || ' · sin OH ni tránsito';
    else
      motivo := motivo || ' · saldo no cubierto tras OH '||trim_scale(r.oh)||' TR '||trim_scale(r.tr);
    end if;
    update _sp set tier = 'urgente', qty = qty, origen = 'compromiso', motivo = motivo, shortfall = sf where pid = r.pid;
  end loop;
  for r in select * from _sp where cand and tier is null and unf <= 0 loop
    is_rod := r.name ~* '(WIRELINE\s+DRILL\s+ROD|DRILL\s+ROD\s+X\s+[0-9]|TUBO\s+DE\s+PERFORACI[OÓ]N)';
    is_lock := r.name ~* 'LOCKING\s+COUPLING';
    is_assy := r.name ~* 'WATER\s*SWIVEL\s*ASS' or r.name ~* 'HEAD\s*ASS(Y|EMBLY)' or (r.name ~* 'OVERSHOT' and r.name ~* 'ASS(Y|EMBLY)');
    dbt := r.yrs = 1 and (r.fs is null or (hoy - r.fs) < 365);
    sale90 := r.ls is not null and (hoy - r.ls) <= 90;
    avail := r.oh + r.tr;
    crit := r.rp > 0 and avail < r.rp * 0.5;
    below := r.rp > 0 and avail < r.rp;
    stockout := r.oh <= 1e-9 and (r.rp <= 0 or avail < r.rp);
    trigger := (crit and r.f365 >= 1) or (below and is_lock and r.f365 >= 2) or (stockout and (r.f365 >= 1 or is_lock or is_assy));
    if not trigger then continue; end if;
    if not is_lock and r.rp > 0 and avail >= r.rp and r.oh <= 1e-9 then continue; end if;
    gate_ok := false; gate_why := '';
    if is_rod then
      if coalesce(p_regla_tuberia, true) then gate_ok := r.f365 >= 3; gate_why := case when gate_ok then 'tuberia frecuencia ok' else 'tuberia con baja frecuencia' end;
      else
        if r.f365 <= 2 and not sale90 then gate_ok := false; gate_why := 'rod_low_freq_stale';
        elsif r.f365 >= 3 or (r.f365 >= 2 and sale90 and r.yrs >= 2) then gate_ok := true; gate_why := 'rod_freq_ok';
        else gate_ok := false; gate_why := 'rod_not_enough_freq'; end if;
      end if;
    elsif dbt then gate_ok := false; gate_why := 'debut_not_urgent';
    elsif r.yrs >= 2 then gate_ok := true; gate_why := 'years>=2';
    elsif r.f365 >= 4 and sale90 then gate_ok := true; gate_why := 'freq4_recent90';
    else gate_ok := false; gate_why := 'parts_no_rotation_gate'; end if;
    if not gate_ok and is_lock and r.f365 >= 2 and r.yrs >= 2 then gate_ok := true; gate_why := 'locking_years>=2'; end if;
    if not gate_ok and is_assy and r.f365 >= 4 and sale90 then gate_ok := true; gate_why := 'assy_freq4_recent'; end if;
    demote := r.months is not null and ((r.months >= 12 and r.yrs <= 1) or (r.months >= 18 and r.yrs < 2 and r.f365 < 4));
    if r.proyecto then
      update _sp set dem_to = case when r.f365 >= 4 or (r.f365 >= 3 and r.u365 >= 40) then 'alta_rotacion' else 'bare_minimum' end, dem_why = 'proyecto/liquidacion: 1 cliente <60d' where pid = r.pid;
      continue;
    end if;
    if not gate_ok then update _sp set dem_to = 'bare_minimum', dem_why = gate_why where pid = r.pid; continue; end if;
    if demote then update _sp set dem_to = 'bare_minimum', dem_why = 'percha' where pid = r.pid; continue; end if;
    if r.pd_demote then update _sp set dem_to = r.pd_action, dem_why = r.dem_why where pid = r.pid; continue; end if;
    qty := app.stock_pilot_qty('urgente', r.oh, r.tr, r.rp, r.roq, r.f365, r.u365);
    if qty <= 0 then continue; end if;
    update _sp set tier = 'urgente', qty = qty, origen = 'stock', motivo = gate_why||' · '||r.f365||' ordenes / '||trim_scale(r.u365)||' u en 365 d' where pid = r.pid;
  end loop;
  run := 0;
  for r in select * from _sp where cand and tier is null and unf <= 0 and coalesce(dem_to,'') <> 'remind_later' order by f365 desc, ffull desc, u365 desc, sku loop
    is_rod := r.name ~* '(WIRELINE\s+DRILL\s+ROD|DRILL\s+ROD\s+X\s+[0-9]|TUBO\s+DE\s+PERFORACI[OÓ]N)';
    dbt := r.yrs = 1 and (r.fs is null or (hoy - r.fs) < 365);
    if r.dem_to is distinct from 'to_alta' and r.dem_to is distinct from 'alta_rotacion' then
      if r.f365 < 4 and not (r.f365 >= 3 and r.u365 >= 40) then continue; end if;
      if dbt then continue; end if;
      if is_rod and r.f365 <= 2 then continue; end if;
      avail := r.oh + r.tr;
      if not ((r.rp > 0 and avail < r.rp) or (r.u365 > 0 and avail / (r.u365/12.0) < 2.5 and r.f365 >= 6) or (r.rp > 0 and avail >= r.rp and avail <= r.rp * 1.25 and r.f365 >= 8)) then continue; end if;
    end if;
    qty := app.stock_pilot_qty('alta_rotacion', r.oh, r.tr, r.rp, r.roq, r.f365, r.u365);
    if qty <= 0 and r.dem_to in ('to_alta','alta_rotacion') then qty := app.stock_pilot_qty('bare_minimum', r.oh, r.tr, r.rp, r.roq, greatest(r.f365,1), r.u365); end if;
    if qty <= 0 then continue; end if;
    ext := round(qty * r.cost, 2);
    if run > 0 and run + ext > 55000 and r.f365 < 10 then continue; end if;
    run := run + ext;
    update _sp set tier = 'alta_rotacion', qty = qty, origen = 'stock', motivo = coalesce(nullif(r.dem_why,''),'alta rotacion')||' · '||r.f365||' ordenes / '||trim_scale(r.u365)||' u' where pid = r.pid;
  end loop;
  run := 0;
  for r in select * from _sp where cand and tier is null and unf <= 0 and coalesce(dem_to,'') not in ('remind_later','to_alta') order by case when oh <= 1e-9 then 0 else 1 end, f365 desc, sku loop
    is_rod := r.name ~* '(WIRELINE\s+DRILL\s+ROD|DRILL\s+ROD\s+X\s+[0-9]|TUBO\s+DE\s+PERFORACI[OÓ]N)';
    is_lock := r.name ~* 'LOCKING\s+COUPLING';
    is_assy := r.name ~* 'WATER\s*SWIVEL\s*ASS' or r.name ~* 'HEAD\s*ASS(Y|EMBLY)';
    dbt := r.yrs = 1 and (r.fs is null or (hoy - r.fs) < 365);
    avail := r.oh + r.tr;
    force := coalesce(r.dem_to,'') in ('bare_minimum','to_bare','bare_or_alta') or coalesce(r.dem_why,'') <> '';
    if not (force or is_lock or is_assy or is_rod or r.name ~* '\m(BROCA|REAMER|REAMING|ZAPATA|LIFTER)\M' or r.f365 between 2 and 3 or dbt) then continue; end if;
    if not (force or (r.oh <= 1e-9 and (r.f365 >= 1 or dbt)) or (r.rp > 0 and avail < r.rp and r.f365 >= 1)) then continue; end if;
    qty := app.stock_pilot_qty('bare_minimum', r.oh, r.tr, r.rp, r.roq, greatest(r.f365, case when dbt or force then 1 else 0 end), r.u365);
    if qty <= 0 and r.oh <= 1e-9 and (dbt or force) then qty := case when r.roq > 0 then least(greatest(1, ceil(r.roq)::int), greatest(1, ceil(least(r.roq, greatest(r.rp,1)))::int)) else 1 end; end if;
    if qty <= 0 then continue; end if;
    if (r.f365 <= 3 or dbt or force) and r.roq > 0 then
      qty := least(qty, greatest(1, ceil(least(r.roq, case when r.rp > avail then greatest(r.rp - avail, 1) else 1 end))::int));
    end if;
    ext := round(qty * r.cost, 2);
    if run > 0 and run + ext > 18000 and r.f365 < 3 and not force and not dbt then continue; end if;
    run := run + ext;
    update _sp set tier = 'bare_minimum', qty = qty, origen = 'stock', motivo = coalesce(nullif(r.dem_why,''),'bare minimum')||' · '||r.f365||' ordenes / '||trim_scale(r.u365)||' u · OH '||trim_scale(r.oh)||' TR '||trim_scale(r.tr) where pid = r.pid;
  end loop;
  update _sp set tier = null where (coalesce(cost,0) <= 0) or (coalesce(f365,0) = 0 and coalesce(unf,0) <= 0 and coalesce(rp,0) <= 0 and coalesce(roq,0) <= 0) and coalesce(unf,0) <= 0;
  update _sp k set
    qty_justas = case when k.shortfall > 0 then k.shortfall else 0 end,
    qty_alta = case when k.tier in ('urgente','alta_rotacion') then k.qty else 0 end,
    qty_media = case
      when k.shortfall > 0 then greatest(k.shortfall, ceil(greatest(0, k.rp - (k.oh + k.tr - k.unf)))::int)
      when k.sku = 'MCOR000790' then 0
      when k.tier = 'alta_rotacion' and k.rp > 0 and (k.oh + k.tr - k.unf) < k.rp
        then ceil(k.rp - (k.oh + k.tr - k.unf))::int
      else 0
    end
  where k.cand;

  -- b694 t1944: precio propuesto = último FOB a este proveedor, si no el último de cualquiera, si no FOB de catálogo. Nunca unit_cost (landed). El presupuesto bare ($18k) sigue en costo landed.
  alter table _sp add column if not exists precio numeric not null default 0;
  alter table _sp add column if not exists precio_ref text not null default 'sin_precio';
  alter table _sp add column if not exists refs jsonb;
  update _sp z set
    precio = coalesce(uv.pu, ua.pu, fv.p, 0),
    precio_ref = case
      when uv.pu is not null then 'ultimo_proveedor'
      when ua.pu is not null then 'ultimo'
      when fv.p is not null then 'fob'
      else 'sin_precio'
    end,
    refs = jsonb_build_object(
      'min', case when mn.pu is not null then jsonb_build_object('p', mn.pu, 'n', mn.n, 'f', mn.f, 'prov', mn.prov) else null end,
      'ult', case when ua.pu is not null then jsonb_build_object('p', ua.pu, 'n', ua.n, 'f', ua.f, 'prov', ua.prov) else null end,
      'ultProv', case when uv.pu is not null then jsonb_build_object('p', uv.pu, 'n', uv.n, 'f', uv.f, 'prov', uv.prov) else null end,
      'n', coalesce(hx.n, 0),
      'hist', coalesce(hx.hist, '[]'::jsonb)
    )
  from (
    select distinct on (l.product_id)
      l.product_id pid,
      round(l.unit_price*(1-coalesce(l.discount_pct,0)/100), 4) pu,
      o.order_number n,
      to_char((o.order_date at time zone 'America/Guayaquil')::date, 'YYYY-MM-DD') f,
      vd.name prov
    from app.po_lines l
    join app.purchase_orders o on o.id = l.purchase_order_id
    left join app.vendors vd on vd.id = o.vendor_id
    where not coalesce(o.is_quote,false) and not coalesce(o.is_cancelled,false)
      and l.unit_price > 0 and o.vendor_id = v.id
    order by l.product_id, o.order_date desc nulls last, o.order_number desc
  ) uv
  full join (
    select distinct on (l.product_id)
      l.product_id pid,
      round(l.unit_price*(1-coalesce(l.discount_pct,0)/100), 4) pu,
      o.order_number n,
      to_char((o.order_date at time zone 'America/Guayaquil')::date, 'YYYY-MM-DD') f,
      vd.name prov
    from app.po_lines l
    join app.purchase_orders o on o.id = l.purchase_order_id
    left join app.vendors vd on vd.id = o.vendor_id
    where not coalesce(o.is_quote,false) and not coalesce(o.is_cancelled,false)
      and l.unit_price > 0
    order by l.product_id, o.order_date desc nulls last, o.order_number desc
  ) ua on ua.pid = uv.pid
  full join (
    select distinct on (l.product_id)
      l.product_id pid,
      round(l.unit_price*(1-coalesce(l.discount_pct,0)/100), 4) pu,
      o.order_number n,
      to_char((o.order_date at time zone 'America/Guayaquil')::date, 'YYYY-MM-DD') f,
      vd.name prov
    from app.po_lines l
    join app.purchase_orders o on o.id = l.purchase_order_id
    left join app.vendors vd on vd.id = o.vendor_id
    where not coalesce(o.is_quote,false) and not coalesce(o.is_cancelled,false)
      and l.unit_price > 0
    order by l.product_id, l.unit_price*(1-coalesce(l.discount_pct,0)/100) asc, o.order_date desc nulls last
  ) mn on mn.pid = coalesce(uv.pid, ua.pid)
  full join (
    select p.id pid,
      coalesce(
        (select pv.cost from app.product_vendors pv
          where pv.product_id = p.id and pv.cost > 0
            and (pv.vendor_inflow_id = v.id or pv.vendor_inflow_id = v.inflow_id)
          order by pv.cost limit 1),
        (select pv.cost from app.product_vendors pv
          where pv.product_id = p.id and pv.cost > 0
            and p.last_vendor_id is not null
            and (pv.vendor_inflow_id = p.last_vendor_id)
          order by pv.cost limit 1),
        (select min(pv.cost) from app.product_vendors pv where pv.product_id = p.id and pv.cost > 0),
        nullif((p.cost_prov_data->>'precio')::numeric, 0)
      ) p
    from app.products p
    where p.id in (select pid from _sp)
  ) fv on fv.pid = coalesce(uv.pid, ua.pid, mn.pid)
  full join (
    select s.pid, count(*)::int n,
      coalesce(jsonb_agg(s.item order by s.rn) filter (where s.rn <= 8), '[]'::jsonb) hist
    from (
      select l.product_id pid,
        jsonb_build_object(
          'p', round(l.unit_price*(1-coalesce(l.discount_pct,0)/100), 4),
          'n', o.order_number,
          'f', to_char((o.order_date at time zone 'America/Guayaquil')::date, 'YYYY-MM-DD'),
          'prov', vd.name,
          'q', l.quantity
        ) item,
        row_number() over (partition by l.product_id order by o.order_date desc nulls last, o.order_number desc) rn
      from app.po_lines l
      join app.purchase_orders o on o.id = l.purchase_order_id
      left join app.vendors vd on vd.id = o.vendor_id
      where l.product_id in (select pid from _sp)
        and not coalesce(o.is_quote,false) and not coalesce(o.is_cancelled,false)
        and l.unit_price > 0
    ) s
    group by s.pid
  ) hx on hx.pid = coalesce(uv.pid, ua.pid, mn.pid, fv.pid)
  where z.pid = coalesce(uv.pid, ua.pid, mn.pid, fv.pid, hx.pid);

  select jsonb_build_object(
    'ok', true,
    'generado', to_char(now() at time zone 'America/Guayaquil', 'YYYY-MM-DD HH24:MI'),
    'regla_tuberia', coalesce(p_regla_tuberia, true),
    'frecuencia', freq_txt,
    'proveedor', jsonb_build_object('id', v.id, 'nombre', v.name, 'contacto', v.contact_name, 'email', btrim(coalesce(v.email,'')), 'telefono', v.phone, 'lead_dias', case when v_boy then 20 else coalesce(v.lead_time_days, 45) end, 'payment_terms_id', v_terms, 'terminos', (select name from app.payment_terms where id = v_terms)),
    'lineas', coalesce((select jsonb_agg(jsonb_build_object('capa', tier, 'product_id', pid, 'sku', sku, 'descripcion', name, 'oh', oh, 'transito', tr, 'transito_refs', tr_refs, 'comprometido', unf, 'comprometido_refs', com_refs, 'proyectado', oh + tr - unf, 'rp', rp, 'roq', roq, 'cant', z.qty, 'cant_justas', z.qty_justas, 'cant_media', z.qty_media, 'cant_alta', z.qty_alta, 'shortfall', z.shortfall, 'precio', round(z.precio, 4), 'precio_ref', z.precio_ref, 'total', round(z.qty * z.precio, 2), 'refs', z.refs, 'motivo', z.motivo, 'origen', z.origen, 'f365', f365, 'u365', u365, 'ultima_venta', ls, 'proyecto', proyecto) order by case z.tier when 'urgente' then 1 when 'alta_rotacion' then 2 else 3 end, z.f365 desc, z.sku) from (select * from _sp) z where z.tier is not null and z.qty > 0), '[]'::jsonb),
    'resumen', (select jsonb_agg(jsonb_build_object('capa', c, 'lineas', n, 'total', t) order by o) from (select c, o, count(k.pid) n, coalesce(round(sum(k.qty * k.precio), 2), 0) t from (values ('urgente',1),('alta_rotacion',2),('bare_minimum',3)) cc(c,o) left join _sp k on k.tier = cc.c and k.qty > 0 group by 1,2) s),
    'falta_pedir', coalesce((select round(sum(z.shortfall * z.precio), 2) from (select * from _sp) z where z.shortfall > 0), 0),
    'niveles', jsonb_build_object(
      'justas', (select jsonb_build_object('lineas', count(*), 'total', coalesce(round(sum(z.qty_justas * z.precio), 2), 0)) from (select * from _sp) z where z.qty_justas > 0),
      'media', (select jsonb_build_object('lineas', count(*), 'total', coalesce(round(sum(z.qty_media * z.precio), 2), 0)) from (select * from _sp) z where z.qty_media > 0),
      'alta', (select jsonb_build_object('lineas', count(*), 'total', coalesce(round(sum(z.qty_alta * z.precio), 2), 0)) from (select * from _sp) z where z.qty_alta > 0),
      'completa', (select jsonb_build_object('lineas', count(*), 'total', coalesce(round(sum(z.qty * z.precio), 2), 0)) from (select * from _sp) z where z.tier is not null and z.qty > 0)
    ),
    'stock', coalesce((select jsonb_agg(jsonb_build_object('sku', sku, 'descripcion', name, 'oh', oh, 'transito', tr, 'comprometido', unf, 'rp', rp, 'roq', roq, 'reorden', en, 'f365', f365, 'u365', u365, 'ultima_venta', ls) order by sku) from _sp where cand and (f365 > 0 or oh > 0 or tier is not null)), '[]'::jsonb)
  ) into res;
  return res;
end $function$
