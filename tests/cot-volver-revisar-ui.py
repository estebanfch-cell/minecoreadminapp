# b726 t2148u — «Revisar precios» en cotización guardada. Todo stub: cero red real; el guardado se SIMULA (se captura el payload, no llega al servidor).
import json,asyncio,sys,copy
from playwright.async_api import async_playwright
import os
HERE=os.path.dirname(os.path.abspath(__file__))
BASE=os.path.dirname(HERE)
# El fixture (datos reales de la cotización, solo lectura) NO va en el repo (repo público): ruta por variable COT_FX.
FXP=os.environ.get('COT_FX','/workspace/sq-revisar/front/fx_sq1131.json')
if not os.path.exists(FXP): print('SKIP: falta fixture COT_FX');sys.exit(0)
FX=json.load(open(FXP))
SHOTS=os.environ.get('SHOTS','/tmp/cot-volver-revisar-shots');os.makedirs(SHOTS,exist_ok=True)
import os;os.makedirs(SHOTS,exist_ok=True)
SO=FX['get']['orden']['id']
fails=0
CAT={'on':True}
def ok(c,m,info=''):
    global fails
    print(('OK   ' if c else 'FAIL ')+m+(' — '+str(info)[:200] if (info and not c) else '')); fails+=(0 if c else 1)
def init(mods,nombre='EFCH',rol='admin'):
    return """(function(){var x=9999999999;localStorage.setItem('mc_user_name','%s');localStorage.setItem('mc_profile',JSON.stringify({nombre:'%s',rol:'%s',modulos:%s,empresa:'',master:true,aprobado:true,vinculada:true}));
localStorage.setItem('mc_sess',JSON.stringify({u:'%s',p:'x',exp:x*1000}));sessionStorage.setItem('mc_sbt',JSON.stringify({u:'%s',t:'T',exp:x}));})();"""%(nombre,nombre,rol,json.dumps(mods),nombre,nombre)
async def mk(b,w,mods,nombre='EFCH',rol='admin',saveRes=None):
    ctx=await b.new_context(viewport={'width':w,'height':900 if w>500 else 844},device_scale_factor=2 if w<500 else 1)
    pg=await ctx.new_page();REQ=[];ERR=[]
    async def route(r):
        u=r.request.url
        if u.startswith('http://local/'):
            f=BASE+'/'+(u[13:].split('?')[0].split('#')[0] or 'index.html')
            try:await r.fulfill(path=f)
            except Exception:await r.fulfill(status=404,body='')
            return
        if '/storage/v1/' in u or u.endswith(('.png','.jpg','.webp')):return await r.fulfill(status=404,body='')
        try:bd=json.loads(r.request.post_data or '{}')
        except Exception:bd={}
        REQ.append(bd);op=bd.get('op')
        res={'ok':True}
        if op=='get':res=copy.deepcopy(FX['get'])
        elif op=='refs':res=copy.deepcopy(FX['refs'])
        elif op=='save':res=saveRes or {'ok':True,'id':SO,'order_number':'MCOR-SQ-001131','simulado':True}
        elif op=='list':res={'ok':True,'ordenes':[]}
        elif op=='catalogos' and CAT['on']:res=copy.deepcopy(FX['catalogos'])
        await r.fulfill(status=200,content_type='application/json',headers={'Access-Control-Allow-Origin':'*'},body=json.dumps(res,default=str))
    await pg.route('**/*',route)
    await pg.add_init_script(init(mods,nombre,rol))
    pg.on('pageerror',lambda e:ERR.append(str(e)[:200]))
    pg.on('dialog',lambda d:asyncio.ensure_future(d.accept()))
    await pg.goto('http://local/index.html');await pg.wait_for_timeout(2500)
    await pg.evaluate("""(id)=>{document.querySelectorAll('[id$="-screen"]').forEach(function(s){s.style.display='none';});var s=document.getElementById('ventas-screen');s.style.display='block';try{document.getElementById('title').textContent='COTIZACIONES';}catch(e){}Ventas.abrir(id);}""",SO)
    await pg.wait_for_timeout(1800)
    return ctx,pg,REQ,ERR
