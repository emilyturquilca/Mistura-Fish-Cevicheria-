# Mistura Fish · Panel analítico

🇬🇧 [Read in English](README.md)

Panel web que convierte las ventas ya registradas en **Loyverse** en indicadores, gráficos y reportes claros para la dueña del negocio. **No reemplaza al POS**: no registra ventas, no cobra ni imprime comprobantes.

## Funciones
- Dashboard: ventas de hoy y del mes, cantidad de ventas, ticket promedio, producto más vendido, categoría líder y método de pago más usado.
- Gráficos: ventas por día, por categoría, métodos de pago y productos más vendidos.
- Selector de período: hoy, esta semana, este mes, mes anterior y personalizado.
- Historial de ventas con búsqueda, filtros, detalle y **suma de totales** (útil para contabilidad).
- Productos, clientes y rentabilidad (el margen solo se calcula si existe el coste; si no, "Información no disponible").
- Reportes con exportación a CSV y PDF (impresión del navegador).
- Sincronización con Loyverse al abrir y con un botón, sin duplicar ventas.

## Cómo funciona
```
Navegador (index.html)  ──►  /api/loyverse (función de Vercel)  ──►  API de Loyverse
   guarda los datos             agrega el token secreto
```
El panel se protege con una contraseña (`APP_PASSWORD`). Ya dentro, la dueña pega el token de Loyverse en el panel (se guarda solo en ese dispositivo y se envía a tu función de Vercel) o sube un archivo CSV/Excel exportado de Loyverse. Los datos se guardan en el navegador de cada dispositivo (localStorage) y se pueden volver a descargar de Loyverse en cualquier momento.

## Estructura
| Ruta | Función |
|---|---|
| `index.html` | Todo el front end (HTML, CSS, JavaScript y Chart.js por CDN) |
| `api/loyverse.js` | Proxy seguro hacia la API de Loyverse (ver `api/README.md`) |
| `.env.example` | Nombres de las variables de entorno necesarias |

## Publicar (GitHub + Vercel)
1. Crea un repositorio **privado** en GitHub y sube estos archivos.
2. En Vercel: *Add New > Project*, importa el repositorio, framework **Other** y *Deploy*.
3. En *Project > Settings > Environment Variables* agrega `APP_PASSWORD` (abajo) y vuelve a desplegar.
4. Abre la dirección de Vercel y entra con la contraseña. En **Sincronizar Loyverse**, pega el token de Loyverse (API) y presiona **Guardar y sincronizar**, o sube un archivo CSV/Excel exportado.

### Variables de entorno
| Nombre | Descripción |
|---|---|
| `LOYVERSE_TOKEN` | Opcional. Token en el servidor. Si no lo pones, ingrésalo dentro del panel. |
| `APP_PASSWORD` | Contraseña larga con la que la dueña entra al panel. |

## Notas y límites
- Se ignoran los recibos anulados y los reembolsos. Las ventas se identifican por N.º de recibo, así que sincronizar de nuevo no las duplica.
- Un coste vacío o en 0 se muestra como "Información no disponible" (Loyverse no distingue "sin coste" de "coste 0"). No se estima nada.
- El almacenamiento del navegador es de unos 5 MB: alcanza para varios meses, no para años. El panel avisa cuando se llena.
- Un token ingresado en el panel se guarda en el navegador de ese dispositivo: usa el panel solo en dispositivos de confianza.
- Usa una sola fuente de datos (API o archivo), no ambas: identifican los productos distinto y podrían aparecer repetidos.
- Hay una sola contraseña compartida: usa una larga y mantén el repositorio privado.
- El plan gratuito (Hobby) de Vercel es solo para uso no comercial; un negocio necesita un plan de pago u otro servicio.
- Los nombres de campos de Loyverse que usa `index.html` se escribieron de memoria: verifícalos con un recibo real y la documentación oficial.

## Problemas frecuentes
| Síntoma | Causa probable |
|---|---|
| "Contraseña incorrecta" | Falta `APP_PASSWORD` o no se volvió a desplegar tras agregarla |
| "Falta el token de Loyverse" | No hay token guardado en el panel ni variable `LOYVERSE_TOKEN` |
| "Loyverse rechazó el token" | Token inválido o vencido, o el plan no permite la API |
| "No reconocí las columnas" | El archivo necesita columnas de N.º de recibo, fecha y total; envía los encabezados reales para ajustar |
| No aparecen ventas | Período equivocado o historial sin cargar (usa *Cargar historial*) |
| Aviso de almacenamiento | Carga un historial más corto o borra los datos del dispositivo |
