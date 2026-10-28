# Pedidos web y cocina

- `/pedidos`: carta pública, carrito, mesa por QR, recojo y delivery. Permite comprar sin cuenta. El celular permite coordinar el pedido; correo y cumpleaños son opcionales. Solo se solicita día y mes de cumpleaños. La casilla de promociones está desmarcada inicialmente.
- `/cocina`: acceso independiente que muestra pedidos, platos, cantidades, observaciones y estado de pago. No devuelve reportes, costos, deudas, correos ni direcciones de clientes. Actualiza cada cinco segundos mientras la pestaña está visible. El sonido se activa con un botón.
- `/operativo`: perfil de caja y cocina, con producción, reservaciones y clientes, descrito en PERFILES.es.md.
- `Pedidos web` en administración: carta y disponibilidad, código de cocina, QR general o por mesa, contactos de pedidos, cobros en efectivo y conciliación con Loyverse.

## Puesta en marcha

La carta empieza cerrada en producción. En administración, entra a Pedidos web → Carta y disponibilidad, actualiza las referencias desde Loyverse, elige una presentación por producto y publica los platos. Confirma precios, disponibilidad, zona y costo de delivery. Luego activa «Recibir pedidos en la web». El QR se genera localmente, sin enviar datos del negocio a un servicio externo.

Genera el código de cocina en Pedidos web → Cocina y QR. Guárdalo al mostrarse y compártelo directamente con el equipo. Renovarlo invalida el anterior. Genera el código operativo más amplio en Configuración. No uses la contraseña de administración para el personal.

## Cobros en línea

El adaptador preparado es Mercado Pago, con Card Payment Brick para tarjeta y el SDK de Yape. No hay cuenta comercial conectada ni cobros reales habilitados por defecto. La elección de pasarela sigue pendiente; también existen alternativas como Culqi e Izipay. No se contrata ningún servicio automáticamente.

Para activar el adaptador de Mercado Pago, la dueña debe crear o conectar la cuenta comercial, revisar sus condiciones y configurar de forma privada en Vercel:

- `MP_ACCESS_TOKEN`: credencial privada de la cuenta comercial.
- `MP_PUBLIC_KEY`: clave pública del checkout.
- `MP_WEBHOOK_SECRET`: secreto de firma de notificaciones.
- `PUBLIC_APP_URL`: `https://misturafishreports.vercel.app` en producción.

El webhook de pagos es `https://misturafishreports.vercel.app/api/mp-webhook`. Configura el evento de pagos en la cuenta comercial. Después de cambiar variables, despliega nuevamente. Primero usa el entorno de pruebas y los datos de prueba oficiales de la pasarela. No uses tarjetas, códigos de Yape ni credenciales reales en tests automáticos, capturas o el repositorio.

La web no guarda tarjeta completa, CVV ni código de aprobación de Yape. El backend acepta el token del SDK y el identificador del pedido, calcula el importe con precios guardados y consulta el pago directamente a la pasarela. Verifica referencia, moneda, importe y método. Una respuesta perdida bloquea un nuevo cobro hasta conciliar. Reembolsos y contracargos se señalan para revisión, sin prometer una devolución automática.

Sin cuenta de pasarela, tarjeta y Yape en línea permanecen desactivados; el efectivo puede habilitarse por separado. Un QR de pedidos no es un QR de cobro Yape.

## Loyverse y reportes

En Pedidos web → Pagos y Loyverse, asocia la tienda y los métodos Efectivo, Tarjeta y Yape. Si cobras delivery, asócialo a un artículo específico. Solo entonces habilita el envío automático de pagos confirmados. Se necesita permiso para crear recibos en Loyverse. Los pedidos abiertos de Loyverse no se leen ni se crean por esta integración; cocina usa nuestro tablero.

Los pedidos entran «Por aceptar». En efectivo se pueden aceptar antes de cobrar. Con tarjeta o Yape se requiere confirmación del pago. El número de pedido vincula un único recibo de venta. La integración conserva referencia y resultado del envío; si una escritura queda incierta, no repite el POST automáticamente. «Conciliar con Loyverse» busca el recibo existente. Si no se encuentra una confirmación, corresponde revisión manual antes de autorizar otro envío.

Los precios del pedido se congelan al enviarlo. Los productos con impuestos añadidos requieren revisar su precio e impuestos antes de publicarse. No se aceptan precios, importes ni estados de pago enviados por el navegador como prueba de cobro.

El stock sigue el modo configurado: físico global por defecto, o consumo por receta cuando administración lo habilita expresamente. Guardar una comanda o avanzar su estado no descuenta ingredientes.

## Promociones

Se conserva el consentimiento y su fecha. Los contactos y cumpleaños quedan disponibles para administración. No se envían promociones automáticas todavía: hace falta seleccionar y conectar WhatsApp Business Platform, definir la campaña y completar su configuración antes de activar envíos.

## Comprobaciones

`node --test tests/*.test.js` incluye pruebas de separación de perfiles, pedidos repetidos, precios del servidor, firmas de notificaciones, cobros concurrentes y conciliación. `node tests/preview.mjs --seed-operations` permite probar el flujo completo con datos ficticios y pagos en línea desactivados. La revisión local usa los mismos controladores API, con almacenamiento de prueba explícito y sin operaciones en Neon, Loyverse o una pasarela real.
