const Home=globalThis.MisturaHome;
let homeRecognition=null,homeListening=false,homeVoiceStarting=false,homeVoiceMessage='',homeVoiceTimer=null,homeVoiceKind='info';
function homeVoiceStatus(message,kind='info'){
  homeVoiceMessage=message;homeVoiceKind=kind;
  const el=document.getElementById('voice-status');if(el){el.textContent=message;el.dataset.kind=kind}
  const button=document.getElementById('voice-start');if(button){button.textContent=homeListening?(homeVoiceStarting?'Cancelar inicio':'Detener micrófono'):'Activar micrófono';button.setAttribute('aria-pressed',String(homeListening));button.setAttribute('aria-busy',String(homeVoiceStarting))}
}
function homeClearVoiceTimer(){if(homeVoiceTimer!=null)clearTimeout(homeVoiceTimer);homeVoiceTimer=null}
function homeStopVoice(message='Micrófono detenido.',kind='info'){
  const current=homeRecognition;homeRecognition=null;homeListening=false;homeVoiceStarting=false;homeClearVoiceTimer();
  try{current?.abort()}catch{}
  homeVoiceStatus(message,kind);
}
function homeNavigate(target){homeStopVoice('');if(['Reservaciones','Producción','Cocina / comandas','Clientes / fidelización'].includes(target)){window.location.href='/operativo';return}if(target==='Inventario'&&!OPS.state?.settings?.advancedEnabled)target='Compras';if(target==='Reservaciones')reservationDay=Core.dateKey();if(target==='Ventas'){P.k='hoy';P.day=Core.dateKey()}view=target;openId=null;render();window.scrollTo?.({top:0,behavior:'smooth'})}
function homeRunCommand(text){
  const heard=String(text||'').trim().slice(0,200),command=Home.command(heard);
  if(!command){homeVoiceStatus(heard?`Escuché «${heard}», pero no reconozco ese comando. Prueba «abrir inventario» o «ver compras».`:'No se reconocieron palabras. Vuelve a activar el micrófono.','error');return false}
  homeNavigate(command.view);homeVoiceStatus(`Escuché «${heard}». Abriendo ${command.view}.`);return true;
}
function homeVoiceError(code){
  const messages={
    'not-allowed':'El navegador no permite usar el micrófono. En el icono junto a la dirección del panel, permite Micrófono y vuelve a intentarlo.',
    'service-not-allowed':'El navegador bloqueó el servicio de reconocimiento de voz. Prueba este panel en Google Chrome o dicta el comando con Windows + H en el campo de abajo.',
    'audio-capture':'No se encontró un micrófono disponible. Comprueba el micrófono elegido en el navegador y el permiso de Windows para usarlo.',
    'network':'El navegador no pudo conectarse al servicio de reconocimiento de voz. En Brave este servicio puede no estar disponible. Prueba en Google Chrome o dicta el comando con Windows + H en el campo de abajo.',
    'no-speech':'No se escuchó una frase. Acércate al micrófono y prueba «abrir inventario».',
    'language-not-supported':'El servicio no admite el idioma de reconocimiento seleccionado. Prueba de nuevo o usa el comando escrito.',
    'aborted':'El navegador interrumpió la escucha. Puedes volver a activar el micrófono.'
  };
  return messages[code]||'No se pudo iniciar el reconocimiento de voz. Revisa el permiso y el micrófono del navegador o usa el comando escrito.';
}
function homeStartVoice(){
  if(homeListening){homeStopVoice();return}
  homeStopVoice('');
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(typeof Recognition!=='function')return homeVoiceStatus('Este navegador no ofrece reconocimiento de voz. Abre el panel en Chrome con conexión a internet o escribe un comando.','error');
  // Report the click immediately, including while the browser is waiting for permission.
  homeListening=true;homeVoiceStarting=true;homeVoiceStatus('Iniciando micrófono… Si el navegador pide permiso, elige Permitir.');
  let recognition;
  try{
    recognition=new Recognition();homeRecognition=recognition;recognition.lang='es-PE';recognition.continuous=false;recognition.interimResults=false;
    recognition.onstart=()=>{
      if(homeRecognition!==recognition)return;
      homeVoiceStarting=false;homeClearVoiceTimer();homeVoiceStatus('Escuchando… Di «abrir inventario» o «ver compras».');
      homeVoiceTimer=setTimeout(()=>{if(homeRecognition===recognition)homeStopVoice('Terminó el tiempo de escucha. Pulsa Activar micrófono para probar otra vez.','error')},30000);
    };
    recognition.onresult=event=>{
      if(homeRecognition!==recognition)return;
      const result=event.results?.[event.resultIndex||0]||event.results?.[0];
      if(result?.isFinal===false)return;
      const heard=result?.[0]?.transcript||'';homeStopVoice('');homeRunCommand(heard);
    };
    recognition.onerror=event=>{if(homeRecognition===recognition)homeStopVoice(homeVoiceError(event.error),'error')};
    recognition.onnomatch=()=>{if(homeRecognition===recognition)homeStopVoice('No se reconoció el comando. Prueba «abrir inventario» o «ver compras».','error')};
    recognition.onend=()=>{if(homeRecognition===recognition)homeStopVoice('La escucha terminó sin reconocer un comando. Pulsa Activar micrófono para intentar otra vez.','error')};
    homeVoiceTimer=setTimeout(()=>{if(homeRecognition===recognition)homeStopVoice('El navegador no inició la escucha. Revisa el permiso de micrófono del panel y vuelve a intentarlo.','error')},20000);
    recognition.start();
  }catch(error){homeStopVoice(homeVoiceError(error?.name==='NotAllowedError'||error?.name==='SecurityError'?'not-allowed':error?.name==='NotFoundError'?'audio-capture':''),'error')}
}
function homeFishing(day){
  const f=Home.fishing,status=Home.fishingStatus(day);
  return `<section class="card fishing-card" aria-labelledby="fishing-heading"><div class="home-section-head"><div><p class="home-eyebrow">EL MAR Y TU COCINA</p><h2 id="fishing-heading">Temporada de pesca · Ilo</h2><p class="k">Moquegua, Perú · Calendario por especie</p></div><span class="home-badge ${status.stale?'caution':''}">${status.stale?'Revisión pendiente':'Referencia revisada'}</span></div>
  <p class="home-source-date">Revisión: 17 de octubre de 2026 · Próxima revisión: 24 de octubre de 2026. ${status.stale?'La información requiere actualización; confirma las disposiciones vigentes antes de comprar.':'Calendario publicado; confirma cuotas, cierres y procedencia con tu proveedor.'}</p>
  <div class="fishing-species"><article><div class="home-species-title"><h3>Perico / dorado</h3><span class="tag">${status.perico?'Calendario 2026–2027':'Por confirmar'}</span></div><p>Temporada publicada: 1 sep. 2026 – 30 abr. 2027. Sujeta a cuotas y posibles suspensiones.</p><a href="${f.pericoSource}" target="_blank" rel="noopener noreferrer">Ver publicación oficial ↗</a></article>
  <article><div class="home-species-title"><h3>Chanque / tolina</h3><span class="tag ${status.chanque?'caution':''}">${status.chanque?'Veda en calendario':'Revisar calendario'}</span></div><p>Veda anual publicada: abril–junio y octubre–diciembre, en todo el litoral. Revisa la norma vigente antes de comprar.</p><a href="${f.vedaSource}" target="_blank" rel="noopener noreferrer">Ver calendario de PRODUCE ↗</a></article>
  <article><div class="home-species-title"><h3>Otras especies</h3><span class="tag">Verificar procedencia</span></div><p>Pescado, pulpo y conchas negras necesitan identificación de especie y origen. La disponibilidad en Ilo debe confirmarse con el proveedor.</p><a href="${f.updates}" target="_blank" rel="noopener noreferrer">Consultar vedas y actualizaciones ↗</a></article></div>
  <div class="home-impact"><h3>¿Cómo afecta tu inventario?</h3><p>Menor disponibilidad puede cambiar el precio y el plazo de entrega. Confirma abastecimiento antes de ofrecer platos y compra según las reservas y sus recetas. Una temporada o veda no cambia el stock registrado. Las compras recibidas suman; el conteo físico indica cuánto queda. El descuento por ventas solo se activa cuando se habilita el consumo por receta.</p><div class="bar"><button class="pill" onclick="homeNavigate('Inventario')">Revisar stock</button><button class="pill" onclick="homeNavigate('Reservaciones')">Calcular lo que debo comprar</button><a href="${f.ocean}" target="_blank" rel="noopener noreferrer">Boletines del mar · IMARPE ↗</a></div></div></section>`;
}
const HomeViews={Inicio(){
  const ready=OPS.configured&&OPS.state,d=ready?Home.daily(OPS.state):null,day=d?.day||Core.dateKey(),date=new Intl.DateTimeFormat('es-PE',{dateStyle:'full',timeZone:'America/Lima'}).format(Core.dayStart(day));
  return `<section class="home-hero"><img class="home-logo" src="assets/mistura-logo.png" width="640" height="640" alt="Mistura Fish Cevichería"><div class="home-welcome"><p class="home-eyebrow">BIENVENIDO A MISTURA FISH</p><h1>${d?.greeting||'Bienvenido'}.<br>Tu restaurante, al día.</h1><p class="home-date">${esc(date)}<br><span>Ilo · Moquegua · Perú</span></p><div class="bar"><button class="btn" id="voice-start" aria-pressed="${homeListening}" aria-busy="${homeVoiceStarting}" onclick="homeStartVoice()">${homeListening?(homeVoiceStarting?'Cancelar inicio':'Detener micrófono'):'Activar micrófono'}</button></div><p class="home-voice-status" id="voice-status" role="status" aria-live="polite" data-kind="${homeVoiceKind}">${esc(homeVoiceMessage||'Pulsa el botón y di «abrir inventario» o «ver compras».')}</p><form class="home-command-form" onsubmit="event.preventDefault();homeRunCommand(this.elements.command.value)"><label for="home-command">Escribe o dicta un comando</label><div class="bar"><input id="home-command" name="command" aria-describedby="home-dictation-help" maxlength="100" placeholder="Abrir inventario" required><button class="pill" type="submit">Ejecutar comando</button></div></form><p id="home-dictation-help" class="home-dictation-help">¿Usas Brave en Windows? Haz clic en el campo, pulsa Windows + H, di «abrir inventario» y pulsa Ejecutar comando. El dictado de Windows requiere internet y micrófono.</p><details class="home-voice-help"><summary>Comandos de voz y ayuda</summary><p>Di «abrir inventario», «ver reservaciones de hoy», «ver recepciones de productos», «ver ventas por hora». También puedes decir «muéstrame las compras» o «quiero ver proveedores». Los comandos solo abren pantallas.</p><p>La escucha directa depende del servicio del navegador y puede no estar disponible en Brave. Para probar el botón, abre este panel en Google Chrome y permite el micrófono. Chrome puede procesar tu voz en línea. El campo de comandos también admite el dictado de Windows; el panel no inicia ese dictado automáticamente.</p><p><a href="https://support.google.com/chrome/answer/2693767?hl=es" target="_blank" rel="noopener noreferrer">Ayuda para permitir el micrófono en Chrome ↗</a> · <a href="https://support.microsoft.com/es-es/accessibility/windows/use-voice-typing-to-talk-instead-of-type-on-your-pc" target="_blank" rel="noopener noreferrer">Ayuda del dictado de Windows ↗</a></p></details></div></section>
  ${ready&&OPS.error?`<p class="notice" role="alert">No se pudo actualizar la base compartida: ${esc(OPS.error)}. El resumen puede estar desactualizado.</p>`:''}${!ready?`<p class="notice" role="status">${esc(OPS.error||'Cargando el resumen desde la base compartida…')}</p><button class="pill" onclick="opLoad(true)">Volver a cargar datos</button>`:`<section class="home-stats" aria-label="Resumen de hoy">${[[d.pending.length,'Reservaciones pendientes','Reservaciones'],[d.guests,'Personas por recibir','Reservaciones'],[d.dishes,'Platos pedidos por preparar','Reservaciones']].map(([n,label,target])=>`<button class="card home-stat" onclick="homeNavigate('${target}')"><span class="k">${label}</span><strong>${n}</strong><span class="home-stat-link">Ver detalle ↗</span></button>`).join('')}</section>
  <div class="home-today"><section class="card"><div class="home-section-head"><div><p class="home-eyebrow">AGENDA DEL SERVICIO</p><h2>Reservaciones de clientes de hoy</h2></div><button class="pill" onclick="homeNavigate('Reservaciones')">Ver agenda</button></div>${d.reservations.length?`<ul class="home-list">${d.reservations.map(r=>`<li><time>${esc(new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',hour:'2-digit',minute:'2-digit'}).format(new Date(r.plannedAt)))}</time><div><strong>${esc(r.name)}</strong><p>${r.guests} personas · ${r.lines.reduce((n,l)=>n+l.quantity,0)} platos pedidos</p></div><span class="tag">${esc(r.status)}</span></li>`).join('')}</ul>`:'<p class="home-empty">No tienes reservaciones activas para hoy.</p>'}<p class="k">${d.plan.missing.length?'Hay platos sin receta: el cálculo de insumos está incompleto.':d.plan.ingredients.filter(i=>i.buy>0).length?`${d.plan.ingredients.filter(i=>i.buy>0).length} insumos necesitan compra para cubrir los pedidos pendientes.`:d.pending.length?'Consulta las recetas y el stock para organizar la preparación.':'Consulta las reservaciones y registra las compras y el stock físico. El cálculo exacto por ingrediente requiere fichas técnicas.'}</p></section>
  </div>`}
  ${homeFishing(day)}<section class="card home-quick"><h2>Continúa con tu operación</h2><div class="bar">${managementMenu().filter(v=>!['Inicio','Configuración'].includes(v)).map(v=>`<button class="pill" onclick="homeNavigate('${v}')">${v==='Escandallos'?'Recetas / escandallos':v}</button>`).join('')}</div></section>`;
}};
