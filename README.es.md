# Mistura Fish · Panel analítico

🇬🇧 [Read in English](README.md)

Panel web que convierte las ventas ya registradas en **Loyverse** en indicadores, gráficos y reportes claros para la dueña del negocio. **No reemplaza al POS**: no registra ventas, no cobra ni imprime comprobantes.

## Funciones
- Dashboard: ventas de hoy y del mes, cantidad de ventas, ticket promedio, producto más vendido, categoría líder y método de pago más usado.
- Gráficos: ventas por día, por categoría, métodos de pago y productos más vendidos.
- Selector de período: hoy con fecha, flechas para recorrer días, calendario, esta semana, este mes, mes anterior y personalizado. Todos los filtros y agrupaciones usan `America/Lima`.
- Historial de ventas con búsqueda, filtros, detalle y **suma de totales** (útil para contabilidad).
- Productos, clientes y rentabilidad (el margen solo se calcula si existe el coste; si no, "Información no disponible").
- Reportes con exportación a Excel `.xlsx` (resumen, totales por día y todos los recibos del filtro), CSV y PDF (impresión del navegador). La pantalla Ventas también exporta sus filtros de búsqueda y método de pago.
- Ventas brutas, descuentos, devoluciones, ventas netas, total cobrado y beneficio bruto separados. El beneficio usa el costo histórico del recibo, cuando está disponible.
- Sincronización con Loyverse al abrir y con un botón: actualiza recibos existentes, retira anulaciones y resta devoluciones sin duplicarlos.

## Cómo funciona
```
Navegador (index.html)  ──►  /api/loyverse (función de Vercel)  ──►  API de Loyverse
   guarda los datos             agrega el token secreto
```
El panel se protege con una contraseña (`APP_PASSWORD`). La contraseña se valida antes de mostrar el panel y no queda guardada permanentemente en el navegador. Ya dentro, la dueña pega el token de Loyverse en el panel (se guarda solo en ese dispositivo y se envía a tu función de Vercel) o sube un archivo CSV/Excel exportado de Loyverse. Los datos se guardan en el navegador de cada dispositivo (localStorage) y se pueden volver a descargar de Loyverse en cualquier momento.

## Estructura
| Ruta | Función |
|---|---|
| `index.html` | Todo el front end (HTML, CSS, JavaScript y Chart.js por CDN) |
| `sales-core.js` | Fechas de Lima, actualización de recibos, importes y filas de exportación |
| `assets/` | SheetJS CE 0.20.3 y licencia Apache 2.0, para importar/exportar Excel sin CDN |
| `tests/sales.test.js` | Pruebas de fechas, recibos, conciliación de importes y exportación Excel |
| `api/loyverse.js` | Proxy seguro hacia la API de Loyverse (ver `api/README.md`) |
| `.env.example` | Nombres de las variables de entorno necesarias |

## Publicar (GitHub + Vercel)
1. Crea un repositorio **privado** en GitHub y sube estos archivos.
2. En Vercel: *Add New > Project*, importa el repositorio, framework **Other** y *Deploy*. Si el proyecto está dentro de una subcarpeta, en **Root Directory** elige la carpeta que contiene `index.html`, `package.json` y `api/loyverse.js`.
3. En *Project > Settings > Environment Variables* agrega `APP_PASSWORD` (abajo) y vuelve a desplegar.
4. Abre la dirección de Vercel y entra con la contraseña. En **Sincronizar Loyverse**, pega el token de Loyverse (API) y presiona **Guardar y sincronizar**, o sube un archivo CSV/Excel exportado.

### Variables de entorno
| Nombre | Descripción |
|---|---|
| `LOYVERSE_TOKEN` | Opcional. Token en el servidor. Si no lo pones, ingrésalo dentro del panel. |
| `APP_PASSWORD` | Contraseña larga con la que la dueña entra al panel. |

