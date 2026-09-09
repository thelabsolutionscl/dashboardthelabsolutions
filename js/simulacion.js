/* js/simulacion.js â€” SimulaciÃ³n de demanda: panel sintÃ©tico para probar lÃ­neas de producto.
 *
 * QUÃ‰ ES: un panel fijo de 44 perfiles chilenos escritos a mano. Le das conceptos
 * de producto con precio y cada perfil dice si lo comprarÃ­a, quÃ© lo frena y en quÃ©
 * gastarÃ­a esa plata en vez. Sirve para DESCARTAR conceptos antes de fabricar
 * prototipos, no para elegir al ganador.
 *
 * QUÃ‰ NO ES: no mide estÃ©tica (los perfiles no ven el producto, leen una
 * descripciÃ³n) ni predice ventas. Ver docs/SIMULACION.md.
 *
 * POR QUÃ‰ LOS PERFILES SON FIJOS Y NO GENERADOS POR IA: si el panel cambia en cada
 * corrida, la corrida del lunes no se puede comparar con la del viernes. Fijos =
 * reproducible. Editarlos es una decisiÃ³n consciente que invalida el historial
 * previo, por eso SIM_PANEL_VERSION se sube a mano cuando se tocan.
 */

// â”€â”€ PANEL DE PERFILES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Subir esta versiÃ³n al editar SIM_PERFILES: las corridas guardadas registran con
// quÃ© panel se hicieron, para no comparar peras con manzanas.
const SIM_PANEL_VERSION = 1;

// tope = gasto que el perfil hace sin pensarlo dos veces (CLP). Es el ancla de
// precio del panel: sobre ese monto el perfil tiene que justificar la compra.
const SIM_PERFILES = [
  // â”€â”€ Consumidor final (28) â”€â”€
  {id:'C01', tipo:'consumidor', tope:30000,  desc:'Javiera, 27, Ã‘uÃ±oa. DiseÃ±adora. Arrienda depto 1D con su pareja. Hogar $1.400.000. Le gusta la deco pero compara precios en 4 tiendas antes de comprar.'},
  {id:'C02', tipo:'consumidor', tope:20000,  desc:'MatÃ­as, 34, MaipÃº. TÃ©cnico elÃ©ctrico. Casa propia, hijos de 3 y 6 aÃ±os. Hogar $1.900.000. Prioriza lo prÃ¡ctico y lo que no se rompa con niÃ±os.'},
  {id:'C03', tipo:'consumidor', tope:80000,  desc:'Camila, 41, Providencia. Abogada. Depto propio 2D, vive sola. Hogar $3.200.000. Compra diseÃ±o y marca, le importa que no se vea barato.'},
  {id:'C04', tipo:'consumidor', tope:12000,  desc:'Rodrigo, 23, Santiago Centro. Estudiante con part time. Arrienda una pieza. Hogar $450.000. Compra casi todo en Temu y AliExpress.'},
  {id:'C05', tipo:'consumidor', tope:25000,  desc:'Paulina, 38, La Florida. Enfermera. Casa arrendada, 2 hijos. Hogar $1.600.000. Compra en Falabella con CMR en cuotas sin interÃ©s.'},
  {id:'C06', tipo:'consumidor', tope:120000, desc:'Ignacio, 31, Las Condes. Ingeniero TI. Depto propio, pareja sin hijos. Hogar $4.200.000. Gamer, arma su setup, paga por lo que se ve bien en cÃ¡mara.'},
  {id:'C07', tipo:'consumidor', tope:35000,  desc:'Fernanda, 29, ViÃ±a del Mar. Community manager. Arrienda depto. Hogar $1.100.000. Vive en Instagram, compra por impulso si es fotogÃ©nico.'},
  {id:'C08', tipo:'consumidor', tope:30000,  desc:'HÃ©ctor, 52, Puente Alto. Contratista. Casa propia. Hogar $2.100.000. DesconfÃ­a de lo caro sin garantÃ­a y de las marcas que no conoce.'},
  {id:'C09', tipo:'consumidor', tope:18000,  desc:'Antonia, 26, ConcepciÃ³n. Profesora. Arrienda con una amiga. Hogar $900.000. Prefiere regalos artesanales y de ferias.'},
  {id:'C10', tipo:'consumidor', tope:250000, desc:'CristiÃ¡n, 45, Vitacura. Gerente comercial. Casa propia, 3 hijos. Hogar $6.500.000. Compra rÃ¡pido y sin regatear si le resuelve un problema.'},
  {id:'C11', tipo:'consumidor', tope:45000,  desc:'Daniela, 33, San Miguel. KinesiÃ³loga. Depto propio 2D con su pareja. Hogar $2.400.000. EstÃ¡ ahorrando para remodelar la cocina.'},
  {id:'C12', tipo:'consumidor', tope:25000,  desc:'SebastiÃ¡n, 39, Temuco. DueÃ±o de minimarket. Casa propia. Hogar $1.800.000. Mide todo en costo/beneficio, pregunta cuÃ¡nto dura.'},
  {id:'C13', tipo:'consumidor', tope:20000,  desc:'Valentina, 24, Independencia. DiseÃ±adora freelance. Arrienda depto chico. Hogar $700.000. Gusto fuerte por lo alternativo, odia lo genÃ©rico.'},
  {id:'C14', tipo:'consumidor', tope:30000,  desc:'Marcelo, 47, La Serena. Funcionario pÃºblico. Casa propia, 2 adolescentes. Hogar $2.000.000. Compra en el mall, desconfÃ­a de comprar online.'},
  {id:'C15', tipo:'consumidor', tope:40000,  desc:'Constanza, 30, Ã‘uÃ±oa. Publicista. Arrienda un loft. Hogar $1.700.000. Cero espacio libre: todo lo que entra tiene que reemplazar algo.'},
  {id:'C16', tipo:'consumidor', tope:90000,  desc:'Ãlvaro, 36, Antofagasta. Supervisor minero, turnos 7x7. Casa propia. Hogar $3.500.000. Compra online porque no alcanza a ir a tiendas.'},
  {id:'C17', tipo:'consumidor', tope:50000,  desc:'Josefa, 28, Providencia. MÃ©dica en formaciÃ³n. Arrienda. Hogar $1.500.000. Sin tiempo, compra regalos a Ãºltima hora y con despacho rÃ¡pido.'},
  {id:'C18', tipo:'consumidor', tope:15000,  desc:'NicolÃ¡s, 42, PeÃ±alolÃ©n. Jefe de bodega. Casa propia con patio. Hogar $1.700.000. Hace las cosas Ã©l mismo antes que comprarlas hechas.'},
  {id:'C19', tipo:'consumidor', tope:150000, desc:'Trinidad, 35, Las Condes. DueÃ±a de casa, 2 hijos chicos. Hogar $5.000.000. Redecora por temporada y sigue cuentas de interiorismo.'},
  {id:'C20', tipo:'consumidor', tope:15000,  desc:'Felipe, 25, ValparaÃ­so. Barista. Arrienda con 2 amigos. Hogar $800.000. EstÃ©tica retro y vintage, compra en ferias persa.'},
  {id:'C21', tipo:'consumidor', tope:28000,  desc:'Macarena, 44, Rancagua. Jefa administrativa. Casa propia. Hogar $2.200.000. Compra los regalos de cumpleaÃ±os de la oficina.'},
  {id:'C22', tipo:'consumidor', tope:70000,  desc:'TomÃ¡s, 32, Santiago Centro. Arquitecto. Depto arrendado. Hogar $2.000.000. Exigente con materiales y terminaciones, detecta el MDF a un metro.'},
  {id:'C23', tipo:'consumidor', tope:35000,  desc:'BÃ¡rbara, 37, QuilpuÃ©. Contadora. Casa propia, 1 hijo. Hogar $1.900.000. Solo compra si hay cuotas sin interÃ©s.'},
  {id:'C24', tipo:'consumidor', tope:200000, desc:'Gonzalo, 55, La Reina. Dentista. Casa propia, hijos grandes. Hogar $5.500.000. Colecciona objetos de diseÃ±o y paga por piezas Ãºnicas.'},
  {id:'C25', tipo:'consumidor', tope:10000,  desc:'Catalina, 22, Ã‘uÃ±oa. Estudiante universitaria, vive con sus papÃ¡s. Mesada $200.000. Decora su pieza con lo que alcanza.'},
  {id:'C26', tipo:'consumidor', tope:8000,   desc:'AndrÃ©s, 40, MaipÃº. Conductor de app. Casa arrendada, 2 hijos. Hogar $1.200.000. No gasta en nada que no sea esencial.'},
  {id:'C27', tipo:'consumidor', tope:100000, desc:'Isidora, 34, Lo Barnechea. Tiene una tienda online de deco. Casa propia. Hogar $4.000.000. EvalÃºa todo pensando si lo revenderÃ­a.'},
  {id:'C28', tipo:'consumidor', tope:40000,  desc:'Pablo, 29, EstaciÃ³n Central. Ingeniero junior. Arrienda depto nuevo chico con su pareja. Hogar $1.600.000. Primer depto, lo estÃ¡ amoblando de a poco.'},
  // â”€â”€ Negocio (16) â€” el "tope" acÃ¡ es el presupuesto de la compra, no el anual â”€â”€
  {id:'N01', tipo:'negocio', tope:250000,  desc:'CafÃ© de especialidad, Barrio Italia, 6 mesas. DueÃ±a de 34. Invierte en ambiente porque su clientela va a fotografiar el local.'},
  {id:'N02', tipo:'negocio', tope:120000,  desc:'Restaurant familiar, MaipÃº, 20 mesas. DueÃ±o de 50. Todo tiene que durar, resistir grasa y poder lavarse.'},
  {id:'N03', tipo:'negocio', tope:200000,  desc:'BarberÃ­a, Providencia, 4 sillones. DueÃ±o de 31. EstÃ©tica muy cuidada, publica todo en Instagram.'},
  {id:'N04', tipo:'negocio', tope:900000,  desc:'Agencia de marketing, Las Condes, 25 personas. Compra regalos corporativos de fin de aÃ±o para clientes y equipo.'},
  {id:'N05', tipo:'negocio', tope:700000,  desc:'Hotel boutique, ValparaÃ­so, 12 habitaciones. Busca identidad local y piezas que los huÃ©spedes comenten.'},
  {id:'N06', tipo:'negocio', tope:60000,   desc:'PeluquerÃ­a de barrio, Puente Alto, 3 puestos. DueÃ±a de 45. Presupuesto muy apretado, compra de a poco.'},
  {id:'N07', tipo:'negocio', tope:400000,  desc:'Startup SaaS, Santiago Centro, 12 personas en cowork. Le importa la cultura de marca y el onboarding de nuevos.'},
  {id:'N08', tipo:'negocio', tope:250000,  desc:'ClÃ­nica dental, Ã‘uÃ±oa. Necesita verse limpia, profesional y confiable. Evita lo estridente.'},
  {id:'N09', tipo:'negocio', tope:350000,  desc:'Bar cervecero, Bellavista. Ambiente nocturno, busca luz de impacto y piezas que se vean en fotos con poca luz.'},
  {id:'N10', tipo:'negocio', tope:100000,  desc:'Gimnasio de barrio, La Florida. DueÃ±o de 38. Invierte solo en lo que retiene socios.'},
  {id:'N11', tipo:'negocio', tope:1500000, desc:'Constructora, Vitacura, 80 personas. Compra premios de seguridad, galvanos y seÃ±alÃ©tica de faena.'},
  {id:'N12', tipo:'negocio', tope:600000,  desc:'Tienda de ropa, 4 locales en malls. Cambia la vitrina cada temporada y necesita reponer rÃ¡pido.'},
  {id:'N13', tipo:'negocio', tope:250000,  desc:'Colegio particular subvencionado, San Bernardo. Compra trofeos, medallas y galvanos para actos y campeonatos.'},
  {id:'N14', tipo:'negocio', tope:1200000, desc:'Productora de eventos, Providencia. Arma premiaciones corporativas y necesita volumen con fecha fija.'},
  {id:'N15', tipo:'negocio', tope:300000,  desc:'Cowork, ConcepciÃ³n, 40 puestos. Necesita seÃ±alÃ©tica y deco que aguante rotaciÃ³n de gente.'},
  {id:'N16', tipo:'negocio', tope:50000,   desc:'PanaderÃ­a de barrio, Quinta Normal. DueÃ±o de 58. Solo compra si le demuestran que le sube las ventas.'},
];

