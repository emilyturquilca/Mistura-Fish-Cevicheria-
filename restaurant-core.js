// Stock entry, recipe consumption and reservation planning. No credentials or provider writes.
(() => {
  const C=()=>globalThis.MisturaCore,O=()=>globalThis.MisturaOperations;
  const formula=r=>JSON.stringify([r.productKey,r.portions,r.lines]);
  function prepare(s,now){
    s.autoStock ||= {startAt:now,pending:[]}; s.recipeVersions ||= [];s.saleUsage ||= {};
    for(const recipe of s.recipes)if(!s.recipeVersions.some(v=>v.recipeId===recipe.id))s.recipeVersions.push({id:recipe.id+'/legacy',recipeId:recipe.id,productKey:recipe.productKey,portions:recipe.portions,lines:structuredClone(recipe.lines),from:new Date(recipe.updatedAt)>new Date(s.autoStock.startAt)?recipe.updatedAt:s.autoStock.startAt,to:null});
  }
  function updateVersions(s,now){
    for(const version of s.recipeVersions.filter(v=>!v.to)){
      const recipe=s.recipes.find(r=>r.id===version.recipeId);
      if(!recipe||formula(recipe)!==formula(version))version.to=now;
    }
    for(const recipe of s.recipes)if(!s.recipeVersions.some(v=>v.recipeId===recipe.id&&!v.to))s.recipeVersions.push({id:recipe.id+'/v/'+(s.recipeVersions.length+1),recipeId:recipe.id,productKey:recipe.productKey,portions:recipe.portions,lines:structuredClone(recipe.lines),from:now,to:null});
  }
  function autoMovements(s,now){
    const pending=[];
    for(const sale of Object.values(s.sales.v)){
      if(sale.type!=='SALE'||sale.source!=='api')continue;
      if(new Date(sale.f)<new Date(s.autoStock.startAt)){delete s.saleUsage[sale.id];continue}
      const products={};for(const line of sale.items||[])if(line.q>0)products[line.k]=(products[line.k]||0)+line.q;
      const usage={receiptId:sale.id,date:sale.f,store:sale.store||'',products:[],status:'sale'};
      for(const [productKey,quantity]of Object.entries(products)){
        const version=s.recipeVersions.filter(v=>v.productKey===productKey&&new Date(v.from)<=new Date(sale.f)&&(!v.to||new Date(sale.f)<new Date(v.to))).sort((a,b)=>new Date(b.from)-new Date(a.from)).at(0);
        if(!version||version.lines.some(l=>!s.ingredients.some(i=>i.id===l.ingredientId))){
          if(s.recipes.some(r=>r.productKey===productKey))continue;
          pending.push({receiptId:sale.id,productKey,quantity,date:sale.f});continue;
        }
        usage.products.push({productKey,quantity,versionId:version.id,ingredients:version.lines.map(l=>({ingredientId:l.ingredientId,perPlate:l.quantity/l.yield/version.portions}))});
      }
      s.saleUsage[sale.id]=usage;
    }
    // A financial refund/cancellation does not physically recover already prepared ingredients.
    for(const usage of Object.values(s.saleUsage))if(!s.sales.v[usage.receiptId])usage.status='cancelled';
    const manual=s.movements.filter(m=>m.kind!=='Venta'),automatic=[];
    for(const movement of manual)if(movement.sequence==null)movement.sequence=s.nextMovementSequence++;
    for(const usage of Object.values(s.saleUsage)){
      const quantities={};for(const p of usage.products)for(const l of p.ingredients)quantities[l.ingredientId]=(quantities[l.ingredientId]||0)+p.quantity*l.perPlate;
      for(const [ingredientId,q]of Object.entries(quantities))automatic.push({id:'auto/'+encodeURIComponent(usage.receiptId)+'/'+ingredientId,ingredientId,quantity:-O().round(q),unitCost:null,kind:'Venta',receiptId:usage.receiptId,date:C().dateKey(usage.date),postedAt:usage.date,note:'Loyverse #'+usage.receiptId});
    }
    manual.sort((a,b)=>a.sequence-b.sequence);
    const groups=new Map();
    for(const m of automatic){
      let index=manual.findIndex(x=>new Date(x.postedAt)>new Date(m.postedAt));if(index<0)index=manual.length;
      if(!groups.has(index))groups.set(index,[]);groups.get(index).push(m);
    }
    for(const [index,entries]of groups){
      const left=manual[index-1]?.sequence??(manual[index]?.sequence||1)-1,right=manual[index]?.sequence??left+1;
      entries.sort((a,b)=>new Date(a.postedAt)-new Date(b.postedAt)||a.id.localeCompare(b.id));
      entries.forEach((m,i)=>m.sequence=left+(right-left)*(i+1)/(entries.length+1));
    }
    s.movements=[...manual,...automatic].sort((a,b)=>a.sequence-b.sequence);
    s.autoStock.pending=pending.filter(p=>new Date(p.date)>=new Date(now)-31*864e5);s.autoStock.syncedAt=now;
  }
  function after(s,previous,command,now,h){
    if(command.type==='ingredient' && command.payload.stock!=null){
      const p=command.payload,ingredient=h.find(s.ingredients,p.id||command.id,'Insumo'),quantity=h.num(p.stock,'Stock',true),cost=h.num(p.unitCost,'Costo por unidad',true);
      if(!p.id || quantity!==O().stock(s,ingredient.id)||cost!==ingredient.cost)s.movements.push({id:command.id+'/stock',ingredientId:ingredient.id,kind:'Stock',quantity:0,countedQuantity:quantity,inputCost:cost,unitCost:cost,date:C().dateKey(now),postedAt:now,note:p.id?'Stock corregido desde Inventario':'Stock al registrar el insumo'});
    }
    updateVersions(s,now);autoMovements(s,now);
  }
  function reconcile(s,now=new Date().toISOString()){
    globalThis.MisturaEdits.prepare(s);prepare(s,now);updateVersions(s,now);autoMovements(s,now);
    const fail=message=>{throw new Error(message)},find=(list,id,label)=>list.find(r=>r.id===id)||fail(label+' no encontrado.');
    globalThis.MisturaEdits.recalculate(s,{fail,find,round:O().round});return s;
  }
  function reservationPayload(s,p,now,h){
    const plannedAt=C().parseDate(p.plannedAt);
    if(!plannedAt)h.fail('Indica fecha y hora de la reservación.');
    const status=p.status||'Pendiente';if(!['Pendiente','Atendida','Cancelada'].includes(status))h.fail('Estado inválido.');
    const guests=h.num(p.guests,'Personas');if(!Number.isInteger(guests))h.fail('El número de personas debe ser entero.');
    if(!Array.isArray(p.lines)||!p.lines.length||p.lines.length>100)h.fail('Indica los platos y cantidades pedidos.');
    const seen=new Set(),lines=p.lines.map(l=>{
      if(!s.sales.prods[l.productKey])h.fail('Producto de Loyverse no encontrado.');
      if(seen.has(l.productKey))h.fail('No repitas el plato; suma sus cantidades.');seen.add(l.productKey);
      const quantity=h.num(l.quantity,'Cantidad de platos');if(!Number.isInteger(quantity))h.fail('La cantidad de platos debe ser entera.');
      return {productKey:l.productKey,quantity};
    });
    return {name:h.text(p.name,'Nombre de la reservación'),phone:h.text(p.phone,'Teléfono',true),guests,plannedAt,status,note:h.text(p.note,'Notas',true),lines,updatedAt:now};
  }
  function apply(s,command,now,h){
    const p=command.payload||{};
    if(command.type==='reservation'){
      s.reservations ||= [];const record=reservationPayload(s,p,now,h);
      if(p.id)Object.assign(h.find(s.reservations,p.id,'Reservación'),record);else s.reservations.push({id:command.id,createdAt:now,...record});
      return true;
    }
    if(command.type==='preparedWaste'){
      s.preparedWastes ||= [];
      const refund=h.find(Object.values(s.sales.v),p.refundId,'Devolución de Loyverse');
      if(refund.type!=='REFUND')h.fail('Elige un recibo de devolución.');
      const original=s.saleUsage[refund.refundFor],product=original?.products.find(x=>x.productKey===p.productKey);
      if(!product)h.fail('Ese plato no tiene un consumo automático previo. Registra la pérdida del insumo si aún no fue descontado.');
      const quantity=h.num(p.quantity,'Platos descartados');
      const refunded=-(refund.items||[]).filter(l=>l.k===p.productKey).reduce((n,l)=>n+l.q,0);
      const used=s.preparedWastes.filter(w=>w.id!==p.id&&w.refundId===refund.id&&w.productKey===p.productKey).reduce((n,w)=>n+w.quantity,0);
      if(quantity+used>refunded || quantity+used>product.quantity)h.fail('La pérdida supera los platos devueltos o ya se registró.');
      let unitCost=0;for(const line of product.ingredients){const movement=s.movements.find(m=>m.kind==='Venta'&&m.receiptId===original.receiptId&&m.ingredientId===line.ingredientId);if(movement?.unitCost==null){unitCost=null;break}unitCost+=movement.unitCost*line.perPlate}
      const record={refundId:refund.id,saleId:original.receiptId,productKey:p.productKey,quantity,date:h.date(p.date,now),note:h.text(p.note,'Motivo'),unitCost:unitCost==null?null:C().round(unitCost),updatedAt:now};
      if(p.id)Object.assign(h.find(s.preparedWastes,p.id,'Merma de plato'),record);else s.preparedWastes.push({id:command.id,...record});
      return true;
    }
    return false;
  }
  function capacity(s,recipe){
    if(!recipe?.lines.length)return null;
    return Math.max(0,Math.floor(Math.min(...recipe.lines.map(l=>Math.max(0,O().stock(s,l.ingredientId))/(l.quantity/l.yield/recipe.portions)))+1e-8));
  }
  function plan(s,day){
    const reservations=(s.reservations||[]).filter(r=>r.status==='Pendiente'&&C().dateKey(r.plannedAt)===day),dishes={},needs={},missing=[];
    for(const reservation of reservations)for(const line of reservation.lines)dishes[line.productKey]=(dishes[line.productKey]||0)+line.quantity;
    for(const [productKey,quantity]of Object.entries(dishes)){
      const recipe=s.recipes.find(r=>r.productKey===productKey);if(!recipe){missing.push(productKey);continue}
      for(const l of recipe.lines)needs[l.ingredientId]=(needs[l.ingredientId]||0)+quantity*l.quantity/l.yield/recipe.portions;
    }
    return {reservations,dishes,missing,ingredients:Object.entries(needs).map(([id,quantity])=>({id,quantity:O().round(quantity),stock:O().stock(s,id),buy:O().round(Math.max(0,quantity-O().stock(s,id)))}))};
  }
  globalThis.MisturaRestaurant={prepare,after,apply,reconcile,capacity,plan};
})();