## Notas y límites
- Los recibos se identifican por N.º de recibo: sincronizarlos de nuevo actualiza sus importes sin duplicarlos. Los anulados se retiran y las devoluciones se guardan en negativo en su propia fecha.
- Ventas netas = ventas brutas − devoluciones antes de descuentos − descuentos netos. Los impuestos incluidos en el precio se conservan; impuestos añadidos, propinas y recargos se muestran separados del importe de ventas netas. El total cobrado los incluye.
- Beneficio bruto = ventas netas − costo histórico de los productos del recibo (`cost_total`). Si falta algún costo, se muestra "Información no disponible". No incluye gastos operativos.
- La sincronización automática consulta recibos creados en los últimos 30 días y actualiza los recibos recientes sin solicitar archivos antiguos fuera del historial permitido por Loyverse. El historial ya guardado se conserva. Cargar historial usa la fecha elegida; si Loyverse la restringe, muestra un mensaje claro. Un archivo manual no adelanta el cursor de sincronización API. Los recibos antiguos o de archivo sin desglose se señalan como provisionales hasta sincronizarlos con Loyverse.
- Usa el enlace permanente del proyecto para recibir actualizaciones; las URL de despliegues individuales mantienen la versión con la que se crearon.
- Un coste vacío o en 0 se muestra como "Información no disponible" (Loyverse no distingue "sin coste" de "coste 0"). No se estima nada.
- El almacenamiento del navegador es de unos 5 MB: alcanza para varios meses, no para años. El panel avisa cuando se llena.
- La contraseña se mantiene solo durante la sesión abierta del navegador. Al cerrar sesión o abrir una sesión nueva, debe ingresarse de nuevo.
- Un token ingresado en el panel se guarda en el navegador de ese dispositivo: usa el panel solo en dispositivos de confianza.
- Usa una sola fuente de datos (API o archivo), no ambas: identifican los productos distinto y podrían aparecer repetidos.
- Hay una sola contraseña compartida: usa una larga y mantén el repositorio privado.
- El plan gratuito (Hobby) de Vercel es solo para uso no comercial; un negocio necesita un plan de pago u otro servicio.
- Referencias de importes: [API de Loyverse](https://developer.loyverse.com/docs/) y [definiciones de ventas del Back Office](https://help.loyverse.com/help/sales-summary-report-back-office). Compara siempre el mismo período y los mismos filtros de tienda y empleado; este panel actualmente importa todas las tiendas y empleados.

## Verificación

Ejecuta `npm test` con Node.js. Incluye límites de medianoche de Lima, cambio de día, actualización y anulación de recibos, devoluciones, descuentos e impuestos, costos desconocidos, filtros y una exportación `.xlsx` que se vuelve a abrir para verificar sus valores numéricos.

Para verificar diferencias de un día, sincroniza los recibos reales, selecciona ese día y compara el Excel con Loyverse. Las pruebas usan datos sintéticos para demostrar el error de UTC; no identifican por sí solas los recibos que explican una diferencia real del negocio.

## Problemas frecuentes
| Síntoma | Causa probable |
|---|---|
| "Contraseña incorrecta" | Falta `APP_PASSWORD` o no se volvió a desplegar tras agregarla |
| "No se pudo conectar: Error 404" | Vercel no publicó `/api/loyverse`; revisa el **Root Directory**, confirma que `api/loyverse.js` esté en la raíz desplegada y vuelve a desplegar |
| "Falta el token de Loyverse" | No hay token guardado en el panel ni variable `LOYVERSE_TOKEN` |
| "Loyverse rechazó el token" | Token inválido o vencido, o el plan no permite la API |
| "No reconocí las columnas" | El archivo necesita columnas de N.º de recibo, fecha y total; envía los encabezados reales para ajustar |
| No aparecen ventas | Período equivocado o historial sin cargar (usa *Cargar historial*) |
| Aviso de almacenamiento | Carga un historial más corto o borra los datos del dispositivo |
