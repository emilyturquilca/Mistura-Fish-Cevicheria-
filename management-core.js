// Explicit business modes. Physical stock is independent of technical recipe sheets.
(() => {
  function apply(s,command,now,h){
    const p=command.payload||{};
    if(command.type==='businessSettings'){
      if(!['global','recipes'].includes(p.stockMode))h.fail('Elige un modo de inventario válido.');
      if(p.stockMode==='recipes'&&(!p.advancedEnabled||p.recipesReady!==true))h.fail('Confirma primero que las fichas técnicas y los costos están definidos.');
      const before=s.settings?.stockMode||'global';
      s.settings={...s.settings,advancedEnabled:p.advancedEnabled===true,stockMode:p.stockMode,updatedAt:now};
      if(before!=='recipes'&&p.stockMode==='recipes')s.settings.recipeConsumptionFrom=now;
      return true;
    }
    if(command.type==='stockPhysical'){
      const i=h.find(s.ingredients,p.ingredientId,'Insumo'),quantity=h.num(p.quantity,'Stock físico',true);
      s.movements.push({id:command.id+'/stock',ingredientId:i.id,kind:'Stock',quantity:0,countedQuantity:quantity,inputCost:i.cost??null,unitCost:i.cost??null,date:globalThis.MisturaCore.dateKey(now),postedAt:now,note:h.text(p.note||'Stock físico contado','Motivo')});return true;
    }
    return false;
  }
  globalThis.MisturaManagement={apply};
})();
