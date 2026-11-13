with up as (update app.portal_users set modulos = array_remove(modulos, '~doc.e.imprimir=1') where nombre in ('EFCH','Oswal') and '~doc.e.imprimir=1' = any(modulos) returning nombre, modulos)
insert into app.portal_perm_log(actor,nombre,accion,despues) select 'MINECORE DEVOPS rollback t1958', nombre, 'editar', jsonb_build_object('modulos',modulos) from up;
