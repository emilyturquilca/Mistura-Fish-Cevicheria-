let ingredientHistory='',priceSupplierFilter='';
function supplierRatingFields(values={}){
  const stars=(name,label)=>`<fieldset class="supplier-rating"><legend>${label}</legend><div class="rating-options">${[1,2,3,4,5].map(n=>`<label><input type="radio" name="${name}" value="${n}" aria-label="${label}: ${n} de 5 estrellas" ${Number(values[name])===n?'checked':''}><span aria-hidden="true">★</span></label>`).join('')}<label class="rating-unset"><input type="radio" name="${name}" value="" aria-label="${label}: sin calificar" ${!values[name]?'checked':''}><span>Sin calificar</span></label></div></fieldset>`;
  return `<fieldset class="delivery-evaluation"><legend>Evaluar al proveedor · opcional</legend><p class="k">Tu valoración de esta entrega. Puntualidad respecto al plazo acordado; calidad de los productos recibidos. Puedes editarla o quitar las estrellas eligiendo Sin calificar.</p><div class="rating-grid">${stars('punctuality','Puntualidad')}${stars('quality','Calidad')}</div>${opInput('Observación de la entrega (opcional)','evaluationNote','text',values.evaluationNote||'',false,'maxlength="300"')}</fieldset>`;
}
function supplierEvaluate(id){
  if(OPS.busy||!OPS.configured)return;
  const record=OPS.state.receptions.find(r=>r.id===id);if(!record)return;
  opCapture();document.querySelector('form[data-op="editor"]')?.remove();
  opEditor={mode:'edit',entity:'supplierEvaluation',id,version:OPS.version,record:structuredClone(record),linesCount:1};
  opDrafts.editor={punctuality:record.punctuality??'',quality:record.quality??'',evaluationNote:record.evaluationNote||''};opNotice='';render();
}
function supplierStars(value){return value==null?'<span class="k">Sin calificar</span>':`<span class="supplier-stars" role="img" aria-label="${value} de 5 estrellas">${'★'.repeat(Math.floor(value))}${'☆'.repeat(5-Math.floor(value))}</span> <span class="k">${value}/5</span>`}
function supplierEvaluationAction(r){return `<button class="pill" data-id="${esc(r.id)}" onclick="supplierEvaluate(this.dataset.id)">${r.punctuality||r.quality||r.evaluationNote?'Editar evaluación':'Evaluar proveedor'}</button>`}
const supplierPrice=n=>new Intl.NumberFormat('es-PE',{style:'currency',currency:'PEN',minimumFractionDigits:2,maximumFractionDigits:4}).format(n);
function supplierPriceChange(row){
  if(row.change==null)return '<span class="k">Primera recepción</span>';
  if(row.change===0)return '<span class="k">Sin cambio</span>';
  return `<strong class="${row.change>0?'dn':'up'}">${row.change>0?'↑ Subió':'↓ Bajó'} ${esc(supplierPrice(Math.abs(row.change)))}</strong>${row.percent==null?' · sin base porcentual':` <span class="k">(${row.percent>0?'+':''}${row.percent}%)</span>`}`;
}
function supplierPriceTable(rows){
  const s=OPS.state;
  return opTable(['Fecha','Insumo','Proveedor','Comprobante','Cantidad recibida','Precio por unidad','Precio anterior','Variación','Acciones'],[...rows].reverse().map(r=>{
    const i=s.ingredients.find(i=>i.id===r.ingredientId),p=s.suppliers.find(p=>p.id===r.supplierId);
    return [esc(r.date),esc(i?.name||'Insumo'),esc(p?.name||'Proveedor'),esc(r.reference||'—'),opQuantity(r.quantity)+' '+esc(i?.unit),esc(supplierPrice(r.unitCost))+' / '+esc(i?.unit),r.previousCost==null?'—':esc(supplierPrice(r.previousCost)),supplierPriceChange(r),`<button class="pill" data-id="${esc(r.receptionId)}" onclick="opOpenEditor('receptions',this.dataset.id)">Editar recepción</button>`];
  }),'El historial aparecerá al recibir productos de una compra. El costo ingresado al crear un insumo no es una recepción.');
}
function supplierPerformanceSections(s,supplier){
  const data=Payables.performance(s,supplier.id);
  return `<section class="card supplier-section" id="supplier-performance"><h2>Evaluaciones de entregas</h2><div class="rating-summary">${[['Puntualidad',data.punctuality],['Calidad',data.quality]].map(([label,score])=>`<div><h3>${label}</h3>${supplierStars(score.value)}<p class="k">${score.count} ${score.count===1?'entrega calificada':'entregas calificadas'}</p></div>`).join('')}</div><p class="k">Los promedios incluyen solo entregas calificadas. Las recepciones anteriores permanecen Sin calificar hasta que las evalúes.</p>${opTable(['Fecha','Comprobante','Puntualidad','Calidad','Observación','Acciones'],[...data.receptions].reverse().map(r=>[esc(r.date),esc(r.reference||'—'),supplierStars(r.punctuality),supplierStars(r.quality),esc(r.evaluationNote||'—'),supplierEvaluationAction(r)]),'Este proveedor todavía no tiene recepciones para evaluar.')}</section>
  <section class="card supplier-section" id="supplier-quantities"><h2>Cumplimiento de cantidades</h2><p class="k">Acumulado de las recepciones de cada compra. Una entrega parcial puede completarse después; el porcentaje compara cantidades del mismo insumo y unidad.</p>${opTable(['Compra','Insumo','Pedido','Recibido','Pendiente','Recibido del pedido'],data.quantities.map(r=>{const i=s.ingredients.find(i=>i.id===r.ingredientId);return[r.orderNumber,esc(i?.name),opQuantity(r.ordered)+' '+esc(i?.unit),opQuantity(r.received)+' '+esc(i?.unit),opQuantity(r.pending)+' '+esc(i?.unit),r.percent==null?'—':r.percent+'%']}),'No hay compras para comparar.')}</section>
  <section class="card supplier-section" id="supplier-prices"><h2>Historial de precios</h2><p class="k">Compara el precio recibido con la recepción anterior del mismo insumo y proveedor. El costo promedio del stock se calcula por separado.</p>${supplierPriceTable(Payables.priceHistory(s,{supplierId:supplier.id}))}</section>`;
}
function ingredientPrices(id){opCapture();ingredientHistory=id;priceSupplierFilter='';view='Precios de insumos';render()}
const SupplierPerformanceViews={
  'Precios de insumos'(){return opShell('Historial de precios por insumo','Precios reales de recepciones, separados por proveedor y unidad.',()=>{
    const s=OPS.state,i=s.ingredients.find(i=>i.id===ingredientHistory);
    return `<div class="bar"><button class="pill" onclick="view='Inventario';render()">Volver a Inventario</button><label>Insumo<select aria-label="Insumo del historial" onchange="ingredientHistory=this.value;render()"><option value="">Elegir insumo</option>${s.ingredients.map(i=>`<option value="${esc(i.id)}" ${i.id===ingredientHistory?'selected':''}>${esc(i.name)}</option>`).join('')}</select></label><label>Proveedor<select aria-label="Proveedor del historial" onchange="priceSupplierFilter=this.value;render()"><option value="">Todos los proveedores</option>${s.suppliers.map(p=>`<option value="${esc(p.id)}" ${p.id===priceSupplierFilter?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label></div><section class="card"><h2>${esc(i?.name||'Selecciona un insumo')}</h2>${i?supplierPriceTable(Payables.priceHistory(s,{ingredientId:i.id,supplierId:priceSupplierFilter})):''}</section><p class="k">Cada variación usa la recepción anterior de ese proveedor para ese insumo. Si el precio anterior era cero, se muestra la diferencia sin inventar un porcentaje.</p>`;
  })}
};
