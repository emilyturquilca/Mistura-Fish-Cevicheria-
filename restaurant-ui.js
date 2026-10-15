const Restaurant=globalThis.MisturaRestaurant;
let inventorySearch='',inventoryCategory='',reservationDay='',ingredientReturn=null,undoRecordId='';
const ingredientCategories=['Pescados y mariscos','Carnes y aves','Verduras y frutas','Abarrotes','Lácteos y huevos','Bebidas','Envases y otros','Sin categoría'];
function restaurantEditorChange(field,value){opCapture();opDrafts.editor[field]=value;if(field==='refundId')opDrafts.editor.productKey='';render()}
function restaurantOpenNew(entity){
  if(OPS.busy||!OPS.configured)return;
  opCapture();document.querySelector('form[data-op="editor"]')?.remove();
  opEditor={mode:'create',entity,id:null,version:OPS.version,record:{},linesCount:1};
  opDrafts.editor=entity==='ingredients'?{name:'',unit:'kg',stock:0,unitCost:'',category:'',supplierId:''}:entity==='reservations'?{name:'',phone:'',guests:1,plannedAt:Core.shiftDay(Core.dateKey(),1)+'T12:00',status:'Pendiente',note:''}:{date:Core.dateKey(),quantity:1,note:''};
  opNotice='';render();
}
function restaurantQuickIngredient(){
  opCapture();ingredientReturn={editor:opEditor?structuredClone(opEditor):null,draft:opEditor?structuredClone(opDrafts.editor):null};restaurantOpenNew('ingredients');
}
function restaurantEditorFields(e){
  if(e.entity==='ingredients'){
    const draft=opDrafts.editor;
    if(e.mode==='edit'&&draft.stock==null){draft.stock=OpsCore.stock(OPS.state,e.id);draft.unitCost=e.record.cost??'';draft.category=e.record.category||'Sin categoría';draft.supplierId=e.record.supplierId||''}
    const categories=[...new Set([...ingredientCategories,...OPS.state.ingredients.map(i=>i.category).filter(Boolean)])];
    return `<div class="op-fields">${opInput('Nombre del insumo','name')}<label>Categoría<select name="category" aria-label="Categoría" required onchange="restaurantEditorChange('category',this.value)"><option value="">Elegir categoría</option>${categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}<option value="__new__">Agregar otra categoría…</option></select></label>${draft.category==='__new__'?opInput('Nueva categoría','newCategoryName'):''}<label>Proveedor<select name="supplierId" aria-label="Proveedor" onchange="restaurantEditorChange('supplierId',this.value)"><option value="">Sin asignar</option>${opOptions(OPS.state.suppliers)}<option value="__new__">Agregar proveedor…</option></select></label>${draft.supplierId==='__new__'?opInput('Nombre del nuevo proveedor','newSupplierName'):''}<label>Unidad de medida<select name="unit" aria-label="Unidad de medida"><option value="kg">kg · kilogramos</option><option value="l">l · litros</option><option value="un">un · unidades</option></select></label>${opNumber('Stock','stock',0,true)}${opNumber('Costo por unidad (S/)','unitCost','',true)}</div><p class="k">Ejemplo: unidad kg y stock 5 significa que tienes 5 kg. El costo corresponde a 1 kg, 1 litro o 1 unidad, según lo que elijas.</p>`;
  }
  if(e.entity==='reservations')return `<div class="op-fields">${opInput('Nombre de la reservación','name')}${opInput('Teléfono (opcional)','phone','tel','',false)}${opNumber('Personas','guests',1)}${opInput('Fecha y hora','plannedAt','datetime-local')}<label>Estado<select name="status" aria-label="Estado"><option>Pendiente</option><option>Atendida</option><option>Cancelada</option></select></label>${opInput('Notas (opcional)','note','text','',false)}</div><h2>Platos pedidos</h2>${Array.from({length:e.linesCount},(_,i)=>`<div class="op-fields"><label>Plato<select name="line_${i}_productKey" aria-label="Plato" required><option value="">Elegir plato</option>${Object.entries(OPS.state.sales.prods).map(([key,p])=>`<option value="${esc(key)}">${esc(p.n)}</option>`).join('')}</select></label>${opNumber('Cantidad de platos',`line_${i}_quantity`)}</div>`).join('')}<div class="bar"><button type="button" class="pill" onclick="opEditRows(1)">Agregar plato</button><button type="button" class="pill" onclick="opEditRows(-1)" ${e.linesCount===1?'disabled':''}>Quitar último</button></div>`;
  if(e.entity==='preparedWastes'){
    const refunds=Object.values(OPS.state.sales.v).filter(r=>r.type==='REFUND'&&OPS.state.saleUsage?.[r.refundFor]?.products.length);
    const refund=refunds.find(r=>r.id===opDrafts.editor.refundId),products=refund?.items.filter(i=>OPS.state.saleUsage[refund.refundFor].products.some(p=>p.productKey===i.k))||[];
    return `<p class="notice">Los ingredientes ya se descontaron al vender el plato. Esta pérdida queda registrada sin volver a restar stock.</p>${!refunds.length?'<p>No hay devoluciones con un consumo automático previo.</p>':''}<div class="op-fields"><label>Recibo de devolución<select name="refundId" aria-label="Recibo de devolución" required onchange="restaurantEditorChange('refundId',this.value)"><option value="">Elegir devolución</option>${refunds.map(r=>`<option value="${esc(r.id)}">#${esc(r.id)} · ${esc(horaLima(new Date(r.f)))}</option>`).join('')}</select></label><label>Plato devuelto<select name="productKey" aria-label="Plato devuelto" required><option value="">Elegir plato</option>${[...new Set(products.map(p=>p.k))].map(k=>`<option value="${esc(k)}">${esc(OPS.state.sales.prods[k]?.n||k)}</option>`).join('')}</select></label>${opNumber('Platos descartados','quantity')}${opDate()}${opInput('Motivo','note')}</div>`;
  }
  return null;
}
function restaurantUndoMarkup(){return undoRecordId&&(OPS.state?.trash||[]).some(t=>t.id===undoRecordId)?` <button class="pill" onclick="opCommit('restore',{trashId:undoRecordId})">Deshacer</button>`:''}
const originalAfterCommit=opAfterCommit;
opAfterCommit=function(type,payload){
  const parent=ingredientReturn;originalAfterCommit(type,payload);
  undoRecordId=type==='delete'?OPS.state.trash?.at(-1)?.id||'':'';
  if(type==='delete')opNotice='Registro eliminado.';
  if(type==='reservation')reservationDay=Core.dateKey(payload.plannedAt);
  if(type==='ingredient'&&parent){
    ingredientReturn=null;const ingredient=OPS.state.ingredients.find(i=>i.name===payload.name);
    if(parent.editor){const latest=OPS.state[parent.editor.entity]?.find(r=>r.id===parent.editor.id);opEditor={...parent.editor,version:JSON.stringify(latest)===JSON.stringify(parent.editor.record)?OPS.version:parent.editor.version};opDrafts.editor=parent.draft}
    const draft=parent.editor?opDrafts.editor:opDrafts.recipe,count=parent.editor?parent.editor.linesCount:opLineCounts.recipe;
    if(draft&&ingredient){
      let index=Array.from({length:count},(_,i)=>i).find(i=>!draft[`line_${i}_ingredientId`]);
      if(index==null&&count<100){index=count;if(parent.editor)opEditor.linesCount++;else opLineCounts.recipe++}
      if(index!=null){draft[`line_${index}_ingredientId`]=ingredient.id;draft[`line_${index}_unit`]=ingredient.unit;draft[`line_${index}_yield`]??=100}
    }
  }
};
const originalCloseEditor=opCloseEditor;
opCloseEditor=function(){
  if(OPS.busy)return;
  const parent=ingredientReturn;
  if(parent&&opEditor?.entity==='ingredients'){
    ingredientReturn=null;document.querySelector('form[data-op="editor"]')?.remove();
    if(parent.editor){opEditor=parent.editor;opDrafts.editor=parent.draft;opNotice='';return render()}
  }
  originalCloseEditor();
};
const originalOpenEditor=opOpenEditor;
opOpenEditor=function(entity,id){
  originalOpenEditor(entity,id);
  if(entity==='reservations'&&opEditor?.id===id){document.querySelector('form[data-op="editor"]')?.remove();opDrafts.editor.plannedAt=Core.dateKey(opEditor.record.plannedAt)+'T'+new Intl.DateTimeFormat('en-GB',{timeZone:Core.TIME_ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(opEditor.record.plannedAt));opEditor.record.lines.forEach((l,i)=>Object.assign(opDrafts.editor,{[`line_${i}_productKey`]:l.productKey,[`line_${i}_quantity`]:l.quantity}));render()}
};
function hourlyExport(){
  const rows=[['Hora','Ventas','Devoluciones','Ventas brutas S/','Descuentos netos S/','Devoluciones S/','Ventas netas S/','Cobrado neto S/'],...Core.hourly(sel(P.k)).map(h=>[h.label,h.sales,h.returns,h.gross,h.discounts,h.refunds,h.net,h.paid])];
  const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=[14,12,16,24,24,22,22,22].map(wch=>({wch}));
  rows.slice(1).forEach((row,i)=>row.forEach((v,c)=>{if(c>=3)sheet[XLSX.utils.encode_cell({r:i+1,c})].z='#,##0.00'}));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,sheet,'Por hora');XLSX.writeFile(wb,nombreReporte('xlsx').replace('ventas-','ventas-por-hora-'));
}
const RestaurantViews={
  Inventario(){return opShell('Inventario','Tus insumos, el stock disponible y su costo por unidad.',()=>{
    const s=OPS.state,categories=[...new Set(s.ingredients.map(i=>i.category||'Sin categoría'))].sort(),rows=s.ingredients.filter(i=>(!inventoryCategory||(i.category||'Sin categoría')===inventoryCategory)&&(i.name+' '+(i.category||'')).toLocaleLowerCase().includes(inventorySearch.toLocaleLowerCase()));
    const pending=[...new Set((s.autoStock?.pending||[]).map(p=>p.productKey))];
    return `<div class="bar"><button class="btn" onclick="restaurantOpenNew('ingredients')">Agregar insumo</button><input aria-label="Buscar insumo" placeholder="Buscar insumo" value="${esc(inventorySearch)}" oninput="inventorySearch=this.value;render(true)"><select aria-label="Filtrar categoría" onchange="inventoryCategory=this.value;render()"><option value="">Todas las categorías</option>${categories.map(c=>`<option value="${esc(c)}" ${c===inventoryCategory?'selected':''}>${esc(c)}</option>`).join('')}</select></div><div class="card">${opTable(['Insumo','Categoría','Proveedor','Unidad','Stock','Costo por unidad','Acciones'],rows.map(i=>[`<strong>${esc(i.name)}</strong>`,esc(i.category||'Sin categoría'),esc(s.suppliers.find(p=>p.id===i.supplierId)?.name||'Sin asignar'),esc(i.unit),`<strong class="${OpsCore.stock(s,i.id)<0?'dn':''}">${opQuantity(OpsCore.stock(s,i.id))}</strong>`,i.cost==null?'Sin registrar':S(i.cost),opRecordActions('ingredients',i.id)]),'No hay insumos con estos filtros. Usa Agregar insumo para registrar el primero.')}</div><p class="k">El stock se descuenta con las ventas de Loyverse que tienen receta configurada. Puedes corregir la cantidad física con Editar. ${s.ingredients.some(i=>OpsCore.stock(s,i.id)<0)?'Hay stock negativo: revisa las cantidades registradas.':''}</p>${pending.length?`<p class="k">${pending.length} productos vendidos aún no tienen receta. <button class="pill" onclick="view='Escandallos';render()">Completar recetas</button></p>`:''}`;
  })},
  Reservaciones(){return opShell('Reservaciones','Registra los platos pedidos para saber qué preparar y qué comprar.',()=>{
    const s=OPS.state,day=reservationDay||Core.dateKey(),plan=Restaurant.plan(s,day);
    return `<div class="bar"><button class="btn" onclick="restaurantOpenNew('reservations')">Agregar reservación</button><label>Fecha del plan <input type="date" aria-label="Fecha del plan" value="${day}" onchange="reservationDay=this.value;render()"></label></div><div class="card"><h2>Qué preparar · ${fechaCompleta(Core.dayStart(day))}</h2>${plan.missing.length?`<p class="notice">Faltan recetas de ${plan.missing.map(k=>esc(s.sales.prods[k]?.n||k)).join(', ')}. La lista de ingredientes está incompleta hasta registrarlas.</p>`:''}${opTable(['Plato','Cantidad pedida','Capacidad con tu stock'],Object.entries(plan.dishes).map(([key,quantity])=>{const recipe=s.recipes.find(r=>r.productKey===key);return[esc(s.sales.prods[key]?.n||key),quantity,recipe?Restaurant.capacity(s,recipe)+' platos':`<button class="pill" data-key="${esc(key)}" onclick="view='Escandallos';opSelectRecipe(this.dataset.key)">Registrar receta</button>`]}),'No hay reservaciones pendientes para esta fecha.')}<p class="k">La capacidad de cada plato es individual; la lista de compras suma todos los pedidos. Las reservaciones no descuentan stock: el consumo se registra al vender en Loyverse.</p></div><div class="card"><h2>Ingredientes y compras necesarias</h2>${opTable(['Insumo','Necesitas','Stock','Comprar','Proveedor'],plan.ingredients.map(n=>{const i=s.ingredients.find(i=>i.id===n.id);return[esc(i.name),opQuantity(n.quantity)+' '+i.unit,opQuantity(n.stock)+' '+i.unit,`<strong>${opQuantity(n.buy)} ${i.unit}</strong>`,esc(s.suppliers.find(p=>p.id===i.supplierId)?.name||'Sin asignar')]}),'No hay ingredientes calculados para esta fecha.')}</div><div class="card"><h2>Reservaciones registradas</h2>${opTable(['Fecha y hora','Cliente','Personas','Pedido','Estado','Acciones'],[...(s.reservations||[])].sort((a,b)=>new Date(a.plannedAt)-new Date(b.plannedAt)).map(r=>[esc(horaLima(new Date(r.plannedAt))),esc(r.name),r.guests,r.lines.map(l=>`${l.quantity} × ${esc(s.sales.prods[l.productKey]?.n||l.productKey)}`).join('<br>'),esc(r.status),opRecordActions('reservations',r.id)]))}</div>`;
  })},
  'Ventas por hora'(){const receipts=sel(P.k),hours=Core.hourly(receipts),field=P.metric==='paid'?'paid':'net';deferCharts(()=>chart('hourly-sales','bar',hours.map(h=>h.label),hours.map(h=>h[field]),P.metric==='paid'?'Cobrado neto S/':'Ventas netas S/'));
    return `<h1>Ventas por hora</h1><p class="sub">Conoce en qué horas vendes más. El reporte usa la hora local del recibo.</p>${period()}<div class="bar"><button class="btn" onclick="hourlyExport()">Exportar por hora (.xlsx)</button></div>${resumen(receipts)}<div class="card"><canvas id="hourly-sales"></canvas></div><div class="card">${opTable(['Hora','Ventas','Devoluciones','Ventas brutas','Descuentos netos','Devoluciones S/','Ventas netas','Cobrado neto'],hours.map(h=>[h.label+'–'+String((h.hour+1)%24).padStart(2,'0')+':00',h.sales,h.returns,S(h.gross),S(h.discounts),S(h.refunds),S(h.net),S(h.paid)]))}</div><p class="k">Si eliges varios días, se suman las ventas de cada franja horaria. Las devoluciones se muestran en la hora en que se registraron.</p>`;
  }
};
const ingredientWasteView=OperationsViews.Mermas;
RestaurantViews.Mermas=function(){
  const base=ingredientWasteView();if(!OPS.configured||!OPS.state)return base;
  return base+`<div class="card"><h2>Platos devueltos descartados</h2><p><strong>Costo conocido de la pérdida: ${S(sum((OPS.state.preparedWastes||[]).map(w=>w.quantity*(w.unitCost||0))))}</strong>${(OPS.state.preparedWastes||[]).some(w=>w.unitCost==null)?' · Hay platos sin costo completo':''}</p><p class="k">Registra la pérdida de un plato cuyos ingredientes ya se descontaron al venderlo. No vuelve a reducir el stock.</p><div class="bar"><button class="pill" onclick="restaurantOpenNew('preparedWastes')">Registrar plato devuelto</button></div>${opTable(['Fecha','Plato','Devolución','Cantidad','Costo de la pérdida','Motivo','Acciones'],[...(OPS.state.preparedWastes||[])].reverse().map(w=>[esc(w.date),esc(OPS.state.sales.prods[w.productKey]?.n||w.productKey),'#'+esc(w.refundId),opQuantity(w.quantity),w.unitCost==null?'Sin costo':S(w.quantity*w.unitCost),esc(w.note),opRecordActions('preparedWastes',w.id)]))}</div>`;
};
