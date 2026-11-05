# Puente de etiquetas en el iMac de bodega

El instalador es `instalar-bodega.command`, junto a `bridge.py` y `pick-python.sh`. En Catalina no hay que instalar Python: el sistema trae `/usr/bin/python2.7`. `/usr/bin/python3` no se ejecuta, porque abre el cuadro de herramientas de Apple.

El ZIP para la Mac no lleva secretos ni el servidor. Pide la cola Wireless y el código que muestra el portal (Preparar orden, «Código para el iMac»). El token no sale en pantalla.

No se corrió este instalador en el iMac. En Linux se probó el mismo `bridge.py` con CPython 2.7.18 y 3.12, y un stub que imita el cuadro de Apple sin ejecutarlo.

ventas-api sigue en 410. No hay que volver a aplicar SQL ni tocar inFlow. Que CUPS acepte un trabajo no significa que la etiqueta haya salido.
