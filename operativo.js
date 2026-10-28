(() => {
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let key=sessionStorage.getItem('mf_operator_key')||'',data=null,screen='Inicio',busy=false,editor=null,pending=null;
  const product=id=>data.products.find(p=>p.id===id)?.name||'Plato';
  const dishes=lines=>lines.map(l=>l.quantity+' × '+esc(l.name||product(l.productKey))).join('<br>');
  const local=v=>{const d=new Date(v);return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)+'T'+new Intl.DateTimeFormat('en-GB',{timeZone:'America/Lima',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d)};
  const time=v=>new Date(v).toLocaleString('es-PE',{timeZone:'America/Lima'});
  const input=(label,name,value='',type='text',required=true)=>`<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''} maxlength="300"></label>`;
  const select=(label,name,values,selected='')=>`<label>${esc(label)}<select name="${name}" required>${values.map(([id,label])=>`<option value="${esc(id)}" ${id===selected?'selected':''}>${esc(label)}</option>`).join('')}</select></label>`;
  const controls=(entity,row)=>`<div class="actions"><button class="ghost" data-edit="${entity}" data-id="${esc(row.id)}">Editar</button><button class="ghost" data-delete="${entity}" data-id="${esc(row.id)}">Eliminar</button></div>`;
  const card=html=>`<article class="kitchen-ticket">${html}</article>`;
  function notice(t){$('op-message').textContent=t;$('op-message').hidden=!t}
  async function request(payload){const r=await fetch('/api/operational',{method:payload?'POST':'GET',headers:{'x-operativo':key,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{})});const d=await r.json().catch(()=>({}));if(!r.ok){if(r.status===401)logout();throw Object.assign(Error(d.error||'No se pudo confirmar la operación.'),{status:r.status})}return d}
  function logout(){key='';data=null;sessionStorage.removeItem('mf_operator_key');$('op-screen').hidden=true;$('op-login').hidden=false;$('op-logout').hidden=true;$('op-content').innerHTML='';if($('op-dialog').open)$('op-dialog').close()}
  async function load(){if(!key||busy||$('op-dialog').open)return;busy=true;try{data=await request();sessionStorage.setItem('mf_operator_key',key);$('op-screen').hidden=false;$('op-login').hidden=true;$('op-logout').hidden=false;notice('');draw()}catch(e){notice(e.message)}finally{busy=false}}
  async function write(payload){if(busy)return;busy=true;try{data=await request(payload);if($('op-dialog').open)$('op-dialog').close();pending=null;notice('Guardado.');draw()}catch(e){const target=$('op-dialog').open?$('op-dialog-error'):null;if(target){target.textContent=e.message;target.hidden=false}else notice(e.message);if(e.status)pending=null}finally{busy=false}}
  function draw(){
    if(!data)return;const date=data.date;
    let html=`<p class="eyebrow">PERFIL OPERATIVO · ILO</p><h1 style="font-size:34px">${esc(screen)}</h1>`;
    if(screen==='Inicio'){
      const reservations=data.reservations.filter(r=>local(r.plannedAt).slice(0,10)===date).filter(r=>r.status==='Pendiente'),open=data.tickets.filter(t=>!['Entregada','Cancelada'].includes(t.status));
      html+=`<div class="menu-grid">${card('<h2>'+open.length+'</h2><p>Pedidos en cocina</p>')}${card('<h2>'+reservations.length+'</h2><p>Reservaciones pendientes de hoy</p>')}</div><h2>Reservas de hoy</h2>${reservations.map(r=>card(`<h3>${esc(r.name)}</h3><p>${esc(time(r.plannedAt))} · ${r.guests} personas</p><p>${dishes(r.lines)}</p>`)).join('')||'<p>Sin reservaciones pendientes hoy.</p>'}`;
    }
    if(screen==='Cocina / comandas'){
      html+='<button class="primary" data-new="kitchenTicket">Nueva comanda</button><p class="muted">Pedidos de hoy. Cocina y cobro avanzan por separado. Los pagos en línea deben estar confirmados para aceptar.</p><div class="kitchen-board">'+['Por aceptar','Pendiente','En preparación','Lista','Entregada','Cancelada'].map(status=>`<section class="kitchen-column"><h2>${status}</h2>${data.tickets.filter(t=>t.status===status).map(t=>{const next={'Por aceptar':['Pendiente','Aceptar'],Pendiente:['En preparación','Preparar'],'En preparación':['Lista','Listo'],Lista:['Entregada','Entregado']}[status],canPrepare=!t.method||t.method==='Efectivo'||t.payment==='paid';return card(`<h3>${esc(t.table)}</h3><p>${dishes(t.lines)}</p>${t.note?'<p class="note">'+esc(t.note)+'</p>':''}${t.method?'<p>'+esc(t.method)+' · '+(t.payment==='paid'?'Pago confirmado':'Pago pendiente')+(t.total!=null?' · S/ '+t.total.toFixed(2):'')+'</p>':''}${next?`<button class="primary" data-kitchen="${esc(t.id)}" data-status="${next[0]}" ${canPrepare?'':'disabled'}>${next[1]}</button>`:''}${!t.webNumber?controls('kitchenTicket',t):''}${t.method==='Efectivo'&&t.payment!=='paid'&&status!=='Cancelada'?`<button class="ghost" data-cash="${esc(t.orderId)}">Confirmar efectivo recibido</button>`:''}`)}).join('')||'<p class="muted">Sin pedidos.</p>'}</section>`).join('')+'</div>';
    }
    if(screen==='Reservaciones')html+=`<button class="primary" data-new="reservation">Agregar reservación</button>${data.reservations.map(r=>card(`<h3>${esc(r.name)} · ${esc(r.status)}</h3><p>${esc(time(r.plannedAt))} · ${r.guests} personas</p><p>${esc(r.phone||'')}</p><p>${dishes(r.lines)}</p><p>${esc(r.note||'')}</p>${controls('reservation',r)}`)).join('')||'<p>Sin reservaciones.</p>'}`;
    if(screen==='Producción')html+=`<button class="primary" data-new="productionPlan">Crear plan de preparación</button><p class="muted">Planifica cantidades por plato. No se exige una ficha técnica ni se descuentan insumos al guardar.</p>${data.plans.map(p=>card(`<h3>${esc(p.date)} · ${esc(p.status)}</h3><p>${dishes(p.lines)}</p><p>${esc(p.note||'')}</p>${controls('productionPlan',p)}`)).join('')||'<p>Sin planes.</p>'}`;
    if(screen==='Clientes / fidelización')html+=`<button class="primary" data-new="customer">Agregar cliente</button><p class="muted">${data.program?'Beneficio configurado: '+esc(data.program.reward)+' cada '+data.program.target+' compras o visitas.':'Administración todavía no configuró un programa de fidelización.'}</p>${data.customers.map(c=>card(`<h3>${esc(c.name)}</h3><p>${esc(c.phone||'')} · ${esc(c.note||'')}</p><p>${c.earned} compras / visitas · ${c.remaining} disponibles para beneficios</p>${controls('customer',c)}<div class="actions">${!c.linked?`<button class="ghost" data-visit="${esc(c.id)}">Registrar visita</button>`:''}<button class="ghost" data-reward="${esc(c.id)}" ${c.available?'':'disabled'}>Registrar beneficio entregado</button></div>${c.visits.length?'<h4>Visitas registradas</h4>'+c.visits.map(r=>'<p>'+esc(r.date)+' · '+esc(r.note||'')+'</p>'+controls('customerVisit',r)).join(''):''}${c.rewards.length?'<h4>Beneficios entregados</h4>'+c.rewards.map(r=>'<p>'+esc(r.date)+' · '+esc(r.reward)+'</p>'+controls('loyaltyReward',r)).join(''):''}`)).join('')||'<p>Sin clientes.</p>'}`;
    $('op-content').innerHTML=html;
  }
  function lineMarkup(line={}){return `<fieldset class="op-dish-line">${select('Plato','productKey',data.products.map(p=>[p.id,p.name]),line.productKey)}${input('Cantidad de platos','quantity',line.quantity||1,'number')}<button type="button" class="ghost" data-remove-line>Quitar plato</button></fieldset>`}
  function open(type,row=null,extra={}){
    editor={type,row,...extra};const p=row||{};let fields='';
    $('op-dialog-title').textContent=type==='delete'?'Eliminar registro':type==='cash'?'Confirmar cobro':(row?'Editar ':'Agregar ')+({reservation:'reservación',productionPlan:'plan de preparación',kitchenTicket:'comanda',customer:'cliente',customerVisit:'visita',loyaltyReward:'beneficio entregado'}[type]||'registro');
    if(type==='delete')fields='<p>Se quitará de las listas este registro y se conservará para que administración pueda recuperarlo.</p><label><input type="checkbox" name="confirmed" required> Confirmo eliminarlo</label>';
    else if(type==='cash')fields='<p>Confirma que ya recibiste el efectivo de este pedido.</p><label><input type="checkbox" name="confirmed" required> Sí, recibí el efectivo</label>';
    else if(type==='customer')fields=input('Nombre','name',p.name)+input('Celular (opcional)','phone',p.phone,'tel',false)+input('Preferencias (opcional)','note',p.note,'text',false);
    else if(['customerVisit','loyaltyReward'].includes(type))fields=`<p>${type==='loyaltyReward'?'Confirma que el cliente recibió el beneficio. Aplica cualquier descuento correspondiente por separado en caja.':'Registra una visita del cliente.'}</p>`+select('Cliente','customerId',data.customers.map(c=>[c.id,c.name]),extra.customerId||p.customerId)+input('Fecha','date',p.date||dateValue(),'date')+input('Notas (opcional)','note',p.note||'','text',false);
    else{
      if(type==='reservation')fields=input('Nombre de la reservación','name',p.name)+input('Celular (opcional)','phone',p.phone,'tel',false)+input('Personas','guests',p.guests||1,'number')+input('Fecha y hora','plannedAt',p.plannedAt?local(p.plannedAt):dateValue()+'T13:00','datetime-local')+select('Estado','status',['Pendiente','Atendida','Cancelada'].map(s=>[s,s]),p.status||'Pendiente');
      else if(type==='kitchenTicket')fields=input('Mesa / pedido','table',p.table)+input('Fecha','date',p.date||dateValue(),'date')+select('Estado','status',['Pendiente','En preparación','Lista','Entregada','Cancelada'].map(s=>[s,s]),p.status||'Pendiente');
      else fields=input('Fecha','date',p.date||dateValue(),'date')+select('Estado','status',['Planificada','En preparación','Lista','Cancelada'].map(s=>[s,s]),p.status||'Planificada');
      const lines=p.lines||(type==='productionPlan'?Object.entries(data.demand).map(([productKey,quantity])=>({productKey,quantity})):[]);
      fields+=input('Notas (opcional)','note',p.note,'text',false)+`<div id="op-dish-lines">${(lines.length?lines:[{}]).map(lineMarkup).join('')}</div><button class="ghost" type="button" id="op-add-line">Agregar plato</button>`;
    }
    $('op-dialog-fields').innerHTML=fields;$('op-dialog-error').hidden=true;$('op-dialog').showModal();
  }
  const dateValue=()=>data.date;
  $('op-login-form').onsubmit=async e=>{e.preventDefault();key=e.currentTarget.elements.key.value.trim();e.currentTarget.elements.key.value='';await load()};$('op-logout').onclick=logout;$('op-refresh').onclick=load;
  $('op-nav').onclick=e=>{const b=e.target.closest('[data-view]');if(b){screen=b.dataset.view;draw()}};
  $('op-content').onclick=e=>{
    const b=e.target.closest('button');if(!b||busy)return;
    if(b.dataset.new)open(b.dataset.new);
    const entity=b.dataset.edit||b.dataset.delete;if(entity){const rows=entity==='reservation'?data.reservations:entity==='productionPlan'?data.plans:entity==='kitchenTicket'?data.tickets:entity==='customerVisit'?data.customers.flatMap(c=>c.visits):entity==='loyaltyReward'?data.customers.flatMap(c=>c.rewards):data.customers,row=rows.find(r=>r.id===b.dataset.id);if(row)open(b.dataset.delete?'delete':entity,row,{entity})}
    if(b.dataset.visit)open('customerVisit',null,{customerId:b.dataset.visit});if(b.dataset.reward)open('loyaltyReward',null,{customerId:b.dataset.reward});
    if(b.dataset.cash)open('cash',null,{orderId:b.dataset.cash});
    if(b.dataset.kitchen){const t=data.tickets.find(t=>t.id===b.dataset.kitchen);write({action:'kitchen',id:t.id,version:t.version,status:b.dataset.status})}
  };
  $('op-dialog-fields').onclick=e=>{if(e.target.id==='op-add-line')$('op-dish-lines').insertAdjacentHTML('beforeend',lineMarkup());if(e.target.hasAttribute('data-remove-line')&&$('op-dish-lines').children.length>1)e.target.closest('fieldset').remove()};
  $('op-dialog-close').onclick=()=>$('op-dialog').close();
  $('op-edit-form').onsubmit=e=>{e.preventDefault();const payload=Object.fromEntries(new FormData(e.currentTarget));
    if(editor.type==='cash')return write({action:'cash-paid',id:editor.orderId,received:true});
    const type=editor.type==='delete'?'delete':editor.type;
    if(editor.row)payload.id=editor.row.id;
    if(editor.type==='delete'){payload.entity={reservation:'reservations',productionPlan:'productionPlans',kitchenTicket:'kitchenTickets',customer:'customers',customerVisit:'customerVisits',loyaltyReward:'loyaltyRewards'}[editor.entity];payload.targetId=editor.row.id;delete payload.id;delete payload.confirmed}
    if(['reservation','productionPlan','kitchenTicket'].includes(type))payload.lines=[...$('op-dish-lines').children].map(row=>({productKey:row.querySelector('[name=productKey]').value,quantity:row.querySelector('[name=quantity]').value}));
    const serialized=JSON.stringify({type,payload,version:editor.row?.version});if(!pending||pending.serialized!==serialized)pending={serialized,id:crypto.randomUUID()};
    write({type,payload,version:editor.row?.version,commandId:pending.id});
  };
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load()});setInterval(()=>{if(key&&!document.hidden&&!$('op-dialog').open)load()},10000);if(key)load();
})();
