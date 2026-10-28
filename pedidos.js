(() => {
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cash=n=>Number(n).toLocaleString('es-PE',{style:'currency',currency:'PEN'}),cart=new Map();
  let menu=null,token='',order=null,busy=false,tracker=null,brick=null,mpClient=null,sdkPromise=null;
  async function paymentSDK(){if(window.MercadoPago)return;if(!sdkPromise)sdkPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://sdk.mercadopago.com/js/v2';script.onload=resolve;script.onerror=()=>{sdkPromise=null;reject(Error('No se pudo cargar el pago seguro.'))};document.head.appendChild(script)});await sdkPromise;}
  const form=$('checkout-form');
  function message(text,where='public-message'){const el=$(where);el.textContent=text;el.hidden=!text}
  async function request(path,payload){const r=await fetch(path,{method:payload?'POST':'GET',headers:{...(payload?{'Content-Type':'application/json'}:{}),...(token?{'x-order-token':token}:{})},...(payload?{body:JSON.stringify(payload)}:{})});const data=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(data.error||'No se pudo confirmar la operación. Revisa el estado antes de repetir.'),{status:r.status});return data}
  const method=()=>form.elements.method.value;
  function total(){const subtotal=[...cart].reduce((n,[id,q])=>n+(menu.items.find(i=>i.id===id)?.price||0)*q,0),delivery=form.elements.mode.value==='delivery'?menu.deliveryFee:0;return {subtotal,delivery,total:Math.round((subtotal+delivery)*100)/100}}
  function drawMenu(){const category=$('category').value;const rows=menu.items.filter(i=>!category||i.category===category);$('menu-grid').innerHTML=rows.map(i=>`<article class="menu-item"><span class="category">${esc(i.category)}</span><h3>${esc(i.name)}</h3><p>${esc(i.description||'Preparado al momento, con el sabor de Mistura.')}</p><div class="item-bottom"><span class="price">${cash(i.price)}</span><button class="ghost" data-add="${esc(i.id)}" aria-label="Agregar ${esc(i.name)}">Agregar +</button></div></article>`).join('')||'<p>No hay platos disponibles en esta categoría.</p>'}
  function drawCart(){
    $('cart-lines').innerHTML=[...cart].map(([id,q])=>{const i=menu.items.find(i=>i.id===id);return `<div class="cart-line"><div><strong>${esc(i.name)}</strong><small>${cash(i.price*q)}</small></div><div class="quantity"><button type="button" data-minus="${esc(id)}" aria-label="Quitar uno de ${esc(i.name)}">−</button><span>${q}</span><button type="button" data-plus="${esc(id)}" aria-label="Agregar uno de ${esc(i.name)}">+</button></div></div>`}).join('')||'<p class="muted">Elige tus platos favoritos de la carta.</p>';
    const t=total();$('cart-total').innerHTML=`<div><span>Platos</span><span>${cash(t.subtotal)}</span></div>${t.delivery?`<div><span>Delivery</span><span>${cash(t.delivery)}</span></div>`:''}<div class="grand-total"><span>Total</span><span>${cash(t.total)}</span></div>`;$('send-order').disabled=busy||!cart.size;
  }
  function modeChanged(){const mode=form.elements.mode.value;$('table-field').hidden=mode!=='mesa';form.elements.table.required=mode==='mesa';$('delivery-fields').hidden=mode!=='delivery';form.elements.address.required=mode==='delivery';drawCart()}
  function payHelp(){$('payment-help').textContent=method()==='Efectivo'?'Pagarás al recibir. Cocina confirmará la aceptación de tu pedido.':'Después de confirmar el pedido abrirás el pago seguro. Cocina lo aceptará cuando el pago esté confirmado.'}
  async function loadMenu(){
    try{menu=await request('/api/web-orders');$('shop-content').hidden=!menu.enabled;$('shop-closed').hidden=menu.enabled;$('shop-notice').textContent=menu.notice;$('shop-notice').hidden=!menu.notice;
      $('delivery-option').hidden=!menu.allowDelivery;$('delivery-zone').textContent=menu.deliveryZone;
      form.elements.method.querySelector('option[value="Efectivo"]').disabled=!menu.allowCash;
      for(const v of ['Tarjeta','Yape'])form.elements.method.querySelector(`option[value="${v}"]`).disabled=!menu.paymentsReady;
      form.elements.method.value=menu.allowCash?'Efectivo':menu.paymentsReady?'Tarjeta':'';
      $('category').innerHTML='<option value="">Toda la carta</option>'+[...new Set(menu.items.map(i=>i.category))].map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
      drawMenu();drawCart();payHelp();if(menu.testMode)message('Entorno de prueba de pagos. No uses datos de pago reales.');
    }catch(e){message(e.message);$('shop-content').hidden=true}
  }
  function renderTracking(){
    if(!order)return;
    $('shop-screen').hidden=true;$('tracking-screen').hidden=false;$('tracking-title').textContent='Pedido #'+order.number;
    const labels={pending:'Pago pendiente',submitting:'Confirmando pago',processing:'Pago en proceso',paid:'Pago confirmado',failed:'Pago rechazado',review:'Pago en revisión'};
    $('tracking-status').innerHTML=`<span class="status-pill">${esc(order.status)}</span><span class="status-pill ${order.payment==='paid'?'paid':''}">${esc(labels[order.payment]||'Revisando pago')}</span>`;
    $('tracking-lines').innerHTML=order.lines.map(l=>`<div class="tracking-line"><span>${l.quantity} × ${esc(l.name)}</span><strong>${cash(l.quantity*l.unitPrice)}</strong></div>`).join('')+(order.deliveryFee?`<div class="tracking-line"><span>Delivery</span><span>${cash(order.deliveryFee)}</span></div>`:'')+`<div class="tracking-line"><strong>Total</strong><strong>${cash(order.total)}</strong></div>`;
    const cancelled=order.status==='Cancelada'||order.archived;
    $('pay-order').hidden=cancelled||order.method==='Efectivo'||!['pending','failed'].includes(order.payment);
    $('refresh-payment').hidden=order.method==='Efectivo'||cancelled;
    message(order.cancelReason||(order.payment==='paid'?'Pago confirmado. El restaurante está gestionando tu pedido.':order.method==='Efectivo'?(order.status==='Por aceptar'?'Tu pago en efectivo sigue pendiente. Espera la aceptación del restaurante.':'Tu pedido está en marcha. Pagarás en efectivo al recibir.'):'Completa el pago para que el restaurante pueda aceptar el pedido.'),'tracking-message');
    if(order.payment==='paid'&&$('payment-dialog').open)closePayment();
  }
  async function refresh(){if(!token||document.hidden)return;try{order=await request('/api/web-orders?action=track');renderTracking()}catch(e){message(e.message,'tracking-message')}}
  async function follow(value){token=value;location.hash='pedido='+token;localStorage.setItem('mf_last_order',token);$('last-order').hidden=false;await refresh();clearInterval(tracker);tracker=setInterval(refresh,10000)}
  function newToken(){return [...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('')}
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!cart.size)return;busy=true;drawCart();message('Enviando tu pedido…');
    const data=Object.fromEntries(new FormData(form)),birthDay=data.birthDay,birthMonth=data.birthMonth;
    if(Boolean(birthDay)!==Boolean(birthMonth)){busy=false;drawCart();return message('Completa día y mes de cumpleaños o deja ambos vacíos.')}
    const payload={...data,birthday:birthDay&&birthMonth?birthMonth+'-'+String(birthDay).padStart(2,'0'):'',privacyAccepted:form.elements.privacyAccepted.checked,marketingConsent:form.elements.marketingConsent.checked,total:total().total,lines:[...cart].map(([id,quantity])=>({id,quantity,price:menu.items.find(i=>i.id===id).price}))};
    let pending;try{pending=JSON.parse(sessionStorage.getItem('mf_pending_web')||'null')}catch{}
    if(!pending)pending={token:newToken(),payload};
    token=pending.token;sessionStorage.setItem('mf_pending_web',JSON.stringify(pending));
    try{order=await request('/api/web-orders',pending.payload);sessionStorage.removeItem('mf_pending_web');sessionStorage.setItem('mf_payer_email',data.email||'');cart.clear();message('');await follow(token)}catch(e){if([400,409,422].includes(e.status))sessionStorage.removeItem('mf_pending_web');message(e.message+' Si se perdió la conexión, vuelve a confirmar para consultar el mismo pedido.')}finally{busy=false;drawCart()}
  });
  document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b||busy)return;const id=b.dataset.add||b.dataset.plus||b.dataset.minus;if(!id)return;const q=(cart.get(id)||0)+(b.dataset.minus?-1:1);if(q>30)return;if(q<=0)cart.delete(id);else cart.set(id,q);drawCart()});
  const tableParam=new URLSearchParams(location.search).get('mesa');if(tableParam)form.elements.table.value=tableParam.slice(0,40);$('category').addEventListener('change',drawMenu);form.addEventListener('change',e=>{if(e.target.name==='mode')modeChanged();if(e.target.name==='method')payHelp()});
  $('back-menu').onclick=()=>{clearInterval(tracker);$('tracking-screen').hidden=true;$('shop-screen').hidden=false;history.replaceState(null,'',location.pathname);token='';loadMenu()};
  $('last-order').onclick=()=>follow(localStorage.getItem('mf_last_order')||'');$('last-order').hidden=!localStorage.getItem('mf_last_order');
  $('copy-tracking').onclick=async()=>{try{await navigator.clipboard.writeText(location.origin+'/pedidos#pedido='+token);message('Enlace copiado. Guárdalo para consultar el pedido.','tracking-message')}catch{message('Puedes guardar la dirección que aparece en tu navegador.','tracking-message')}};
  async function submitPayment(data){
    message('Confirmando el pago…','payment-feedback');const result=await request('/api/web-payments',{...data,attemptId:crypto.randomUUID()});order=result;renderTracking();message(order.payment==='paid'?'Pago confirmado.':order.payment==='failed'?'El pago fue rechazado. Puedes intentar nuevamente.':'Pago en revisión. Actualiza su estado antes de intentar otro pago.','payment-feedback');if(order.payment==='paid')closePayment();
  }
  async function openPayment(){
    if(!menu?.paymentsReady)return message('El servicio de pago no está disponible. Intenta de nuevo en unos minutos.','tracking-message');
    try{await paymentSDK()}catch(e){return message(e.message,'tracking-message')}
    await closePayment();mpClient=new MercadoPago(menu.publicKey,{locale:'es-PE'});$('payment-amount').textContent='Total a pagar: '+cash(order.total);message('','payment-feedback');$('payment-dialog').showModal();$('yape-form').hidden=order.method!=='Yape';$('card-payment').hidden=order.method!=='Tarjeta';
    if(order.method==='Yape'){$('yape-form').elements.email.value=sessionStorage.getItem('mf_payer_email')||'';return}
    try{brick=await mpClient.bricks().create('cardPayment','card-payment',{initialization:{amount:order.total,payer:{email:sessionStorage.getItem('mf_payer_email')||''}},customization:{paymentMethods:{maxInstallments:1}},callbacks:{onReady(){},onError(){message('No se pudo cargar el formulario seguro. Cierra e intenta de nuevo.','payment-feedback')},onSubmit:async data=>{try{await submitPayment({token:data.token,paymentMethodId:data.payment_method_id,issuerId:data.issuer_id,email:data.payer?.email,identification:data.payer?.identification})}catch(e){message(e.message+' Pulsa Actualizar pago antes de volver a pagar.','payment-feedback');throw e}}}})}catch{message('No se pudo iniciar el pago seguro. Intenta nuevamente.','payment-feedback')}
  }
  async function closePayment(){if(brick){await brick.unmount();brick=null}$('yape-form').elements.otp.value='';if($('payment-dialog').open)$('payment-dialog').close()}
  $('pay-order').onclick=openPayment;$('close-payment').onclick=closePayment;$('payment-dialog').addEventListener('cancel',e=>{e.preventDefault();closePayment()});
  $('yape-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('button');b.disabled=true;try{const y=await mpClient.yape({phoneNumber:f.elements.phone.value,otp:f.elements.otp.value}).create();f.elements.otp.value='';await submitPayment({token:y.id,paymentMethodId:'yape',email:f.elements.email.value})}catch(err){message(err.message||'No se pudo confirmar Yape. Actualiza el estado del pago antes de repetir.','payment-feedback')}finally{b.disabled=false}});
  $('refresh-payment').onclick=async()=>{const b=$('refresh-payment');b.disabled=true;try{order=await request('/api/web-payments',{action:'refresh'});renderTracking()}catch(e){message(e.message,'tracking-message')}finally{b.disabled=false}};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&token)refresh()});
  (async()=>{await loadMenu();const match=location.hash.match(/^#pedido=([a-f0-9]{64})$/);if(match)await follow(match[1]);else{let pending;try{pending=JSON.parse(sessionStorage.getItem('mf_pending_web')||'null')}catch{}if(pending){token=pending.token;message('Tienes un envío pendiente de confirmar. Consulta el último estado antes de hacer otro pedido.');$('last-order').hidden=false;$('last-order').onclick=async()=>{try{await follow(pending.token)}catch(e){message(e.message)}}}}})();
})();
