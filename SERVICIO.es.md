# Servicio y equipo

Los cinco módulos guardan sus registros mediante la misma API y base compartida del inventario. No requieren otra cuenta ni un plan de pago. Los formularios usan la versión del registro compartido para detectar cambios simultáneos.

- **Producción:** elige la fecha, revisa los pedidos confirmados y crea un plan desde ellos o manualmente. Completa las recetas para iniciar la preparación. El plan suma ingredientes compartidos entre platos y compara las necesidades con el stock actual. Si cambia un pedido, revisa y guarda las nuevas cantidades.
- **Cocina / comandas:** crea una comanda manual o copia una reservación. Avanza por Pendiente → En preparación → Lista → Entregada. Puedes corregir, cancelar o eliminar una comanda. Actualizar datos trae los cambios de otros dispositivos. Los pedidos de una reservación vinculada se cuentan una sola vez en producción.
- **Personal:** registra nombre, puesto, teléfono opcional y estado activo. Programa turnos, incluidos los nocturnos, sin superponer horarios de una misma persona. La asistencia se confirma manualmente. Este módulo no calcula sueldos.
- **Clientes / fidelización:** registra una ficha y, si aparece entre los recibos sincronizados, vincula el identificador de cliente de Loyverse. Esas compras cuentan automáticamente; no se unen clientes por coincidencia de nombre. Para fichas sin vínculo, registra como máximo una visita por fecha. Configura el número de compras o visitas y el beneficio que ofrecerá el restaurante. Registrar un beneficio utiliza las compras o visitas correspondientes. Los descuentos se aplican en Loyverse por separado.
- **Pronóstico:** compara las ventas del mismo día de la semana en las ocho semanas anteriores. Requiere tres fechas con ventas para estimar. Usa el promedio redondeado hacia arriba o los pedidos confirmados, el valor que sea mayor, y calcula ingredientes y faltantes. Se puede revisar la sugerencia como plan antes de guardarla. No incorpora clima, feriados ni eventos; los días sin recibos no se suponen días de ventas cero.

## Inventario e historial

Producción y comandas organizan el servicio; no vuelven a descontar ingredientes. El consumo sigue entrando con las ventas sincronizadas de Loyverse. Las pérdidas se registran en Mermas.

Todos los registros nuevos se pueden editar y eliminar con opción Deshacer. Las fichas de personas o clientes con historial relacionado requieren reasignar o eliminar primero ese historial. No se añade Papelera al menú. Quitar el programa de fidelización conserva los beneficios ya entregados.

Las devoluciones completas dejan de contar como compras de fidelización; las parciales conservan la compra mientras tenga importe neto positivo. Un beneficio ya entregado permanece en el historial. Si después faltan compras que lo respalden, la ficha lo señala para revisión. Los recibos antiguos sin identificador de cliente requieren actualizar su período desde Loyverse; no se asocian por nombre.

## Comprobaciones

`node --test tests/*.test.js` verifica reglas de stock, deudas, ventas y servicio. `node tests/preview.mjs --seed-operations` abre una revisión local con datos ficticios, sin credenciales ni operaciones en la base real.
