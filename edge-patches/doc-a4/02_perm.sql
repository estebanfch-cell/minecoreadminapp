with u as (select nombre, modulos from app.portal_users where nombre in ('EFCH','Oswal') and not ('~doc.e.imprimir=1' = any(modulos))),
up as (update app.portal_users p set modulos = array_append(p.modulos, '~doc.e.imprimir=1') from u where p.nombre=u.nombre returning p.nombre, u.modulos antes, p.modulos despues)
insert into app.portal_perm_log(actor,nombre,accion,antes,despues) select 'MINECORE DEVOPS (pedido EFCH t1954u/t1959u)', nombre, 'editar', jsonb_build_object('modulos',antes), jsonb_build_object('modulos',despues) from up returning id, nombre;