// â”€â”€ LÃNEAS DE PRODUCTO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 'publico' filtra quÃ© mitad del panel opina. Poner a un panadero a opinar sobre
// una lÃ¡mpara de dormitorio ensucia el resultado.
const SIM_LINEAS = {
  lamparas:    {nombre:'LÃ¡mparas (THE LAMP)', publico:'ambos',      contexto:'Marca nueva de lÃ¡mparas fabricadas por The Lab Solutions con impresiÃ³n 3D, neÃ³n LED, acrÃ­lico y madera. Marca sin trayectoria ni reconocimiento. Venta online con despacho a todo Chile.'},
  trofeos:     {nombre:'Trofeos y premios',   publico:'negocio',    contexto:'Trofeos, galvanos y medallas personalizadas en acrÃ­lico, madera y resina. FabricaciÃ³n a pedido con logo del cliente. Plazo tÃ­pico 10 a 15 dÃ­as hÃ¡biles.'},
  merch:       {nombre:'Merchandising corporativo', publico:'negocio', contexto:'Merchandising personalizado para empresas: objetos de escritorio, llaveros, soportes y regalos de fin de aÃ±o. Pedidos desde 20 unidades.'},
  senaletica:  {nombre:'SeÃ±alÃ©tica y letreros', publico:'negocio',  contexto:'SeÃ±alÃ©tica interior, letreros corpÃ³reos, cajas de luz y neÃ³n LED para locales y oficinas. Incluye instalaciÃ³n en RegiÃ³n Metropolitana.'},
  nfc:         {nombre:'NFC y tarjetas digitales', publico:'ambos', contexto:'Tarjetas y placas NFC: contacto digital, menÃºs, reseÃ±as de Google y perfiles. Requiere que el cliente entienda para quÃ© sirve NFC.'},
  deco3d:      {nombre:'Deco e impresiÃ³n 3D', publico:'consumidor', contexto:'Objetos de decoraciÃ³n impresos en 3D: maceteros, organizadores, figuras y piezas de pared. Venta online directa al consumidor.'},
  otra:        {nombre:'Otra lÃ­nea (defÃ­nela abajo)', publico:'ambos', contexto:''},
};

