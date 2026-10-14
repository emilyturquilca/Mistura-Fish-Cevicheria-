# Mistura Fish · Gestión y reportes

Primera versión: **compras → proveedores → recepción → inventario → mermas → escandallos → rentabilidad → sincronización Loyverse**. Producción, cocina/comandas, personal, clientes/fidelización y pronóstico quedan para una segunda etapa.

## Uso

1. En **Proveedores**, registra nombre, RUC opcional y contacto.
2. En **Inventario**, crea insumos con unidad base kg, l o un y stock mínimo. Para existencias anteriores al sistema, registra un conteo inicial con costo y motivo.
3. En **Compras**, registra proveedor, fecha, referencia, cantidades y costo final por unidad base. El pedido no aumenta el stock.
4. En **Recepción**, confirma cantidades recibidas y costo real; puedes indicar lote, vencimiento y comprobante. Admite entregas parciales y bloquea cantidades superiores a lo pendiente.
5. **Inventario** muestra existencias y costo promedio ponderado. Registra consumos reales y ajustes por conteo; **Mermas** registra pérdidas con motivo y costo de la salida. No se permite stock negativo.
6. En **Escandallos**, vincula el producto de Loyverse con sus insumos, cantidad neta, rendimiento técnico y porciones. Convierte g/kg y ml/l sin mezclar magnitudes.
7. **Rentabilidad** presenta el beneficio histórico de los recibos y, separado, el margen teórico de las recetas con costos actuales. Los productos sin receta o sin costo completo se excluyen de la estimación y se indican explícitamente.

El panel consulta Loyverse; no registra ventas, cobra ni envía pedidos a proveedores. Los consumos se registran manualmente; importar ventas **todavía no descuenta inventario automáticamente**. El margen no incluye gastos operativos.

## Base compartida

Las operaciones, el catálogo y los recibos sincronizados por API se guardan en PostgreSQL (Neon). Laptop y tablet deben abrir el mismo enlace permanente e iniciar sesión. **Actualizar datos** recupera cambios de otro dispositivo. Los cambios simultáneos provocan un aviso para revisar el formulario, en lugar de sobrescribirlos.

La tabla mistura_operations contiene un documento JSONB versionado con proveedores, insumos, pedidos, recepciones, movimientos, recetas, comandos y ventas. Las reglas se validan en el servidor; un UPDATE condicionado a la versión confirma todo el movimiento o ninguno. Los identificadores de comando evitan escrituras duplicadas por reintentos. Los movimientos no tienen borrado: las diferencias físicas se corrigen con un conteo documentado. Los costos de las salidas quedan fijados al registrarlas; los escandallos utilizan el costo promedio vigente.

Esta estructura corresponde a un negocio pequeño y una primera versión. Antes de sumar múltiples locales, años de historial o permisos por usuario, conviene separar entidades y recibos en tablas e incorporar migraciones. No hay inventario por lote ni reservas; lote/vencimiento sirven para trazabilidad del movimiento, no para FIFO/FEFO. Las fechas describen el documento; la valoración se aplica en el orden de registro, sin recalcular costos retrospectivos.

Los archivos manuales y archivos históricos anteriores a la ventana de sincronización se conservan en ese navegador; no se migran automáticamente a PostgreSQL. Los archivos manuales siguen siendo locales y no se agregan a la base. El historial API conserva recibos anteriores guardados; la sincronización ordinaria consulta los últimos 30 días. Las anulaciones consultadas se retiran y las devoluciones se restan. Cambios fuera de esa ventana requieren revisar el historial.

## Instalación y despliegue

Node.js 22 o superior. Ejecuta npm ci y npm test. Vercel debe desplegar la carpeta con index.html, package.json y api/ (framework Other). Conecta PostgreSQL desde Storage y configura estas variables **solo en el servidor**:

| Variable | Uso |
|---|---|
| APP_PASSWORD | Contraseña del panel y las API |
| LOYVERSE_TOKEN | Token compartido para consultar Loyverse |
| DATABASE_URL | Conexión de PostgreSQL, provista por la integración |

Vuelve a desplegar después de agregar variables. La API crea la tabla al primer acceso autorizado; no crea datos operativos ficticios. Usa una base o rama separada para pruebas/preview. No publiques .env.local ni credenciales. La contraseña es compartida, con acceso completo; esta versión no implementa perfiles separados.

## Estructura y verificación

| Archivo | Función |
|---|---|
| index.html | Navegación, ventas, filtros, gráficos y Excel |
| operations-ui.js | Formularios y conexión a la base |
| operations-core.js | Reglas de stock, costos, recepción y escandallos |
| api/operations.js | Escrituras autorizadas con control de versión |
| api/sync-sales.js | Sincronización de Loyverse hacia PostgreSQL |
| api/loyverse.js | Proxy de consulta y comprobación de conexión |
| sales-core.js | Fechas, recibos, importes y exportaciones |

npm test verifica importes, fechas UTC-05:00, anulaciones, devoluciones, Excel numérico, recepciones parciales, reintentos, unidades, costos ponderados, stock insuficiente y rendimientos. node tests/preview.mjs abre una prueba en http://127.0.0.1:4173 con datos ficticios y almacenamiento **en memoria**: comprueba formularios y sesiones compartidas, pero no verifica PostgreSQL ni necesita secretos de producción.

Los Excel incluyen resumen, totales por día y recibos del filtro. El beneficio histórico usa cost_total del recibo; costos ausentes se muestran desconocidos. Las fechas usan UTC-05:00. Las URL de despliegues individuales mantienen su versión; usa el enlace permanente para recibir actualizaciones.
