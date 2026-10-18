// Daily summaries and explicit, read-only voice commands. No business writes here.
(() => {
  const C=()=>globalThis.MisturaCore;
  const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  function command(text){
    const value=normalize(text).replace(/^(por favor |mistura |oye mistura )/,'').replace(/ por favor$/,'');
    if(/^(leer|lee|escuchar|escucha) (el )?(saludo|resumen)( de hoy)?$/.test(value))return {action:'read'};
    const target=value.replace(/^(abre|abrir|ver|ir a|ir al|mostrar|muestra) (el |la |los |las )?/,'');
    const views={'inicio':'Inicio','inventario':'Inventario','compras':'Compras','proveedores':'Proveedores','deudas':'Cuentas por pagar','cuentas por pagar':'Cuentas por pagar','reservaciones':'Reservaciones','reservaciones de hoy':'Reservaciones','recepciones':'Reservaciones','recepciones de hoy':'Reservaciones','recepciones de clientes':'Reservaciones','recepciones de productos':'Recepción','mermas':'Mermas','recetas':'Escandallos','escandallos':'Escandallos','rentabilidad':'Rentabilidad','ventas':'Ventas','ventas por hora':'Ventas por hora'};
    return views[target]?{action:'navigate',view:views[target]}:null;
  }
  function daily(s,now=new Date()){
    const day=C().dateKey(now),reservations=(s.reservations||[]).filter(r=>C().dateKey(r.plannedAt)===day&&r.status!=='Cancelada').sort((a,b)=>a.plannedAt.localeCompare(b.plannedAt));
    const receptions=(s.receptions||[]).filter(r=>r.date===day).map(r=>({...r,supplier:s.suppliers.find(p=>p.id===s.orders.find(o=>o.id===r.orderId)?.supplierId)?.name||'Proveedor sin asignar'}));
    const pending=reservations.filter(r=>r.status==='Pendiente');
    const plan=globalThis.MisturaRestaurant.plan(s,day);
    const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Lima',hour:'2-digit',hourCycle:'h23'}).format(now));
    return {day,reservations,receptions,pending,plan,guests:pending.reduce((n,r)=>n+r.guests,0),dishes:Object.values(plan.dishes).reduce((n,q)=>n+q,0),greeting:hour<12?'Buenos días':hour<19?'Buenas tardes':'Buenas noches'};
  }
  // Editorial snapshot, never advertised as a live fishery authorization feed.
  const fishing={reviewed:'2026-10-17',reviewBy:'2026-10-24',
    pericoSource:'https://elperuano.pe/noticia/303814-produce-apertura-temporada-de-pesca-de-perico-ante-mayor-disponibilidad-por-el-nino',
    vedaSource:'https://pescayconsumoresponsable.produce.gob.pe/vedas.html',
    updates:'https://www.gob.pe/institucion/produce/colecciones/1918-vedas',
    ocean:'https://siofen.imarpe.gob.pe/boletines-e-informes/BDO'};
  function fishingStatus(day){
    const stale=day<fishing.reviewed||day>fishing.reviewBy,md=day.slice(5);
    return {stale,perico:!stale&&day>='2026-09-01'&&day<='2027-04-30',chanque:!stale&&((md>='04-01'&&md<='06-30')||(md>='10-01'&&md<='12-31'))};
  }
  globalThis.MisturaHome={daily,command,fishing,fishingStatus};
})();
