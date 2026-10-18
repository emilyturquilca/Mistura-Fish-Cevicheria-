# Mistura Fish · Gestión y reportes

Primera versión: compras, proveedores, inventario, mermas, escandallos, rentabilidad y sincronización Loyverse. **Reservaciones** permite planificar pedidos confirmados y sus compras. Producción por lotes, cocina/comandas, personal, fidelización y pronóstico quedan para otra etapa.

## Uso

1. En **Inventario → Agregar insumo**, completa nombre, categoría, proveedor opcional, unidad de medida, stock y costo por unidad. Unidad kg y stock 5 significa 5 kg. Puedes crear una categoría y un proveedor desde ese formulario. La tabla permite buscar, filtrar, editar y eliminar. Para corregir lo que realmente tienes, edita Stock; no ingreses la diferencia.
2. En **Proveedores**, completa RUC opcional y teléfono. Un proveedor asignado a insumos o compras necesita reasignarse antes de eliminarlo.
3. En **Compras**, registra proveedor, cantidades y costo final por kg, litro o unidad. El pedido no aumenta el stock. Pulsa **Recibir** cuando llegue: confirma cantidades y costos reales, con comprobante, lote y vencimiento opcionales. Admite entregas parciales.
4. En **Escandallos**, elige un producto de Loyverse e indica sus insumos, cantidad neta, rendimiento y porciones. Puedes **Crear insumo aquí** sin salir de la receta. Convierte g/kg y ml/l; 80 % de rendimiento significa que de 1 kg comprado aprovechas 800 g. La cantidad de compra/consumo es cantidad neta ÷ rendimiento ÷ porciones. Cada receta muestra cuántos platos permite el stock actual; esa capacidad es individual, porque otros platos pueden compartir insumos.
5. En **Reservaciones**, registra fecha/hora, personas y platos pedidos. El plan de la fecha suma qué preparar y, por ingrediente, lo necesario, el stock y lo que falta comprar. Si falta una receta, muestra que el cálculo está incompleto. Las reservaciones no descuentan stock ni generan compras automáticamente. Marca Atendida o Cancelada para retirarlas del plan pendiente.
6. **Mermas** registra pérdidas físicas de insumos y resta stock. Si un plato ya vendido se devuelve y se descarta, usa **Registrar plato devuelto**: registra su costo como pérdida sin descontar otra vez los ingredientes. La devolución financiera por sí sola no confirma que se haya descartado comida.
7. **Rentabilidad** separa beneficio histórico de los recibos y margen teórico de las recetas con costos actuales. Los costos desconocidos se indican; el margen no incluye gastos operativos. **Ventas por hora** agrupa los recibos del período seleccionado por hora local y permite exportar un Excel numérico de las 24 horas.

## Proveedores y cuentas por pagar · primera etapa

Los proveedores se clasifican en **Pescado, Verduras, Pulpo, Servicios (gas y agua), Abarrotes y Conchas negras**; los no clasificados quedan en Sin categoría. La categoría se elige al agregar o editar y se puede filtrar en el directorio. **Agregar categoría** crea una categoría propia, incluso antes de asignarla a un proveedor. El formulario también ofrece **Agregar otra categoría…** para guardarla junto al proveedor en una sola operación. **Administrar categorías propias** permite renombrarlas (actualiza todos sus proveedores), eliminarlas si no están asignadas y deshacer el borrado. Los nombres no pueden duplicar otra categoría, incluso cambiando mayúsculas o tildes. Los proveedores anteriores sin categoría se clasifican solo cuando su nombre indica un rubro inequívoco; una categoría elegida manualmente se conserva al cambiar el nombre.

En **Proveedores → Ver ficha** se consultan condiciones, historial de compras, cantidades recibidas, insumos suministrados, último costo recibido, cuentas y abonos. El historial combina los insumos asignados en Inventario con las recepciones reales. Una compra solicitada no es todavía una deuda: cada recepción genera una cuenta por su importe real, incluso cuando la entrega es parcial.

Cada proveedor admite **Contado** o **Crédito** con días de plazo y condiciones adicionales. Las recepciones proponen ese acuerdo y permiten confirmar el vencimiento. Contado vence el día de recepción, pero no se marca pagado automáticamente. Cambiar las condiciones generales del proveedor solo afecta propuestas futuras, sin mover los vencimientos ya acordados.

**Cuentas por pagar** muestra saldo pendiente, vencido y abonos, con filtros de proveedor y estado. **Registrar abono** anota un pago ya realizado, su fecha, medio y referencia; no transfiere dinero. Los abonos reducen la deuda sin modificar el inventario. No admite anticipos antes de recibir mercadería, excedentes sobre una cuenta ni importes con más de dos decimales. Los importes son en soles.

Las recepciones anteriores sin condiciones de pago aparecen **Por confirmar** y quedan fuera del saldo pendiente hasta revisarlas. Confirma el acuerdo y registra los pagos que ya se hicieron; el sistema no puede conocer pagos anteriores que no registraste. **Registrar deuda anterior** permite incorporar solo un saldo pendiente previo que no exista ya en Compras; no agrega stock. Se evita duplicar su referencia dentro del proveedor o con una recepción existente.

Las condiciones, deudas anteriores y abonos pueden editarse. Los abonos y deudas manuales admiten eliminación recuperable con Deshacer. Antes de eliminar una cuenta, recepción o compra con abonos, corrige o elimina esos abonos: así no quedan pagos sin vínculo. Corregir cantidades o costos recibidos recalcula automáticamente la cuenta; se bloquea si el nuevo importe quedaría por debajo de lo ya abonado. Todas las escrituras usan la misma base compartida y control de versión.

