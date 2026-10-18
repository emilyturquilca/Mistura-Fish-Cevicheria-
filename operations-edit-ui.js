// Editors and recoverable deletion for the first-version business records.
let opEditor = null;
const opEntityNames = { suppliers:'Proveedor', ingredients:'Insumo', orders:'Compra', receptions:'Recepción', movements:'Movimiento', recipes:'Receta',reservations:'Reservación',preparedWastes:'Merma de plato',supplierPayments:'Abono',supplierDebts:'Deuda anterior',payableTerms:'Condiciones de la cuenta',supplierCategories:'Categoría de proveedor',supplierEvaluation:'Evaluación de entrega' };
function opRecordActions(entity, id) {
  return `<span class="op-actions"><button class="pill" data-id="${esc(id)}" onclick="opOpenEditor('${entity}',this.dataset.id)" ${OPS.busy?'disabled':''}>Editar</button><button class="pill op-delete" data-id="${esc(id)}" onclick="opDeleteRecord('${entity}',this.dataset.id)" ${OPS.busy?'disabled':''}>Eliminar</button></span>`;
}
function opCloseEditor() {
  if(OPS.busy)return;
  document.querySelector('form[data-op="editor"]')?.remove(); opEditor=null; delete opDrafts.editor; opNotice=''; render();
}
function opOpenEditor(entity,id) {
  if(OPS.busy || !OPS.state)return;
  const prepared = structuredClone(OPS.state); globalThis.MisturaEdits.prepare(prepared);
  let record = prepared[entity]?.find(r=>r.id===id);
  if(!record){opEditor=null;opNotice='El registro ya no está disponible. Actualiza los datos.';return render()}
  if(entity==='movements' && record.kind==='Recepción')return opOpenEditor('receptions',record.receptionId);
  opCapture(); document.querySelector('form[data-op="editor"]')?.remove();
  opEditor={ mode:'edit',entity,id,version:OPS.version,record,linesCount:record.lines?.length||1 };
  const draft={...record};
  if(entity==='orders') record.lines.forEach((l,i)=>Object.assign(draft,{[`line_${i}_id`]:l.id,[`line_${i}_ingredientId`]:l.ingredientId,[`line_${i}_quantity`]:l.quantity,[`line_${i}_unit`]:prepared.ingredients.find(x=>x.id===l.ingredientId).unit,[`line_${i}_unitCost`]:l.unitCost}));
  if(entity==='receptions') record.lines.forEach((l,i)=>Object.assign(draft,{[`line_${i}_lineId`]:l.lineId,[`line_${i}_quantity`]:l.quantity,[`line_${i}_unitCost`]:l.unitCost,[`line_${i}_lot`]:l.lot||'',[`line_${i}_expiry`]:l.expiry||''}));
  if(entity==='recipes') record.lines.forEach((l,i)=>Object.assign(draft,{[`line_${i}_ingredientId`]:l.ingredientId,[`line_${i}_quantity`]:l.quantity,[`line_${i}_unit`]:prepared.ingredients.find(x=>x.id===l.ingredientId).unit,[`line_${i}_yield`]:l.yield*100}));
  if(entity==='movements')Object.assign(draft,{quantity:record.kind==='Conteo'?record.countedQuantity:Math.abs(record.quantity),unit:prepared.ingredients.find(i=>i.id===record.ingredientId).unit,unitCost:record.inputCost??record.unitCost??0});
  opDrafts.editor=draft; opNotice=''; render();
}
function opImpact(before,after) {
  const rows=before.ingredients.flatMap(i=>{
    const next=after.ingredients.find(a=>a.id===i.id),a=OpsCore.stock(before,i.id),b=OpsCore.stock(after,i.id);
    return next&&a===b && i.cost===next.cost?[]:[[esc(i.name),opQuantity(a)+' '+i.unit,next?opQuantity(b)+' '+next.unit:'Insumo eliminado',i.cost==null?'Sin costo':S(i.cost),next?.cost==null?'—':S(next.cost)]];
  });
  let financial='';
  if(globalThis.MisturaPayables){const effects=[];for(const id of new Set([...before.suppliers,...after.suppliers].map(s=>s.id))){const a=globalThis.MisturaPayables.summary(before,id),b=globalThis.MisturaPayables.summary(after,id),name=esc(before.suppliers.find(s=>s.id===id)?.name||after.suppliers.find(s=>s.id===id)?.name);if(a.pending!==b.pending||a.paid!==b.paid||a.unconfirmed!==b.unconfirmed)effects.push([name+' · Saldo pendiente',S(a.pending),S(b.pending)],[name+' · Abonos registrados',S(a.paid),S(b.paid)])}if(effects.length)financial=opTable(['Proveedor / cuenta','Antes','Después'],effects)}
  return opTable(['Insumo','Stock antes','Stock después','Costo por unidad antes','Costo por unidad después'],rows,'Este cambio no modifica el stock ni los costos.')+financial;
}
function opDeleteRecord(entity,id) {
  if(OPS.busy)return;
  opCapture();document.querySelector('form[data-op="editor"]')?.remove();delete opDrafts.editor;
  opEditor={mode:'delete',entity,id,version:OPS.version};opNotice='';
  try{
    const result=OpsCore.apply(OPS.state,{id:crypto.randomUUID(),type:'delete',payload:{entity,targetId:id}}).state;
    opEditor.removal=result.trash.at(-1);opEditor.impact=opImpact(OPS.state,result);
  }catch(e){opEditor.error=e.message}
  render();
}
function opRestoreRecord(id) {
  if(OPS.busy)return;
  opCapture();document.querySelector('form[data-op="editor"]')?.remove();delete opDrafts.editor;
  const entry=OPS.state.trash?.find(t=>t.id===id);if(!entry){opEditor=null;opNotice='Ese registro ya no está en Papelera. Actualiza los datos.';return render()}
  opEditor={mode:'restore',id,entity:entry.entity,entry,version:OPS.version};opNotice='';
  try{const result=OpsCore.apply(OPS.state,{id:crypto.randomUUID(),type:'restore',payload:{trashId:id}}).state;opEditor.impact=opImpact(OPS.state,result)}catch(e){opEditor.error=e.message}
  render();
}
async function opRefreshEditor() {
  const previous=opEditor;if(!previous)return;
  await opLoad();if(!OPS.configured)return;
  if(previous.entity==='supplierEvaluation')supplierEvaluate(previous.id);
  else if(previous.entity==='payableTerms')payableEditTerms(previous.id);
  else if(previous.mode==='edit')opOpenEditor(previous.entity,previous.id);
  else if(previous.mode==='create'){opEditor.version=OPS.version;render()}
  else if(previous.mode==='delete')opDeleteRecord(previous.entity,previous.id);
  else opRestoreRecord(previous.id);
}
function opEditRows(delta) {opCapture();opEditor.linesCount=Math.max(1,Math.min(100,opEditor.linesCount+delta));render()}
function opEditorOrderChanged(id) {
  opCapture();const order=OPS.state.orders.find(o=>o.id===id);if(!order)return;
  document.querySelector('form[data-op="editor"]')?.remove();
  const old=opDrafts.editor;opDrafts.editor={date:old.date,reference:old.reference,orderId:id};opEditor.linesCount=1;render();
}
function opEditorLines() {
  const e=opEditor,recipe=e.entity==='recipes',reception=e.entity==='receptions';
  const selectedOrder=OPS.state.orders.find(o=>o.id===(opDrafts.editor.orderId||e.record.orderId));
  return `${Array.from({length:e.linesCount},(_,i)=>`<fieldset><legend>Insumo ${i+1}</legend><div class="op-fields">${reception?`<label>Insumo de la compra<select name="line_${i}_lineId" aria-label="Insumo de la compra" required><option value="">Elegir línea</option>${(selectedOrder?.lines||[]).map(l=>`<option value="${esc(l.id)}">${esc(OPS.state.ingredients.find(x=>x.id===l.ingredientId)?.name)} · ${esc(OPS.state.ingredients.find(x=>x.id===l.ingredientId)?.unit)}</option>`).join('')}</select></label>`:opIngredients(`line_${i}_ingredientId`)}${opNumber(reception?'Cantidad recibida (unidad base)':recipe?'Cantidad neta en receta':'Cantidad a comprar',`line_${i}_quantity`)}${reception?'':opUnits(`line_${i}_unit`)}${opNumber(recipe?'Rendimiento %':'Costo S/ por unidad base',`line_${i}_${recipe?'yield':'unitCost'}`,recipe?100:'',!recipe)}${reception?opInput('Lote (opcional)',`line_${i}_lot`,'text','',false)+opInput('Vencimiento (opcional)',`line_${i}_expiry`,'date','',false):''}${e.entity==='orders'?`<input type="hidden" name="line_${i}_id">`:''}</div></fieldset>`).join('')}<div class="bar"><button type="button" class="pill" onclick="opEditRows(1)">Agregar insumo</button><button type="button" class="pill" onclick="opEditRows(-1)" ${e.linesCount===1?'disabled':''}>Quitar último</button></div>`;
}
function opEditorFields() {
  const e=opEditor,r=e.record;
  const payableFields=typeof payableEditorFields==='function'?payableEditorFields(e):null;if(payableFields!=null)return payableFields;
  const restaurantFields=typeof restaurantEditorFields==='function'?restaurantEditorFields(e):null;if(restaurantFields!=null)return restaurantFields;
  if(e.entity==='suppliers')return `<div class="op-fields">${opInput('Nombre del proveedor','name')}${opInput('RUC (opcional)','taxId','text','',false,'inputmode="numeric" pattern="[0-9]{11}"')}${opInput('Teléfono (opcional)','phone','tel','',false)}</div>`;
  if(e.entity==='ingredients')return `<div class="op-fields">${opInput('Nombre del insumo','name')}<label>Unidad base<select name="unit" aria-label="Unidad base"><option value="kg">kg</option><option value="l">l</option><option value="un">un</option></select></label>${opNumber('Stock mínimo','minimum',0,true)}</div><p class="k">La existencia y el costo se corrigen editando sus recepciones o conteos. Cambiar de kg a litros requiere que el insumo no tenga registros relacionados.</p>`;
  if(e.entity==='orders')return `<div class="op-fields"><label>Proveedor<select name="supplierId" aria-label="Proveedor" required>${opOptions(OPS.state.suppliers)}</select></label>${opDate()}${opInput('Referencia / pedido','reference','text','',false)}</div>${opEditorLines()}<button type="button" class="pill" onclick="restaurantQuickIngredient()">Crear insumo aquí</button>`;
  if(e.entity==='receptions')return `<div class="op-fields"><label>Compra<select name="orderId" aria-label="Compra" required onchange="opEditorOrderChanged(this.value)">${OPS.state.orders.filter(o=>o.status!=='Anulada').map(o=>`<option value="${esc(o.id)}">Compra ${o.number} · ${esc(OPS.state.suppliers.find(s=>s.id===o.supplierId)?.name)}</option>`).join('')}</select></label>${opDate()}${opInput('Comprobante / guía','reference','text','',false)}</div><p class="k">Editas la recepción completa, incluidos todos sus insumos y movimientos vinculados.</p>${opEditorLines()}${supplierRatingFields(opDrafts.editor)}`;
  if(e.entity==='recipes')return `<div class="op-fields"><label>Producto de Loyverse<select name="productKey" aria-label="Producto de Loyverse" required>${Object.entries(OPS.state.sales.prods).map(([key,p])=>`<option value="${esc(key)}">${esc(p.n)}</option>`).join('')}</select></label>${opNumber('Porciones que rinde la receta','portions')}</div>${opEditorLines()}<button type="button" class="pill" onclick="restaurantQuickIngredient()">Crear insumo aquí</button>`;
  if(e.entity==='movements')return `<div class="op-fields">${opIngredients()}${r.kind==='Conteo'?opNumber('Existencia contada (unidad base)','quantity','',true)+opNumber('Costo del ingreso por unidad base','unitCost','',true):`<label>Tipo de salida<select name="kind" aria-label="Tipo de salida"><option>Merma</option><option>Consumo</option></select></label>${opNumber('Cantidad de salida','quantity')}${opUnits('unit')}`}${opDate()}${opInput('Motivo','note')}</div>${r.kind==='Conteo'?'<p class="k">El conteo conserva el total físico indicado y recalcula su diferencia respecto a los movimientos anteriores.</p>':''}`;
  return '';
}
function opSubmitEditor(event) {
  event.preventDefault();if(OPS.busy || !opEditor)return;
  const e=opEditor,data=Object.fromEntries(new FormData(event.currentTarget));data.id=e.id;
  if(['orders','receptions','recipes'].includes(e.entity)){
    data.lines=[];
    const fields=e.entity==='receptions'?['lineId','quantity','unitCost','lot','expiry']:e.entity==='orders'?['id','ingredientId','quantity','unit','unitCost']:['ingredientId','quantity','unit','yield'];
    for(let i=0;i<e.linesCount;i++){const line={};for(const field of fields){line[field]=data[`line_${i}_${field}`];delete data[`line_${i}_${field}`]}data.lines.push(line)}
  }
  if(e.entity==='reservations'){
    data.lines=[];for(let i=0;i<e.linesCount;i++){data.lines.push({productKey:data[`line_${i}_productKey`],quantity:data[`line_${i}_quantity`]});delete data[`line_${i}_productKey`];delete data[`line_${i}_quantity`]}
  }
  const commands={suppliers:'supplier',ingredients:'ingredient',orders:'editOrder',receptions:'editReception',movements:'editMovement',recipes:'recipe',reservations:'reservation',preparedWastes:'preparedWaste',supplierPayments:'supplierPayment',supplierDebts:'supplierDebt',payableTerms:'payableTerms',supplierCategories:'supplierCategory',supplierEvaluation:'supplierEvaluation'};
  opCommit(commands[e.entity],data,'editor',e.version);
}
function opConfirmRemoval() {
  const e=opEditor;if(!e || e.error)return;
  if(e.mode==='delete')opCommit('delete',{entity:e.entity,targetId:e.id},null,e.version);
  else opCommit('restore',{trashId:e.id},null,e.version);
}
function opAfterCommit(type,payload) {
  if(opEditor){document.querySelector('form[data-op="editor"]')?.remove();opEditor=null;delete opDrafts.editor}
  if(type==='delete'){
    opNotice='Eliminado. Puedes recuperarlo desde Papelera.';
    if(payload.entity==='recipes'){opRecipe='';delete opDrafts.recipe}
    if(payload.entity==='orders'||payload.entity==='receptions')opOrder='';
    if(payload.entity==='suppliers'){opSupplier='';delete opDrafts.supplier}
  }else if(type==='restore')opNotice='Registro restaurado. Existencias y costos recalculados.';
}
function opRenderEditor() {
  if(!opEditor)return;
  const e=opEditor,heading=(e.mode==='edit'?'Editar ':e.mode==='create'?'Agregar ':e.mode==='delete'?'Eliminar ':'Restaurar ')+(opEntityNames[e.entity]||'registro').toLowerCase();
  const related=e.removal||e.entry;
  const summary=related?`<p><strong>${esc(related.label)}</strong></p><ul>${Object.entries(related.bundle).filter(([,records])=>records.length).map(([entity,records])=>`<li>${esc(opEntityNames[entity])}: ${records.length} registro${records.length>1?'s':''}</li>`).join('')}</ul>`:'';
  const html=`<dialog id="op-editor-dialog" aria-labelledby="op-editor-title" oncancel="event.preventDefault();opCloseEditor()"><div class="bar"><h2 id="op-editor-title">${esc(heading)}</h2><button class="pill" onclick="opCloseEditor()" ${OPS.busy?'disabled':''}>Cerrar</button></div>${opNotice?`<div class="notice" role="status">${esc(opNotice)}${typeof restaurantUndoMarkup==='function'?restaurantUndoMarkup():''}</div>`:''}${['edit','create'].includes(e.mode)?`<form data-op="editor" class="op-form" onsubmit="opSubmitEditor(event)">${opEditorFields()}${e.mode==='edit'&&!['reservations','preparedWastes','suppliers','supplierPayments','supplierDebts','payableTerms','supplierCategories','supplierEvaluation'].includes(e.entity)?'<p class="k">Las correcciones recalculan el stock y los costos relacionados.</p>':''}${opSave(e.mode==='create'?'Guardar':'Guardar cambios')}</form>`:`${summary}${e.mode==='delete'?'<p>Se quitarán de las listas los registros indicados y se actualizarán sus saldos y datos relacionados. Podrás deshacer el borrado desde el aviso de confirmación.</p>':'<p>Se recuperarán los registros indicados y se actualizarán sus saldos y datos relacionados.</p>'}${e.error?`<div class="notice" role="alert">${esc(e.error)}</div>`:e.impact}<div class="bar"><button class="btn" onclick="opConfirmRemoval()" ${e.error||OPS.busy?'disabled':''}>${e.mode==='delete'?'Eliminar registro':'Restaurar registro'}</button></div>`}<button class="pill" onclick="opRefreshEditor()" ${OPS.busy?'disabled':''}>Revisar datos actuales</button></dialog>`;
  document.getElementById('app').insertAdjacentHTML('beforeend',html);opRestore();
  document.getElementById('op-editor-dialog').showModal();
}
OperationsViews.Papelera=()=>opShell('Papelera','Registros eliminados. Puedes restaurarlos junto con sus movimientos vinculados.',()=>`<div class="card">${opTable(['Eliminado el','Tipo','Registro','Acción'],[...(OPS.state.trash||[])].reverse().map(t=>[esc(horaLima(new Date(t.at))),esc(opEntityNames[t.entity]||t.entity),esc(t.label),`<button class="pill" data-id="${esc(t.id)}" onclick="opRestoreRecord(this.dataset.id)">Restaurar</button>`]),'La papelera está vacía.')}</div>`);
