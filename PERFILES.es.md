# Perfiles y stock físico

## Administración / Dueña

El panel principal requiere la contraseña de administración del servidor. El menú muestra Dashboard, Ventas, Reportes, Proveedores, Cuentas por pagar, Compras y stock, Pedidos web y Configuración. La información completa y las conexiones con proveedores y pasarelas se mantienen en endpoints de administración.

## Operativo / Caja y Cocina

`/operativo` requiere un código operativo independiente. Administración lo genera o renueva en Configuración. El servidor guarda únicamente su huella; renovarlo invalida el anterior. El código no permite usar las APIs de reportes, ventas históricas, proveedores ni configuración.

Los cinco módulos son Inicio, Cocina / comandas, Producción, Reservaciones y Clientes / fidelización. La API devuelve solo los campos necesarios para ese trabajo; no envía el estado completo, costos de ingredientes, deudas o reportes de ventas. Caja ve el importe del pedido web para confirmar un cobro en efectivo. Cocina puede usar también el acceso más limitado `/cocina` y su propio código.

## Módulos avanzados

El perfil avanzado es un espacio reservado a administración y está oculto por defecto. Configuración permite habilitarlo expresamente. Incluye Inventario por receta, Mermas, Escandallos, Rentabilidad, Pronóstico y Sincronizar Loyverse. El perfil operativo no puede activar este espacio.

Las fichas técnicas y los costos exactos por kilo o unidad son necesarios para calcular escandallos y márgenes útiles. Activar el consumo por receta requiere además confirmar que las fichas y costos están definidos.

## Compras y stock físico global

Compras tiene dos vistas: compras recibidas y stock físico. Guardar «Registrar compra recibida» crea en una misma operación la compra, su recepción, el movimiento de stock y la cuenta del proveedor. Al contado queda pagada; a crédito conserva su vencimiento y deuda. Una repetición de la misma solicitud no duplica la compra.

«Anotar cuánto queda» registra el total físico contado, sin inventar una compra ni una deuda. Ejemplo: una compra de 20 kg entra al historial del proveedor; un conteo posterior de 5 kg deja 5 kg disponibles, conservando los 20 kg comprados.

El modo predeterminado es global: las ventas de platos no descuentan ingredientes automáticamente. Los consumos históricos ya registrados se conservan. Si posteriormente se habilita el modo por receta, solo se incorporan consumos de ventas desde su activación; no se calcula consumo retroactivo del período sin fichas.

Los pedidos y compras anteriores sin recepción no se convierten automáticamente en mercadería recibida. Se conservan para revisión; las compras nuevas registradas como recibidas evitan el segundo paso.