// Modelo y costo. Haiku 4.5: ~US$1 por millÃ³n de tokens de entrada y ~US$5 de
// salida. Una corrida de 10 conceptos cuesta del orden de $80 CLP.
const SIM_MODEL = 'claude-haiku-4-5';
const SIM_USD_CLP = 980;   // referencia para mostrar el costo estimado; ajÃºstalo si el dÃ³lar se mueve fuerte
const SIM_MAX_CONCEPTOS = 10; // evita corridas accidentales de 25 prompts grandes
const SIM_CONCURRENCIA = 2;   // menos rÃ¡fagas simultÃ¡neas y menor riesgo de 429

let _simRun = null;        // corrida en curso o reciÃ©n terminada
let _simBusy = false;
let _simAbort = false;

// â”€â”€ ACCESO A LA IA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Reusa el proxy que ya existe (airtable-proxy expone /anthropic/v1/messages), asÃ­
// la API key no sale al navegador. No usa callClaude() del index porque ese estÃ¡
// fijo en max_tokens 1500 y una corrida de 44 perfiles no cabe en eso.
// Techo de salida segÃºn el tamaÃ±o del panel. Antes era 3000 fijo: con 44 perfiles
// el margen quedaba apretado (44 lÃ­neas Ã— ~40 tokens + resumen) y si el modelo se
// ponÃ­a verboso cortaba a media lÃ­nea, perdiendo perfiles Y el bloque de resumen
// sin que nadie se enterara.
function _simMaxTokens(nPerfiles){ return Math.min(8000, nPerfiles*70 + 600); }

// Devuelve {texto, truncado}. `truncado` es la seÃ±al de que la respuesta se cortÃ³
// por techo de tokens: sin ella, una respuesta parcial se procesa como completa.
async function _simClaude(system, user, maxTokens){
  const body = JSON.stringify({model:SIM_MODEL, max_tokens:maxTokens||3000, system, messages:[{role:'user', content:user}]});
  const px = (typeof _proxyCfg === 'function') ? _proxyCfg() : null;
  let r;
  if(px){
    r = await _claudeHttp(px.url+'/anthropic/v1/messages', {method:'POST', headers:{'Content-Type':'application/json','X-App-Key':px.key}, body});
  }else{
    const k = (typeof getAnthropicKey === 'function') ? getAnthropicKey() : '';
    if(!k) throw new Error('Sin acceso a la IA â€” configura el proxy o la API key en Mi cuenta');
    r = await _claudeHttp('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':k.replace(/[^\x20-\x7E]/g,'').trim(),'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body:new Blob([body],{type:'application/json'})
    });
  }
  if(!r.ok){const e = await r.json().catch(()=>({})); throw new Error(e.error?.message || `IA error ${r.status}`);}
  const j = await r.json();
  if(typeof _recordClaudeUsage==='function') _recordClaudeUsage(j,'simulacion');
  return {
    texto: j.content?.find(b=>b.type==='text')?.text || '',
    truncado: j.stop_reason === 'max_tokens',
  };
}

function simHasIA(){
  try{ return typeof hasClaudeAccess === 'function' ? hasClaudeAccess() : !!(_proxyCfg() || getAnthropicKey()); }
  catch(e){ return false; }
}

// â”€â”€ PROMPT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// El enemigo de esta herramienta es la complacencia: un LLM sin freno le pone 5 a
// todo y el panel deja de discriminar. Las reglas de abajo existen para eso.
const SIM_SYSTEM = `Eres un simulador de panel de consumidores chilenos. Recibes un concepto de producto con su precio y una lista de perfiles, y respondes cÃ³mo reaccionarÃ­a CADA perfil.

REGLAS DE CALIBRACIÃ“N (las mÃ¡s importantes):
- SÃ© severo. EstÃ¡s evaluando una marca nueva, sin trayectoria ni reconocimiento.
- En un panel real de un producto nuevo, lo normal es que MENOS DEL 20% llegue a 4 o 5. Si estÃ¡s poniendo 4 o 5 a mÃ¡s de la mitad del panel, estÃ¡s siendo complaciente: corrÃ­gelo.
- El chileno promedio frente a un objeto de decoraciÃ³n caro dice "estÃ¡ bonito, pero no lo necesito". Refleja eso.
- No inventes entusiasmo. No suavices. Si el concepto es mediocre, el panel entero debe reflejarlo.

ESCALA DE COMPRA (0 a 5):
0 = no le interesa en absoluto
1 = le parece irrelevante para su vida
2 = lo encuentra caro o innecesario
3 = le gusta pero NO lo compra
4 = lo comprarÃ­a en los prÃ³ximos 3 meses
5 = lo compra ahora mismo

CONDICIONES DURAS:
- Para poner 4 o 5, el perfil DEBE nombrar en el campo FRENO el lugar exacto de su casa o el uso concreto en su negocio donde lo pondrÃ­a. Si no puede nombrarlo con precisiÃ³n, el mÃ¡ximo es 3.
- Si el precio supera el "tope" del perfil, el mÃ¡ximo es 3 salvo que el perfil dÃ© una razÃ³n concreta para estirarse.
- El campo ALTERNATIVA es obligatorio SIEMPRE, incluso si compra: en quÃ© gastarÃ­a esa misma plata, o con quÃ© producto lo compara.

FORMATO DE SALIDA (obligatorio, sin texto adicional antes ni despuÃ©s):
Una lÃ­nea por perfil, en el orden en que te los doy:
ID|COMPRA|FRENO|ALTERNATIVA

FRENO: mÃ¡ximo 90 caracteres. Si compra (4-5), acÃ¡ va dÃ³nde lo pondrÃ­a. Si no compra, acÃ¡ va quÃ© lo detiene.
ALTERNATIVA: mÃ¡ximo 60 caracteres.

DespuÃ©s de la Ãºltima lÃ­nea de perfil, agrega exactamente este bloque:
---
FRENOS: los 3 frenos que mÃ¡s se repiten, separados por " ;; ", cada uno con el nÃºmero de perfiles que lo mencionan entre parÃ©ntesis
COMPRADOR: en una lÃ­nea, el perfil-tipo que sÃ­ comprarÃ­a (o "ninguno claro")
PRECIO: el precio en pesos chilenos al que este panel dejarÃ­a de objetar, y por quÃ© en media lÃ­nea

EspaÃ±ol chileno. Sin emojis, sin markdown, sin asteriscos.`;

function _simUserPrompt(linea, contexto, concepto, precio, perfiles){
  const lista = perfiles.map(p=>`${p.id} | tope $${p.tope.toLocaleString('es-CL')} | ${p.desc}`).join('\n');
  const precioTxt = precio ? `$${Number(precio).toLocaleString('es-CL')} CLP (IVA incluido)` : 'sin precio definido â€” evalÃºa solo el concepto';
  return `LÃNEA DE PRODUCTO: ${linea}
CONTEXTO: ${contexto}

CONCEPTO A EVALUAR: ${concepto}
PRECIO AL PÃšBLICO: ${precioTxt}

PERFILES (${perfiles.length}):
${lista}

Responde una lÃ­nea por perfil y luego el bloque de resumen.`;
}