async def overflow(pg,sel):
    return await pg.evaluate("""(sel)=>{var m=document.querySelector(sel);if(!m)return 'no-modal';var W=document.documentElement.clientWidth,bad=[];m.querySelectorAll('*').forEach(function(e){var r=e.getBoundingClientRect();if(r.width>0&&r.right>W+1&&getComputedStyle(e).position!=='fixed'){var p=e.closest('[style*="overflow-x:auto"],.ov-lt');if(!p)bad.push((e.className||e.tagName)+':'+Math.round(r.right));}});return bad.slice(0,5);}""",sel)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        for (w,con) in ((390,True),(1280,True),(390,False)):
            CAT['on']=con
            ctx,pg,REQ,ERR=await mk(b,w,['~cot.e.revprecios=1'])
            txt=await pg.inner_text('#ventas-screen')
            ok('MCOR-SQ-001131' in txt, f'{w}{"" if CAT["on"] else " sin catálogos"}: abre MCOR-SQ-001131 (fixture real, solo lectura)')
            nb=await pg.evaluate("[...document.querySelectorAll('#ventas-screen button')].filter(b=>b.innerText.includes('Volver a revisar')&&b.offsetParent).length")
            ok(nb==1, f'{w}{"" if CAT["on"] else " sin catálogos"}: botón «↩ Volver a revisar» visible en la cotización guardada ({nb})')
            await pg.screenshot(path=f'{SHOTS}/b726_{w}{'' if CAT['on'] else '_sincat'}_detalle.png')
            REQ.clear()
            await pg.click('#ventas-screen button:has-text("Volver a revisar")');await pg.wait_for_timeout(1800)
            t=await pg.inner_text('#ventas-screen')
            ok('Volver a revisar · MCOR-SQ-001131' in t, f'{w}{"" if CAT["on"] else " sin catálogos"}: abre el editor del cotizador con aviso «Volver a revisar · MCOR-SQ-001131»', t[:300])
            ok(any(r.get('op')=='refs' for r in REQ), f'{w}{"" if CAT["on"] else " sin catálogos"}: carga las referencias de precio de todas las líneas (op refs)')
            nrev=await pg.evaluate("[...document.querySelectorAll('#ventas-screen .mc-rfc button')].filter(b=>b.innerText.includes('Revisar precios')&&b.offsetParent).length")
            ok(nrev==10, f'{w}{"" if CAT["on"] else " sin catálogos"}: «Revisar precios ▾» visible en las 10 líneas ({nrev})')
            nhi=await pg.evaluate("document.querySelectorAll('#ventas-screen .mc-rfc button.hi').length")
            ok(nhi>=1 and 'referencia más alta' in t, f'{w}{"" if CAT["on"] else " sin catálogos"}: marca en rojo líneas con referencia más alta ({nhi})')
            vals=await pg.evaluate("[...document.querySelectorAll('#ventas-screen input[onchange*=unit_price]')].map(i=>i.value)")
            ok(vals[:4]==['43.85','38.48','40.56','30.84'] and len(vals)==10, f'{w}{"" if CAT["on"] else " sin catálogos"}: precios de partida = los guardados', vals)
            ov=await overflow(pg,'#ventas-screen'); ok(ov==[], f'{w}{"" if CAT["on"] else " sin catálogos"}: sin desborde horizontal', ov)
            await pg.screenshot(path=f'{SHOTS}/b726_{w}{'' if CAT['on'] else '_sincat'}_volver_revisar.png')
            await pg.evaluate("var w=document.querySelectorAll('#ventas-screen .mc-rfw')[6];w.classList.add('open');w.scrollIntoView({block:'center'})")
            await pg.wait_for_timeout(300)
            ov=await overflow(pg,'#ventas-screen'); ok(ov==[], f'{w}{"" if CAT["on"] else " sin catálogos"}: opciones de precio abiertas sin desborde', ov)
            await pg.screenshot(path=f'{SHOTS}/b726_{w}{'' if CAT['on'] else '_sincat'}_opciones_precio.png')
            await pg.evaluate("Ventas.usarP(6,8.9)");await pg.wait_for_timeout(500)
            REQ.clear()
            await pg.evaluate("Ventas.guardar()");await pg.wait_for_timeout(2000)
            sv=[r for r in REQ if r.get('op')=='save']
            ok(len(sv)==1, f'{w}{"" if CAT["on"] else " sin catálogos"}: Guardar envía una vez op save (simulado, no llega al servidor)')
            if sv:
                s0=sv[0];o=s0['orden'];L=s0['lineas'];F=FX['get']
                ok(o.get('id')==SO and not o.get('order_number'), f'{w}{"" if CAT["on"] else " sin catálogos"}: guarda sobre la MISMA cotización (mismo id, sin número nuevo)', o)
                ok([l['id'] for l in L]==[l['id'] for l in F['lineas']], f'{w}{"" if CAT["on"] else " sin catálogos"}: mismas líneas en el mismo orden')
                ok([float(l['quantity']) for l in L]==[float(l['quantity']) for l in F['lineas']] and [float(l['discount_pct']) for l in L]==[float(l['discount_pct']) for l in F['lineas']], f'{w}{"" if CAT["on"] else " sin catálogos"}: cantidades y descuentos intactos')
                ok([l['plazo_entrega'] for l in L]==[l['plazo_entrega'] for l in F['lineas']], f'{w}{"" if CAT["on"] else " sin catálogos"}: plazos guardados intactos', [l['plazo_entrega'] for l in L])
                ok([l.get('description') for l in L]==[l['description'] for l in F['lineas']], f'{w}{"" if CAT["on"] else " sin catálogos"}: descripciones intactas')
                pr=[float(l['unit_price']) for l in L];pr0=[float(l['unit_price']) for l in F['lineas']]
                ok(pr[6]==8.9 and all(pr[i]==pr0[i] for i in range(10) if i!=6), f'{w}{"" if CAT["on"] else " sin catálogos"}: solo cambia el precio elegido (línea 7 → 8.90)', pr)
                ok(L[6]['entrega'].get('revp')==1 and L[6]['entrega'].get('plazo')=='10-15 días', f'{w}{"" if CAT["on"] else " sin catálogos"}: la línea queda «revisado» sin perder su entrega', L[6]['entrega'])
                ok(o.get('payment_terms_id')==F['orden']['payment_terms_id'] and o.get('location_id')==F['orden']['location_id'] and o.get('email')==F['orden']['email'] and o.get('contact_name')==F['orden']['contact_name'], f'{w}{"" if CAT["on"] else " sin catálogos"}: cabecera (crédito 45 d, bodega, contacto) intacta', {k:(o.get(k),F['orden'].get(k)) for k in ('payment_terms_id','location_id','email','contact_name','phone','order_date','tax1_rate','custom_fields','po_number','order_remarks','requested_ship_date')})
                ok(all(not k.startswith('_') for l in L for k in l), f'{w}{"" if CAT["on"] else " sin catálogos"}: no viaja estado interno')
            ok(not ERR, f'{w}{"" if CAT["on"] else " sin catálogos"}: sin errores JS', ERR[:3])
            await ctx.close()
        for (mods,nombre,rol,lbl) in ((['cotizaciones+'],'SECRE','admin','admin sin interruptor'),(['~cot.e.revprecios=1','$precios=0','cotizaciones+'],'Oswal','usuario','Oswaldo $precios=0 aunque tenga token')):
            ctx,pg,REQ,ERR=await mk(b,1280,mods,nombre,rol)
            nb=await pg.evaluate("[...document.querySelectorAll('#ventas-screen button')].filter(b=>b.innerText.includes('Volver a revisar')).length")
            await pg.evaluate("Ventas.volverRevisar()");await pg.wait_for_timeout(500)
            t=await pg.inner_text('#ventas-screen')
            ok(nb==0 and 'Volver a revisar ·' not in t, f'{lbl}: no ve «Volver a revisar» y no se abre ({nb})')
            await ctx.close()
        FX_old=FX['get'];FX['get']=copy.deepcopy(FX_old);FX['get']['orden']['is_quote']=False;FX['get']['orden']['estado']='abierta'
        ctx,pg,REQ,ERR=await mk(b,1280,['~cot.e.revprecios=1'])
        nb=await pg.evaluate("[...document.querySelectorAll('#ventas-screen button')].filter(b=>b.innerText.includes('Volver a revisar')).length")
        ok(nb==0, f'convertida en OV: sin «Volver a revisar» ({nb})');await ctx.close();FX['get']=FX_old
        await b.close()
    print('FALLÓ',fails) if fails else print('TODO OK')
    sys.exit(1 if fails else 0)
asyncio.run(main())