La evaluación de puntualidad, calidad, cumplimiento de cantidades y variación de precios corresponde a la siguiente etapa. Esta entrega muestra el último costo recibido y las cantidades, sin inventar calificaciones de desempeño.

## Consumo automático y devoluciones

Al sincronizar Loyverse, las ventas con receta configurada descuentan sus ingredientes una sola vez. Se activa desde el primer guardado o sincronización con esta versión; no descuenta ventas anteriores a la activación ni anteriores a la creación de su receta. Verifica el stock físico al empezar. Los cambios de receta se aplican a ventas posteriores, conservando la fórmula de las anteriores. Las ventas sin receta se señalan sin inventar consumos.

Una devolución o anulación no recupera físicamente ingredientes ya preparados: mantiene el consumo. Si no se preparó el plato o se recuperó realmente un insumo, corrige el stock físico en Inventario. El costo de un plato descartado es informativo: no debe sumarse otra vez como consumo al valorar el inventario. Una venta real puede evidenciar stock negativo por cantidades registradas insuficientes; el panel avisa para corregirlas. Las salidas manuales siguen exigiendo stock disponible.

El panel sincroniza al abrir y aproximadamente cada minuto mientras está abierto, visible y sin formularios en edición. Puedes forzar **Sincronizar ahora**. No hay webhook ni proceso de sincronización mientras todos los paneles estén cerrados. Las ventas importadas manualmente desde archivos no generan consumo automático ni escrituras compartidas.

## Base compartida

Operaciones, catálogo y recibos API se guardan en PostgreSQL (Neon). Laptop y tablet deben abrir el mismo enlace permanente e iniciar sesión. **Actualizar datos** recupera cambios de otro dispositivo. Una versión comprobada en cada escritura evita sobrescribir cambios simultáneos; los identificadores de comando evitan duplicados al reintentar.

Los registros operativos son editables y los borrados recuperables. El aviso permite **Deshacer**; en Configuración se pueden recuperar registros eliminados, sin ocupar un apartado del menú. Eliminar una compra incluye sus recepciones y movimientos vinculados y muestra el efecto antes de confirmar. Los insumos usados en compras, ventas o recetas requieren corregir sus dependencias. Las correcciones recalculan stock y costos posteriores. Los cambios del campo Stock conservan el total físico indicado, incluso si después llegan ventas anteriores que estaban pendientes de sincronizar.

La tabla mistura_operations contiene un documento JSONB versionado con las entidades, ventas, historial de recetas y consumos por recibo. Las reglas se validan en el servidor y el guardado es atómico. Esta estructura sirve para un negocio pequeño en su primera versión; antes de sumar varios locales o años de historial conviene separar entidades y recibos en tablas e incorporar migraciones. No hay inventario por lote ni reserva física de insumos; lote/vencimiento sirven para trazabilidad, sin FIFO/FEFO. El costo del inventario incorpora el costo de las entradas; editar el costo junto al stock establece la valoración actual indicada.

Las sincronizaciones ordinarias consultan los últimos 30 días y conservan el historial API ya guardado. Las anulaciones consultadas se retiran de los totales y las devoluciones se restan. Cambios anteriores a esa ventana requieren revisar el historial. Los archivos y archivos históricos locales no se migran automáticamente a PostgreSQL.

## Instalación y despliegue

Node.js 22 o superior. Ejecuta npm ci y npm test. Vercel debe desplegar la carpeta con index.html, package.json y api/ (framework Other). Conecta PostgreSQL desde Storage y configura estas variables solo en el servidor:

| Variable | Uso |
|---|---|
| APP_PASSWORD | Contraseña del panel y de las API |
| LOYVERSE_TOKEN | Token compartido para consultar Loyverse |
| DATABASE_URL | Conexión de PostgreSQL provista por la integración |

Vuelve a desplegar tras agregar variables. La API crea su tabla al primer acceso autorizado, sin datos ficticios. Usa una base o rama separada para pruebas. Nunca publiques .env.local ni credenciales. La contraseña compartida da acceso completo; esta versión no tiene perfiles por usuario. El panel no registra ventas, cobra ni envía pedidos a proveedores.

## Estructura y verificación

| Archivo | Función |
|---|---|
| index.html | Navegación, ventas, filtros, gráficos y Excel |
| operations-ui.js / operations-edit-ui.js | Conexión compartida, formularios, editores y borrados |
| operations-core.js / operations-edit-core.js | Compras, recepción, costos y recálculo del inventario |
| restaurant-core.js | Consumo por receta y recibo, reservaciones, capacidad y mermas de platos |
| restaurant-ui.js | Inventario simplificado, reservaciones y ventas por hora |
| payables-core.js / payables-ui.js | Fichas de proveedor, condiciones, cuentas, vencimientos y abonos |
| api/operations.js | Escrituras autorizadas con control de versión |
| api/sync-sales.js | Sincronización de Loyverse y consumo hacia PostgreSQL |
| api/loyverse.js | Proxy de consulta y comprobación de conexión |
| sales-core.js | Fechas, recibos, importes y agregación horaria |

npm test verifica fechas UTC-05:00, importes, devoluciones, Excel numérico, compras y recepciones, unidades, costos, rendimientos, edición, recuperación, consumos idempotentes, recetas históricas, conteos físicos y planes de reservaciones. node tests/preview.mjs --seed-operations abre una prueba marcada en http://127.0.0.1:4173 con datos ficticios y almacenamiento en memoria. Sus rutas demo solo existen en ese servidor de pruebas; no usa secretos ni verifica PostgreSQL.

Los Excel de Reportes incluyen resumen, totales por día y recibos del filtro; Ventas por hora tiene su exportación aparte. El beneficio histórico usa cost_total del recibo. Las URL de despliegues individuales mantienen su versión; usa el enlace permanente para recibir actualizaciones.