// â”€â”€ PARSEO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Tolerante a propÃ³sito: si el modelo agrega una lÃ­nea de mÃ¡s o cambia el orden,
// se rescata lo que se pueda en vez de botar la corrida entera.
function _simParse(texto, perfiles){
  const validos = new Set(perfiles.map(p=>p.id));
  const votos = [];
  const vistos = new Set();
  let resumen = {frenos:'', comprador:'', precio:''};
  for(const raw of String(texto||'').split('\n')){
    const l = raw.trim();
    if(!l) continue;
    const mF = l.match(/^FRENOS:\s*(.+)$/i);      if(mF){resumen.frenos = mF[1].trim(); continue;}
    const mC = l.match(/^COMPRADOR:\s*(.+)$/i);   if(mC){resumen.comprador = mC[1].trim(); continue;}
    const mP = l.match(/^PRECIO:\s*(.+)$/i);      if(mP){resumen.precio = mP[1].trim(); continue;}
    const partes = l.split('|').map(s=>s.trim());
    if(partes.length < 2) continue;
    const id = partes[0].toUpperCase();
    if(!validos.has(id) || vistos.has(id)) continue;
    const compra = parseInt(partes[1], 10);
    if(!Number.isFinite(compra) || compra < 0 || compra > 5) continue;
    vistos.add(id);
    votos.push({id, compra, freno:(partes[2]||'').slice(0,140), alternativa:(partes[3]||'').slice(0,90)});
  }
  return {votos, resumen};
}

// â”€â”€ VEREDICTO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Los cortes son deliberadamente duros: la pega de esta herramienta es descartar.
// Con menos del 10% de intenciÃ³n real, un producto nuevo sin marca no despega.
function _simVeredicto(pctCompra, promedio){
  if(pctCompra < 10 || promedio < 1.8) return 'descartar';
  if(pctCompra >= 25 && promedio >= 2.8) return 'prototipar';
  return 'dudoso';
}

// Cobertura mÃ­nima para dar un veredicto. Bajo esto el porcentaje se calcularÃ­a
// sobre una base mÃ¡s chica que el panel y saldrÃ­a inflado: 8 compradores sobre 20
// respuestas es 40%, pero sobre el panel real de 44 es 18% â€” la diferencia entre
// "prototipar" y "descartar". Antes se reportaba el 40% en silencio.
const SIM_COBERTURA_MIN = 90;

function _simAgrega(concepto, precio, votos, resumen, esperados, extra){
  const n = votos.length || 1;
  const suma = votos.reduce((a,v)=>a+v.compra, 0);
  const promedio = suma / n;
  const compradores = votos.filter(v=>v.compra >= 4);
  const pctCompra = Math.round(compradores.length / n * 100);
  const esp = esperados || votos.length || 1;
  const cobertura = Math.round(votos.length / esp * 100);
  const incompleto = cobertura < SIM_COBERTURA_MIN;
  return {
    concepto, precio,
    n: votos.length,
    esperados: esp,
    cobertura,
    promedio: Math.round(promedio*100)/100,
    pctCompra,
    // Sin panel completo no se emite veredicto: un nÃºmero calculado sobre media
    // muestra es peor que no tener nÃºmero, porque igual se usa para decidir.
    veredicto: incompleto ? 'incompleto' : _simVeredicto(pctCompra, promedio),
    frenos: resumen.frenos,
    comprador: resumen.comprador,
    precioSugerido: resumen.precio,
    votos,
    ...(extra || {}),
  };
}

// â”€â”€ ENTRADA DEL USUARIO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Formato por lÃ­nea: "Nombre del concepto | 49900". El precio es opcional.
function _simParseConceptos(texto){
  return String(texto||'').split('\n')
    .map(l=>l.trim()).filter(Boolean)
    .slice(0, SIM_MAX_CONCEPTOS)
    .map(l=>{
      const i = l.lastIndexOf('|');
      if(i === -1) return {nombre:l, precio:0};
      const precio = parseInt(l.slice(i+1).replace(/[^\d]/g,''), 10);
      return Number.isFinite(precio) && precio > 0
        ? {nombre:l.slice(0,i).trim(), precio}
        : {nombre:l, precio:0};
    })
    .filter(c=>c.nombre);
}

// â”€â”€ BARRIDO DE PRECIO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// "34900, 49900, 79900" â†’ [34900,49900,79900]. Con barrido activo cada concepto se
// evalÃºa una vez por precio y el precio propio del concepto se ignora: la gracia
// es ver la curva, no mezclar anclas distintas.
// Se limpian los no-dÃ­gitos para aceptar "$34.900". Efecto lateral: "-5" quedarÃ­a
// como 5, y un dedazo tipo "3" pasarÃ­a como precio vÃ¡lido. El piso de $100 los
// descarta: no existe un producto de The Lab bajo esa cifra.
const SIM_PRECIO_MIN = 100;
function _simParseBarrido(texto){
  return String(texto||'').split(',')
    .map(s=>parseInt(String(s).replace(/[^\d]/g,''), 10))
    .filter(n=>Number.isFinite(n) && n >= SIM_PRECIO_MIN)
    .filter((n,i,a)=>a.indexOf(n)===i)
    .sort((a,b)=>a-b)
    .slice(0, 5);
}

// Expande conceptos Ã— precios. `base` agrupa las variantes del mismo concepto para
// poder dibujar la curva. El tope se aplica DESPUÃ‰S de expandir: lo que cuesta
// plata son las llamadas, y cada par (concepto, precio) es una llamada.
function _simExpandir(conceptos, precios){
  if(!precios.length) return conceptos.map(c=>({...c, base:c.nombre}));
  const out = [];
  for(const c of conceptos){
    for(const p of precios) out.push({nombre:c.nombre, precio:p, base:c.nombre});
  }
  return out.slice(0, SIM_MAX_CONCEPTOS);
}

function _simPerfiles(publico){
  if(publico === 'consumidor') return SIM_PERFILES.filter(p=>p.tipo === 'consumidor');
  if(publico === 'negocio')    return SIM_PERFILES.filter(p=>p.tipo === 'negocio');
  return SIM_PERFILES;
}

// Costo estimado: ~2.600 tokens de entrada (perfiles + prompt) y ~1.100 de salida
// por concepto. Sirve para que nadie lance 25 conceptos sin saber quÃ© gasta.
function _simCosto(nConceptos, nPerfiles){
  const inTok  = (1200 + nPerfiles*45) * nConceptos;
  const outTok = (nPerfiles*22 + 120) * nConceptos;
  const usd = inTok/1e6*1 + outTok/1e6*5;
  return Math.max(1, Math.round(usd * SIM_USD_CLP));
}

// â”€â”€ INIT / UI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function initSimulacion(){
  const sel = document.getElementById('simLinea');
  if(sel && !sel.options.length){
    sel.innerHTML = Object.entries(SIM_LINEAS).map(([k,v])=>`<option value="${k}">${escapeHtml(v.nombre)}</option>`).join('');
  }
  _simCtxAuto = '';   // primera carga: el textarea viene vacÃ­o, no hay ediciÃ³n que proteger
  simLineaChange();
  simEstimar();
  renderSimHistorial();
  const av = document.getElementById('simAviso');
  if(av && !simHasIA()) av.textContent = 'Sin acceso a la IA â€” configura el proxy o la API key en Mi cuenta para poder correr el panel.';
}

// Ãšltimo contexto puesto automÃ¡ticamente. Sirve para distinguir "el usuario no lo
// tocÃ³" de "lo editÃ³ a mano": pisar una ediciÃ³n al cambiar de lÃ­nea y volver hacÃ­a
// perder el texto sin aviso.
let _simCtxAuto = '';

function simLineaChange(){
  const k = document.getElementById('simLinea')?.value || 'lamparas';
  const L = SIM_LINEAS[k] || SIM_LINEAS.lamparas;
  const ctx = document.getElementById('simContexto');
  if(ctx){
    const editado = ctx.value.trim() && ctx.value !== _simCtxAuto;
    if(!editado || confirm('Editaste el contexto a mano. Â¿Reemplazarlo por el de esta lÃ­nea?')){
      ctx.value = L.contexto;
      _simCtxAuto = L.contexto;
    }
  }
  const pub = document.getElementById('simPublico');
  if(pub) pub.value = L.publico;
  simEstimar();
}

function simEstimar(){
  const base = _simParseConceptos(document.getElementById('simConceptos')?.value);
  const precios = _simParseBarrido(document.getElementById('simBarrido')?.value);
  const conceptos = _simExpandir(base, precios);
  const publico = document.getElementById('simPublico')?.value || 'ambos';
  const perfiles = _simPerfiles(publico);
  const el = document.getElementById('simEstimado');
  if(!el) return;
  if(!conceptos.length){ el.textContent = 'Escribe al menos un concepto.'; return; }
  const detalle = precios.length
    ? `${base.length} concepto${base.length>1?'s':''} Ã— ${precios.length} precios = ${conceptos.length} corridas`
    : `${conceptos.length} concepto${conceptos.length>1?'s':''}`;
  el.textContent = `${detalle} Ã— ${perfiles.length} perfiles Â· costo estimado â‰ˆ $${_simCosto(conceptos.length, perfiles.length).toLocaleString('es-CL')} CLP`;
}

// â”€â”€ CORRIDA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function simCorrer(){
  if(_simBusy) return;
  if(!simHasIA()){ toast('Sin acceso a la IA â€” configÃºralo en Mi cuenta','error'); return; }
  const base = _simParseConceptos(document.getElementById('simConceptos')?.value);
  if(!base.length){ toast('Escribe al menos un concepto','error'); return; }
  const precios = _simParseBarrido(document.getElementById('simBarrido')?.value);
  const conceptos = _simExpandir(base, precios);
  if(precios.length && base.length*precios.length > SIM_MAX_CONCEPTOS){
    toast(`Barrido recortado a ${SIM_MAX_CONCEPTOS} combinaciones`,'info');
  }

  const lineaKey = document.getElementById('simLinea')?.value || 'lamparas';
  const linea = SIM_LINEAS[lineaKey]?.nombre || lineaKey;
  const contexto = (document.getElementById('simContexto')?.value || '').trim();
  if(!contexto){ toast('Describe el contexto de la lÃ­nea','error'); return; }
  const publico = document.getElementById('simPublico')?.value || 'ambos';
  const perfiles = _simPerfiles(publico);

  _simBusy = true; _simAbort = false;
  const btn = document.getElementById('simCorrerBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'â³ Corriendoâ€¦'; }
  const stop = document.getElementById('simDetenerBtn');
  if(stop) stop.style.display = 'inline-flex';

  const resultados = new Array(conceptos.length).fill(null);
  let hechos = 0, fallidos = 0, reintentos = 0;
  const progreso = (msg)=>{ const p = document.getElementById('simProgreso'); if(p) p.textContent = msg; };
  progreso(`0 de ${conceptos.length} conceptosâ€¦`);

  // Cola con concurrencia acotada: 25 llamadas en paralelo se comen el rate limit.
  let cursor = 0;
  async function worker(){
    while(cursor < conceptos.length && !_simAbort){
      const i = cursor++;
      const c = conceptos[i];
      try{
        const prompt = _simUserPrompt(linea, contexto, c.nombre, c.precio, perfiles);
        const tope = _simMaxTokens(perfiles.length);
        let r = await _simClaude(SIM_SYSTEM, prompt, tope);
        let p = _simParse(r.texto, perfiles);
        // Un panel a medias da un porcentaje inflado. Antes de rendirse, un
        // reintento con el doble de techo: casi siempre el problema era el corte.
        if(r.truncado || p.votos.length < perfiles.length * SIM_COBERTURA_MIN/100){
          reintentos++;
          const r2 = await _simClaude(SIM_SYSTEM, prompt, Math.min(8000, tope*2));
          const p2 = _simParse(r2.texto, perfiles);
          if(p2.votos.length > p.votos.length){ r = r2; p = p2; }
        }
        if(!p.votos.length) throw new Error('la IA no devolviÃ³ votos legibles');
        resultados[i] = _simAgrega(c.nombre, c.precio, p.votos, p.resumen, perfiles.length, {base:c.base||c.nombre});
      }catch(e){
        fallidos++;
        resultados[i] = {concepto:c.nombre, precio:c.precio, base:c.base||c.nombre, error:String(e.message||e), veredicto:'error', n:0, esperados:perfiles.length, cobertura:0, promedio:0, pctCompra:0, votos:[]};
      }
      hechos++;
      progreso(`${hechos} de ${conceptos.length} conceptosâ€¦`);
    }
  }
  await Promise.all(Array.from({length:Math.min(SIM_CONCURRENCIA, conceptos.length)}, worker));

  _simBusy = false;
  if(btn){ btn.disabled = false; btn.textContent = 'â–¶ Correr panel'; }
  if(stop) stop.style.display = 'none';
  progreso(_simAbort ? 'Detenido.' : '');

  const items = resultados.filter(Boolean);
  if(!items.length){ toast('No se pudo correr ningÃºn concepto','error'); return; }

  _simRun = {
    id: 'sim_' + Date.now(),
    fecha: hoyCL(),   // nunca toISOString(): en UTC el dÃ­a cambia a las 21:00 en Chile
    ts: Date.now(),
    linea, lineaKey, contexto, publico,
    panel: SIM_PANEL_VERSION,
    nPerfiles: perfiles.length,
    barrido: precios,
    items,
  };
  renderSimResultados(_simRun);
  simGuardar(_simRun);
  const incompletos = items.filter(i=>i.veredicto === 'incompleto').length;
  if(fallidos) toast(`${fallidos} concepto(s) fallaron â€” revisa el detalle`,'error');
  else if(incompletos) toast(`${incompletos} concepto(s) sin panel completo â€” sin veredicto`,'error');
  else toast(`âœ“ Panel corrido: ${items.length} concepto(s)`+(reintentos?` (${reintentos} reintento/s)`:''),'success');
}

// No aborta lo que ya saliÃ³: esas llamadas se pagan igual. Se dice en el toast
// para que nadie crea que detener es gratis.
function simDetener(){ _simAbort = true; toast('Se detiene al terminar los conceptos en vuelo (esos se cobran igual)','info'); }

// â”€â”€ RENDER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SIM_VEREDICTO_UI = {
  descartar:  {label:'DESCARTAR',  color:'#ff4444', bg:'rgba(255,68,68,.10)',  borde:'rgba(255,68,68,.35)'},
  dudoso:     {label:'DUDOSO',     color:'#f5a524', bg:'rgba(245,165,36,.10)', borde:'rgba(245,165,36,.35)'},
  prototipar: {label:'PROTOTIPAR', color:'#00d4aa', bg:'rgba(0,212,m«ëŒ+Š×®º+º$zzb¥æâæÆVæwF‡Òæò“Â÷7VÖÖ'“à¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£‡ƒ¶Ö‚Ö†V–v‡C£3#ƒ¶÷fW&fÆ÷s¦WFò#à¢G¶—Bçf÷F÷2ç6Æ–6R‚’ç6÷'B‚†Æ"“Óæ"æ6ö×&Öæ6ö×&’æÖ‡cÓç°¢6öç7BÒ4”ÕõU$d”ÄU2æf–æB‡ƒÓç‚æ–CÓÓ×bæ–B“°¢6öç7B2Òbæ6ö×&ãÓBòr3CFr¢‡bæ6ö×&ÃÓòr6fcf#f"r¢wf"‚Ò×FW‡C"’r“°¢&WGW&âÆF—b7G–ÆSÒ'FF–æs£g‚¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶föçB×6—¦S£ãWƒ¶Æ–æRÖ†V–v‡C£ãR#à¢Ç7â7G–ÆSÒ&6öÆ÷#¢G¶7Ó¶föçB×vV–v‡C£s#âG·bæ6ö×&ÓÂ÷7ãà¢Ç7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2’#â+rG·bæ–GÓÂ÷7ãà¢Ç7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2’#âG·òr+rr¶W66T‡FÖÂ‡æFW62ç7Æ—B‚râr•³Ò“¢rwÓÂ÷7ãà¢ÆF—b7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C"’#âG¶W66T‡FÖÂ‡bæg&Væ÷ÇÂrr—ÓÂöF—cà¢G·bæÇFW&æF—föÆF—b7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2“¶föçB×6—¦S£‚#äVâfW£¢G¶W66T‡FÖÂ‡bæÇFW&æF—f—ÓÂöF—cæ¢rwĞ¢ÂöF—cæ°¢Ò’æ¦ö–â‚rr—Ğ¢ÂöF—cà¢ÂöFWF–Ç3æĞ¢ÂöF—cà¢ÂöF—cæ°§Ğ ¢òò)H)H5U%dDR$T4”ò)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢òòVÂVçG&Vv&ÆRFVÂ&'&–Fó¢VÂÖ—6Öò6öæ6WFòf&–÷2&V6–÷2Â&fW"L;6æFR6P¢òò6RÆ–çFVæ6œ;6ââW2ÆòVRæò6RÆVR&–VâVâVÂ&æ¶–ærÂ÷'VRÆ2f&–çFW0¢òòVVFâ&W'F–F2VçG&R÷G&÷26öæ6WF÷2à¦gVæ7F–öâ÷6–Ô7W'f&V6–ò‡'Vâ—°¢–b‚'Vâæ&'&–FòÇÂ'Vâæ&'&–FòæÆVæwF‚’&WGW&ârs°¢6öç7Bw'W÷2ÒæWrÖ‚“°¢f÷"†6öç7B—Böb'Vâæ—FV×2—°¢–b†—BçfW&VF–7FòÓÓÒvW'&÷"rÇÂ—BçfW&VF–7FòÓÓÒv–æ6ö×ÆWFòr’6öçF–çVS°¢–b‚w'W÷2æ†2†—Bæ&6WÇÆ—Bæ6öæ6WFò’’w'W÷2ç6WB†—Bæ&6WÇÆ—Bæ6öæ6WFòÂµÒ“°¢w'W÷2ævWB†—Bæ&6WÇÆ—Bæ6öæ6WFò’çW6‚†—B“°¢Ğ¢–b‚w'W÷2ç6—¦R’&WGW&ârs°¢6öç7Bf–Æ2Ò²ââæw'W÷2æVçG&–W2‚•ÒæÖ‚…¶æöÖ'&RÂg5Ò“Óç°¢6öç7B÷&FVâÒg2ç6Æ–6R‚’ç6÷'B‚†Æ"“Óæç&V6–òÖ"ç&V6–ò“°¢6öç7BÖV¦÷"Ò÷&FVâç&VGV6R‚†Æ"“Óæ"ç7D6ö×&âç7D6ö×&ò"¢Â÷&FVå³Ò“°¢&WGW&âÇG#à¢ÇFB7G–ÆSÒ'FF–æs£w‚ƒ¶föçB×6—¦S£'ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#âG¶W66T‡FÖÂ†æöÖ'&R—ÓÂ÷FCà¢G¶÷&FVâæÖ‡cÓæÇFB7G–ÆSÒ'FF–æs£w‚ƒ·FW‡BÖÆ–vã¦6VçFW#¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·v†—FR×76S¦æ÷w&#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£7ƒ¶föçB×vV–v‡C£s¶6öÆ÷#¢G·cÓÓÖÖV¦÷#òr3CFs¢wf"‚Ò×FW‡C"’wÒ#âG·bç7D6ö×&ÒSÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#âGµ÷6–ÔÖöæVF‡bç&V6–ò—ÓÂöF—cà¢Â÷FCæ’æ¦ö–â‚rr—Ğ¢Â÷G#æ°¢Ò’æ¦ö–â‚rr“°¢&WGW&âÆF—b6Æ73Ò&6&B"7G–ÆSÒ&Ö&v–âÖ&÷GFöÓ£g‚#à¢ÆF—b6Æ73Ò&6&BÖ†VFW"#ãÇ7â6Æ73Ò&6&B×F—FÆR#ä7W'fFR&V6–óÂ÷7ãà¢Ç7â6Æ73Ò&&FvR&FvR×W'ÆR#âG·'Vâæ&'&–FòæÖ‡Óå÷6–ÔÖöæVF‡’’æ¦ö–â‚r+rr—ÓÂ÷7ããÂöF—cà¢ÆF—b7G–ÆSÒ'FF–æs£G‚gƒ¶÷fW&fÆ÷r×ƒ¦WFò#à¢ÇF&ÆR7G–ÆSÒ'v–GFƒ£S¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6R#ãÇF&öG“âG¶f–Æ7ÓÂ÷F&öG“ãÂ÷F&ÆSà¢ÂöF—cà¢ÆF—b7G–ÆSÒ'FF–æs£‡‚g‚'ƒ¶föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶Æ–æRÖ†V–v‡C£ãR#à¢VâfW&FRVÂ&V6–ò6öâÜ:2–çFVæ6œ;6âFR6ö×&FR6F6öæ6WFòâ6’Æ–çFVæ6œ;6â66’æò&¦Â7V&—"VÂ&V6–òÀ¢W7L:2FV¦æFòÆFVâÆÖW6²6’6RFW7ÆöÖVçG&RF÷2W66ÆöæW2ÂŒ:ÒW7L:GRFV6†òà¢ÂöF—cà¢ÂöF—cæ°§Ğ ¦gVæ7F–öâ6–Ô6÷–%&W7VÖVâ‚—°¢–b‚÷6–Õ'Vâ—²Fö7B‚tæò†’6÷'&–F&6÷–"rÂvW'&÷"r“²&WGW&ã²Ğ¢6öç7BÂÒ¶æVÂ6–çL:—F–6ò(	BGµ÷6–Õ'VâæÆ–æVÒ(	BGµ÷6–Õ'VâæfV6†Ò(	BGµ÷6–Õ'VâæåW&f–ÆW7ÒW&f–ÆW6ÂruÓ°¢²ââå÷6–Õ'Vâæ—FV×5Òç6÷'B‚†Æ"“Óæç7D6ö×&Ö"ç7D6ö×&’æf÷$V6‚†—CÓç°¢–b†—BçfW&VF–7FòÓÓÒvW'&÷"r—²ÂçW6‚†´U%$õ%ÒG¶—Bæ6öæ6WF÷Ö“²&WGW&ã²Ğ¢ÂçW6‚†²G²…4”ÕõdU$TD”5DõõT•¶—BçfW&VF–7Fõ×ÇÇ·Ò’æÆ&VÇÕÒG¶—Bæ6öæ6WF÷Ò(	BGµ÷6–ÔÖöæVF†—Bç&V6–ò—Ò(	BG¶—Bç7D6ö×&ÒR6ö×&,:ÖÂæ÷FG¶—Bç&öÖVF–òçFôf—†VBƒ—Ö“°¢–b†—Bæg&Væ÷2’ÂçW6‚†g&Væ÷3¢G¶—Bæg&Væ÷7Ö“°¢–b†—Bæ6ö×&F÷"’ÂçW6‚†6ö×&¢G¶—Bæ6ö×&F÷'Ö“°¢–b†—Bç&V6–õ7VvW&–Fò’ÂçW6‚†&V6–ó¢G¶—Bç&V6–õ7VvW&–F÷Ö“°¢ÂçW6‚‚rr“°¢Ò“°¢æf–vF÷"æ6Æ—&ö&Bçw&—FUFW‡B†Âæ¦ö–â‚uÆâr’’çF†Vâ‚‚“ÓçFö7B‚t6÷–Fò)É2rÂw7V66W72r’’æ6F6‚‚‚“ÓçFö7B‚tæò6RVFò6÷–"rÂvW'&÷"r’“°§Ğ ¢òò)H)H„•5Dõ$”Â)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢òòÆö6Å7F÷&vR²&W7ÆFòVâÖöæ—F÷"6—7FVÖ†Ö—6ÖòG,;6âVRÆvVæF’Â&¢òòVRVÂ†—7F÷&–Â6ö'&Wf—fÆ–×–"Æ66Œ:’6–âVF—"VæF&ÆçVWfà¦6öç7B4”Õô„•5Eô´U’ÒwF†VÆ%÷6–×VÆ6–öå÷cs°¦6öç7B4”Õô„•5EôÔ‚Ò3° ¦gVæ7F–öâ÷6–Ô†—7B‚—²G'—²&WGW&â¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ…4”Õô„•5Eô´U’—ÇÂuµÒr“²Ö6F6‚†R—²&WGW&âµÓ²ÒĞ ¢òòwV&F6öÆòVÂw&VvFòÂæòÆ÷2CBf÷F÷27'VF÷2FR6F6öæ6WFó¢VÂ&W7ÆFğ¢òò&VÖ÷FòF–VæRF÷RFRFÖ;ò’VÂFWFÆÆRæò6RW6&6ö×&"6÷'&–F2à¦gVæ7F–öâ6–ÔwV&F"‡'Vâ—°¢6öç7BÆ—f–æòÒ°¢–C§'Vâæ–BÂfV6†§'VâæfV6†ÂG3§'VâçG2ÂÆ–æV§'VâæÆ–æVÂÆ–æV¶W“§'VâæÆ–æV¶W’À¢V&Æ–6ó§'VâçV&Æ–6òÂæVÃ§'VâçæVÂÂåW&f–ÆW3§'VâæåW&f–ÆW2Â&'&–Fó§'Vâæ&'&–F÷ÇÅµÒÀ¢—FV×3¢'Vâæ—FV×2æÖ†“Óâ‡¶6öæ6WFó¦’æ6öæ6WFòÂ&6S¦’æ&6RÂ&V6–ó¦’ç&V6–òÂfW&VF–7Fó¦’çfW&VF–7FòÂ7D6ö×&¦’ç7D6ö×&Â&öÖVF–ó¦’ç&öÖVF–òÂ6ö&W'GW&¦’æ6ö&W'GW&ÂW7W&F÷3¦’æW7W&F÷2Âg&Væ÷3¦’æg&Væ÷2Â6ö×&F÷#¦’æ6ö×&F÷"Â&V6–õ7VvW&–Fó¦’ç&V6–õ7VvW&–F÷Ò’’À¢Ó°¢6öç7B'"Ò¶Æ—f–æòÂââå÷6–Ô†—7B‚•Òç6Æ–6RƒÂ4”Õô„•5EôÔ‚“°¢G'—²Æö6Å7F÷&vRç6WD—FVÒ…4”Õô„•5Eô´U’Â¥4ôâç7G&–æv–g’†'"’“²Ö6F6‚†R—·Ğ¢&VæFW%6–Ô†—7F÷&–Â‚“°¢÷6–Õ&W7ÆF"†'"“°§Ğ ¢òò&W7ÆFò&VÖ÷Fò&W7BÖVff÷'BâF÷27V–FF÷3 ¢òò+röÖöæ—F÷%W6W'BFWgVVÇfRVæ&öÖW6¢VâG'’ö6F6‚<:Öæ7&öæòäòG&7P¢òò&V6†¦ò’6RW666öÖòVæ†æFÆVB&V¦V7F–öâà¢òò+rÖ&¶WF–æræòF–VæRW67&—GW&vÆö&Â’tÖöæ—F÷"6—7FVÖræòW7L:VâÆ÷0¢òò6'fRÖ÷WG2FR&VFW2ôæWw6ÆWGFW"Â<:ÒVR—'F&ÆUw&—FRÆç¦’66VâFö7@¢òò&ö¦òVâ6F6÷'&–Fâ6’VÂ&öÂæòVVFRW67&–&—"Âæ’6R–çFVçFà¦gVæ7F–öâ÷6–Õ&W7ÆF"†'"—°¢G'—°¢–b‡G—VöböÖöæ—F÷%W6W'BÓÒvgVæ7F–öâr’&WGW&ã°¢6öç7BRÒ‡G—VöbUD‚ÓÒwVæFVf–æVBrbbUD‚ævWEW6W"’òUD‚ævWEW6W"‚’¢çVÆÃ°¢–b‡RbbG—Vöb$$2ÓÒwVæFVf–æVBrbb$$2æ6åw&—FUF&ÆRbb$$2æ6åw&—FUF&ÆR‡Rç&öÆRÂtÖöæ—F÷"6—7FVÖr’’&WGW&ã°¢&öÖ—6Rç&W6öÇfR…öÖöæ—F÷%W6W'B‚u4”ÕTÄ4”ôârÂ¥4ôâç7G&–æv–g’†'"’ç6Æ–6RƒÃ“S’Âw6–Õ&V6÷&D–Br’’æ6F6‚‚‚“Óç·Ò“°¢Ö6F6‚†R—·Ğ§Ğ ¢òò6÷'&–F”äÔTD”DÔTåDRåDU$”õ"FRÆÖ—6ÖÌ:ÖæVÂ–æFW†F÷"6öæ6WFòà¢òòFV&Rf–ÇG&'6R÷"G3¢çFW2FöÖ&ÆÜ:2çVWfFVÂ†—7F÷&–ÂÂ<:ÒVRÂ'&— ¢òòVæ6÷'&–Ff–V¦Æ6ö×&&6öçG&Væ÷7FW&–÷"’Ö÷7G&&VÂFVÇFÂ&Wl:—2à¦gVæ7F–öâ÷6–Õ&Wf–‡'Vâ—°¢6öç7B&WbÒ÷6–Ô†—7B‚¢æf–ÇFW"†ƒÓæ‚æÆ–æV¶W“ÓÓ×'VâæÆ–æV¶W’bb‚æ–BÓ×'Vâæ–Bbb‚çæVÃÓÓ×'VâçæVÂbb‚çG2Â'VâçG2¢ç6÷'B‚†Æ"“Óæ"çG2ÒçG2•³Ó°¢–b‚&Wb’&WGW&âçVÆÃ°¢6öç7BÖÒ·Ó°¢&Wbæ—FV×2æf÷$V6‚†“Óç²Ö¶’æ6öæ6WFõÒÒ“²Ò“°¢&WGW&âÖ°§Ğ ¦gVæ7F–öâ&VæFW%6–Ô†—7F÷&–Â‚—°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w6–Ô†—7F÷&–Âr“°¢–b‚VÂ’&WGW&ã°¢6öç7B‚Ò÷6–Ô†—7B‚“°¢–b‚‚æÆVæwF‚—²VÂæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ'FF–æs£G‚gƒ¶föçB×6—¦S£'ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#å6–â6÷'&–F2FöFl:ÖãÂöF—câs²&WGW&ã²Ğ¢VÂæ–ææW$…DÔÂÒ‚æÖ‡#Óç°¢6öç7BBÒ"æ—FV×2æf–ÇFW"†“Óæ’çfW&VF–7FóÓÓÒvFW66'F"r’æÆVæwFƒ°¢6öç7BÒ"æ—FV×2æf–ÇFW"†“Óæ’çfW&VF–7FóÓÓÒw&÷F÷F—"r’æÆVæwFƒ°¢&WGW&âÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£ƒ¶Æ–vâÖ—FV×3¦6VçFW#·FF–æs£—‚gƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶föçB×6—¦S£'‚#à¢ÆF—b7G–ÆSÒ&Ö–â×v–GFƒ£#à¢ÆF—b7G–ÆSÒ&föçB×vV–v‡C£c#âG¶W66T‡FÖÂ‡"æÆ–æV—ÓÂöF—cà¢ÆF—b7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2“¶föçB×6—¦S£‚#âG¶W66T‡FÖÂ…÷6–ÔfV6†4Â‡"æfV6†’—Ò+rG·"æ—FV×2æÆVæwF‡Ò6öæ6WF÷2+rG·"æåW&f–ÆW7ÒW&f–ÆW3ÂöF—cà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£gƒ¶Æ–vâÖ—FV×3¦6VçFW#¶fÆW‚×6‡&–æ³£#à¢Ç7â6Æ73Ò&&FvR"7G–ÆSÒ&&6¶w&÷VæC§&v&ƒ#SRÃc‚Ãc‚Âã"“¶6öÆ÷#¢6fcf#f"#âG¶GÒFW66'F#Â÷7ãà¢Ç7â6Æ73Ò&&FvR"7G–ÆSÒ&&6¶w&÷VæC§&v&ƒÃ#"ÃsÂã"“¶6öÆ÷#¢3CF#âG·Ò&÷F÷F—#Â÷7ãà¢Æ'WGFöâ6Æ73Ò&'Fâ'FâÖv†÷7B'Fâ×6Ò"öæ6Æ–6³Ò'6–ÕfW$†—7F÷&–Â‚rG·"æ–GÒr’#åfW#Âö'WGFöãà¢ÂöF—cà¢ÂöF—cæ°¢Ò’æ¦ö–â‚rr“°§Ğ ¢òòfV6†2VâDBÔÔÒÔ†6öçfVæ6œ;6âFVÂ&÷–V7Fò’âVÂ†—7F÷&–ÂwV&F•4òà¦gVæ7F–öâ÷6–ÔfV6†4Â†b—°¢6öç7BÒÒ7G&–ær†gÇÂrr’æÖF6‚‚õâ…ÆG³GÒ’Ò…ÆG³'Ò’Ò…ÆG³'Ò’ò“°¢&WGW&âÒòG¶Õ³5×ÒÒG¶Õ³%×ÒÒG¶Õ³×Ö¢7G&–ær†gÇÂrr“°§Ğ ¦gVæ7F–öâ6–ÕfW$†—7F÷&–Â†–B—°¢6öç7B"Ò÷6–Ô†—7B‚’æf–æB‡ƒÓç‚æ–CÓÓÖ–B“°¢–b‚"—²Fö7B‚t6÷'&–FæòVæ6öçG&FrÂvW'&÷"r“²&WGW&ã²Ğ¢òòVÂ†—7F÷&–ÂæòwV&FÆ÷2f÷F÷27'VF÷3¢6R&R×&VæFW&—¦VÂw&VvFò’Æ¢òòF&¦WFöÖ—FRVÂ&Æ÷VRFRFWFÆÆRVâfW¢FR&öÖWFW"f÷F÷2VRæòF–VæRà¢&VæFW%6–Õ&W7VÇFF÷2‡²ââç"Â—FV×3§"æ—FV×2æÖ†“Óâ‡²ââæ’Âã¦’æçÇÇ"æåW&f–ÆW2ÂW7W&F÷3¦’æW7W&F÷7ÇÇ"æåW&f–ÆW2Âf÷F÷3¥µ×Ò’—Ò“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚w6–Õ&W7VÇFF÷2r“òç67&öÆÄ–çFõf–Wr‡¶&V†f–÷#¢w6Öö÷F‚rÂ&Æö6³¢w7F'BwÒ“°§Ğ ¦gVæ7F–öâ6–Ô&÷'&$†—7F÷&–Â‚—°¢–b‚6öæf—&Ò‚|+ô&÷'&"VÂ†—7F÷&–Â6ö×ÆWFòFR6÷'&–F3òæò6RVVFRFW6†6W"âr’’&WGW&ã°¢G'—²Æö6Å7F÷&vRç&VÖ÷fT—FVÒ…4”Õô„•5Eô´U’“²Ö6F6‚†R—·Ğ¢÷6–Õ&W7ÆF"…µÒ“°¢&VæFW%6–Ô†—7F÷&–Â‚“°¢Fö7B‚t†—7F÷&–Â&÷'&FòrÂv–æfòr“°§Ğ