/* js/simulacion.js — Simulación de demanda: panel sintético para probar líneas de producto.
 *
 * QUÉ ES: un panel fijo de 44 perfiles chilenos escritos a mano. Le das conceptos
 * de producto con precio y cada perfil dice si lo compraría, qué lo frena y en qué
 * gastaría esa plata en vez. Sirve para DESCARTAR conceptos antes de fabricar
 * prototipos, no para elegir al ganador.
 *
 * QUÉ NO ES: no mide estética (los perfiles no ven el producto, leen una
 * descripción) ni predice ventas. Ver docs/SIMULACION.md.
 *
 * POR QUÉ LOS PERFILES SON FIJOS Y NO GENERADOS POR IA: si el panel cambia en cada
 * corrida, la corrida del lunes no se puede comparar con la del viernes. Fijos =
 * reproducible. Editarlos es una decisión consciente que invalida el historial
 * previo, por eso SIM_PANEL_VERSION se sube a mano cuando se tocan.
 */

// ── PANEL DE PERFILES ──────────────────────────────────────────
// Subir esta versión al editar SIM_PERFILES: las corridas guardadas registran con
// qué panel se hicieron, para no comparar peras con manzanas.
const SIM_PANEL_VERSION = 1;

// tope = gasto que el perfil hace sin pensarlo dos veces (CLP). Es el ancla de
// precio del panel: sobre ese monto el perfil tiene que justificar la compra.
const SIM_PERFILES = [
  // ── Consumidor final (28) ──
  {id:'C01', tipo:'consumidor', tope:30000,  desc:'Javiera, 27, Ñuñoa. Diseñadora. Arrienda depto 1D con su pareja. Hogar $1.400.000. Le gusta la deco pero compara precios en 4 tiendas antes de comprar.'},
  {id:'C02', tipo:'consumidor', tope:20000,  desc:'Matías, 34, Maipú. Técnico eléctrico. Casa propia, hijos de 3 y 6 años. Hogar $1.900.000. Prioriza lo práctico y lo que no se rompa con niños.'},
  {id:'C03', tipo:'consumidor', tope:80000,  desc:'Camila, 41, Providencia. Abogada. Depto propio 2D, vive sola. Hogar $3.200.000. Compra diseño y marca, le importa que no se vea barato.'},
  {id:'C04', tipo:'consumidor', tope:12000,  desc:'Rodrigo, 23, Santiago Centro. Estudiante con part time. Arrienda una pieza. Hogar $450.000. Compra casi todo en Temu y AliExpress.'},
  {id:'C05', tipo:'consumidor', tope:25000,  desc:'Paulina, 38, La Florida. Enfermera. Casa arrendada, 2 hijos. Hogar $1.600.000. Compra en Falabella con CMR en cuotas sin interés.'},
  {id:'C06', tipo:'consumidor', tope:120000, desc:'Ignacio, 31, Las Condes. Ingeniero TI. Depto propio, pareja sin hijos. Hogar $4.200.000. Gamer, arma su setup, paga por lo que se ve bien en cámara.'},
  {id:'C07', tipo:'consumidor', tope:35000,  desc:'Fernanda, 29, Viña del Mar. Community manager. Arrienda depto. Hogar $1.100.000. Vive en Instagram, compra por impulso si es fotogénico.'},
  {id:'C08', tipo:'consumidor', tope:30000,  desc:'Héctor, 52, Puente Alto. Contratista. Casa propia. Hogar $2.100.000. Desconfía de lo caro sin garantía y de las marcas que no conoce.'},
  {id:'C09', tipo:'consumidor', tope:18000,  desc:'Antonia, 26, Concepción. Profesora. Arrienda con una amiga. Hogar $900.000. Prefiere regalos artesanales y de ferias.'},
  {id:'C10', tipo:'consumidor', tope:250000, desc:'Cristián, 45, Vitacura. Gerente comercial. Casa propia, 3 hijos. Hogar $6.500.000. Compra rápido y sin regatear si le resuelve un problema.'},
  {id:'C11', tipo:'consumidor', tope:45000,  desc:'Daniela, 33, San Miguel. Kinesióloga. Depto propio 2D con su pareja. Hogar $2.400.000. Está ahorrando para remodelar la cocina.'},
  {id:'C12', tipo:'consumidor', tope:25000,  desc:'Sebastián, 39, Temuco. Dueño de minimarket. Casa propia. Hogar $1.800.000. Mide todo en costo/beneficio, pregunta cuánto dura.'},
  {id:'C13', tipo:'consumidor', tope:20000,  desc:'Valentina, 24, Independencia. Diseñadora freelance. Arrienda depto chico. Hogar $700.000. Gusto fuerte por lo alternativo, odia lo genérico.'},
  {id:'C14', tipo:'consumidor', tope:30000,  desc:'Marcelo, 47, La Serena. Funcionario público. Casa propia, 2 adolescentes. Hogar $2.000.000. Compra en el mall, desconfía de comprar online.'},
  {id:'C15', tipo:'consumidor', tope:40000,  desc:'Constanza, 30, Ñuñoa. Publicista. Arrienda un loft. Hogar $1.700.000. Cero espacio libre: todo lo que entra tiene que reemplazar algo.'},
  {id:'C16', tipo:'consumidor', tope:90000,  desc:'Álvaro, 36, Antofagasta. Supervisor minero, turnos 7x7. Casa propia. Hogar $3.500.000. Compra online porque no alcanza a ir a tiendas.'},
  {id:'C17', tipo:'consumidor', tope:50000,  desc:'Josefa, 28, Providencia. Médica en formación. Arrienda. Hogar $1.500.000. Sin tiempo, compra regalos a última hora y con despacho rápido.'},
  {id:'C18', tipo:'consumidor', tope:15000,  desc:'Nicolás, 42, Peñalolén. Jefe de bodega. Casa propia con patio. Hogar $1.700.000. Hace las cosas él mismo antes que comprarlas hechas.'},
  {id:'C19', tipo:'consumidor', tope:150000, desc:'Trinidad, 35, Las Condes. Dueña de casa, 2 hijos chicos. Hogar $5.000.000. Redecora por temporada y sigue cuentas de interiorismo.'},
  {id:'C20', tipo:'consumidor', tope:15000,  desc:'Felipe, 25, Valparaíso. Barista. Arrienda con 2 amigos. Hogar $800.000. Estética retro y vintage, compra en ferias persa.'},
  {id:'C21', tipo:'consumidor', tope:28000,  desc:'Macarena, 44, Rancagua. Jefa administrativa. Casa propia. Hogar $2.200.000. Compra los regalos de cumpleaños de la oficina.'},
  {id:'C22', tipo:'consumidor', tope:70000,  desc:'Tomás, 32, Santiago Centro. Arquitecto. Depto arrendado. Hogar $2.000.000. Exigente con materiales y terminaciones, detecta el MDF a un metro.'},
  {id:'C23', tipo:'consumidor', tope:35000,  desc:'Bárbara, 37, Quilpué. Contadora. Casa propia, 1 hijo. Hogar $1.900.000. Solo compra si hay cuotas sin interés.'},
  {id:'C24', tipo:'consumidor', tope:200000, desc:'Gonzalo, 55, La Reina. Dentista. Casa propia, hijos grandes. Hogar $5.500.000. Colecciona objetos de diseño y paga por piezas únicas.'},
  {id:'C25', tipo:'consumidor', tope:10000,  desc:'Catalina, 22, Ñuñoa. Estudiante universitaria, vive con sus papás. Mesada $200.000. Decora su pieza con lo que alcanza.'},
  {id:'C26', tipo:'consumidor', tope:8000,   desc:'Andrés, 40, Maipú. Conductor de app. Casa arrendada, 2 hijos. Hogar $1.200.000. No gasta en nada que no sea esencial.'},
  {id:'C27', tipo:'consumidor', tope:100000, desc:'Isidora, 34, Lo Barnechea. Tiene una tienda online de deco. Casa propia. Hogar $4.000.000. Evalúa todo pensando si lo revendería.'},
  {id:'C28', tipo:'consumidor', tope:40000,  desc:'Pablo, 29, Estación Central. Ingeniero junior. Arrienda depto nuevo chico con su pareja. Hogar $1.600.000. Primer depto, lo está amoblando de a poco.'},
  // ── Negocio (16) — el "tope" acá es el presupuesto de la compra, no el anual ──
  {id:'N01', tipo:'negocio', tope:250000,  desc:'Café de especialidad, Barrio Italia, 6 mesas. Dueña de 34. Invierte en ambiente porque su clientela va a fotografiar el local.'},
  {id:'N02', tipo:'negocio', tope:120000,  desc:'Restaurant familiar, Maipú, 20 mesas. Dueño de 50. Todo tiene que durar, resistir grasa y poder lavarse.'},
  {id:'N03', tipo:'negocio', tope:200000,  desc:'Barbería, Providencia, 4 sillones. Dueño de 31. Estética muy cuidada, publica todo en Instagram.'},
  {id:'N04', tipo:'negocio', tope:900000,  desc:'Agencia de marketing, Las Condes, 25 personas. Compra regalos corporativos de fin de año para clientes y equipo.'},
  {id:'N05', tipo:'negocio', tope:700000,  desc:'Hotel boutique, Valparaíso, 12 habitaciones. Busca identidad local y piezas que los huéspedes comenten.'},
  {id:'N06', tipo:'negocio', tope:60000,   desc:'Peluquería de barrio, Puente Alto, 3 puestos. Dueña de 45. Presupuesto muy apretado, compra de a poco.'},
  {id:'N07', tipo:'negocio', tope:400000,  desc:'Startup SaaS, Santiago Centro, 12 personas en cowork. Le importa la cultura de marca y el onboarding de nuevos.'},
  {id:'N08', tipo:'negocio', tope:250000,  desc:'Clínica dental, Ñuñoa. Necesita verse limpia, profesional y confiable. Evita lo estridente.'},
  {id:'N09', tipo:'negocio', tope:350000,  desc:'Bar cervecero, Bellavista. Ambiente nocturno, busca luz de impacto y piezas que se vean en fotos con poca luz.'},
  {id:'N10', tipo:'negocio', tope:100000,  desc:'Gimnasio de barrio, La Florida. Dueño de 38. Invierte solo en lo que retiene socios.'},
  {id:'N11', tipo:'negocio', tope:1500000, desc:'Constructora, Vitacura, 80 personas. Compra premios de seguridad, galvanos y señalética de faena.'},
  {id:'N12', tipo:'negocio', tope:600000,  desc:'Tienda de ropa, 4 locales en malls. Cambia la vitrina cada temporada y necesita reponer rápido.'},
  {id:'N13', tipo:'negocio', tope:250000,  desc:'Colegio particular subvencionado, San Bernardo. Compra trofeos, medallas y galvanos para actos y campeonatos.'},
  {id:'N14', tipo:'negocio', tope:1200000, desc:'Productora de eventos, Providencia. Arma premiaciones corporativas y necesita volumen con fecha fija.'},
  {id:'N15', tipo:'negocio', tope:300000,  desc:'Cowork, Concepción, 40 puestos. Necesita señalética y deco que aguante rotación de gente.'},
  {id:'N16', tipo:'negocio', tope:50000,   desc:'Panadería de barrio, Quinta Normal. Dueño de 58. Solo compra si le demuestran que le sube las ventas.'},
];

// ── LÍNEAS DE PRODUCTO ─────────────────────────────────────────
// 'publico' filtra qué mitad del panel opina. Poner a un panadero a opinar sobre
// una lámpara de dormitorio ensucia el resultado.
const SIM_LINEAS = {
  lamparas:    {nombre:'Lámparas (THE LAMP)', publico:'ambos',      contexto:'Marca nueva de lámparas fabricadas por The Lab Solutions con impresión 3D, neón LED, acrílico y madera. Marca sin trayectoria ni reconocimiento. Venta online con despacho a todo Chile.'},
  trofeos:     {nombre:'Trofeos y premios',   publico:'negocio',    contexto:'Trofeos, galvanos y medallas personalizadas en acrílico, madera y resina. Fabricación a pedido con logo del cliente. Plazo típico 10 a 15 días hábiles.'},
  merch:       {nombre:'Merchandising corporativo', publico:'negocio', contexto:'Merchandising personalizado para empresas: objetos de escritorio, llaveros, soportes y regalos de fin de año. Pedidos desde 20 unidades.'},
  senaletica:  {nombre:'Señalética y letreros', publico:'negocio',  contexto:'Señalética interior, letreros corpóreos, cajas de luz y neón LED para locales y oficinas. Incluye instalación en Región Metropolitana.'},
  nfc:         {nombre:'NFC y tarjetas digitales', publico:'ambos', contexto:'Tarjetas y placas NFC: contacto digital, menús, reseñas de Google y perfiles. Requiere que el cliente entienda para qué sirve NFC.'},
  deco3d:      {nombre:'Deco e impresión 3D', publico:'consumidor', contexto:'Objetos de decoración impresos en 3D: maceteros, organizadores, figuras y piezas de pared. Venta online directa al consumidor.'},
  otra:        {nombre:'Otra línea (defínela abajo)', publico:'ambos', contexto:''},
};

// Modelo y costo. Haiku 4.5: ~US$1 por millón de tokens de entrada y ~US$5 de
// salida. Una corrida de 10 conceptos cuesta del orden de $80 CLP.
const SIM_MODEL = 'claude-haiku-4-5';
const SIM_USD_CLP = 980;   // referencia para mostrar el costo estimado; ajústalo si el dólar se mueve fuerte
const SIM_MAX_CONCEPTOS = 25;
const SIM_CONCURRENCIA = 3;   // conceptos en vuelo a la vez

let _simRun = null;        // corrida en curso o recién terminada
let _simBusy = false;
let _simAbort = false;

// ── ACCESO A LA IA ─────────────────────────────────────────────
// Reusa el proxy que ya existe (airtable-proxy expone /anthropic/v1/messages), así
// la API key no sale al navegador. No usa callClaude() del index porque ese está
// fijo en max_tokens 1500 y una corrida de 44 perfiles no cabe en eso.
// Techo de salida según el tamaño del panel. Antes era 3000 fijo: con 44 perfiles
// el margen quedaba apretado (44 líneas × ~40 tokens + resumen) y si el modelo se
// ponía verboso cortaba a media línea, perdiendo perfiles Y el bloque de resumen
// sin que nadie se enterara.
function _simMaxTokens(nPerfiles){ return Math.min(8000, nPerfiles*70 + 600); }

// Devuelve {texto, truncado}. `truncado` es la señal de que la respuesta se cortó
// por techo de tokens: sin ella, una respuesta parcial se procesa como completa.
async function _simClaude(system, user, maxTokens){
  const body = JSON.stringify({model:SIM_MODEL, max_tokens:maxTokens||3000, system, messages:[{role:'user', content:user}]});
  const px = (typeof _proxyCfg === 'function') ? _proxyCfg() : null;
  let r;
  if(px){
    r = await _claudeHttp(px.url+'/anthropic/v1/messages', {method:'POST', headers:{'Content-Type':'application/json','X-App-Key':px.key}, body});
  }else{
    const k = (typeof getAnthropicKey === 'function') ? getAnthropicKey() : '';
    if(!k) throw new Error('Sin acceso a la IA — configura el proxy o la API key en Mi cuenta');
    r = await _claudeHttp('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':k.replace(/[^\x20-\x7E]/g,'').trim(),'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body:new Blob([body],{type:'application/json'})
    });
  }
  if(!r.ok){const e = await r.json().catch(()=>({})); throw new Error(e.error?.message || `IA error ${r.status}`);}
  const j = await r.json();
  return {
    texto: j.content?.find(b=>b.type==='text')?.text || '',
    truncado: j.stop_reason === 'max_tokens',
  };
}

function simHasIA(){
  try{ return typeof hasClaudeAccess === 'function' ? hasClaudeAccess() : !!(_proxyCfg() || getAnthropicKey()); }
  catch(e){ return false; }
}

// ── PROMPT ─────────────────────────────────────────────────────
// El enemigo de esta herramienta es la complacencia: un LLM sin freno le pone 5 a
// todo y el panel deja de discriminar. Las reglas de abajo existen para eso.
const SIM_SYSTEM = `Eres un simulador de panel de consumidores chilenos. Recibes un concepto de producto con su precio y una lista de perfiles, y respondes cómo reaccionaría CADA perfil.

REGLAS DE CALIBRACIÓN (las más importantes):
- Sé severo. Estás evaluando una marca nueva, sin trayectoria ni reconocimiento.
- En un panel real de un producto nuevo, lo normal es que MENOS DEL 20% llegue a 4 o 5. Si estás poniendo 4 o 5 a más de la mitad del panel, estás siendo complaciente: corrígelo.
- El chileno promedio frente a un objeto de decoración caro dice "está bonito, pero no lo necesito". Refleja eso.
- No inventes entusiasmo. No suavices. Si el concepto es mediocre, el panel entero debe reflejarlo.

ESCALA DE COMPRA (0 a 5):
0 = no le interesa en absoluto
1 = le parece irrelevante para su vida
2 = lo encuentra caro o innecesario
3 = le gusta pero NO lo compra
4 = lo compraría en los próximos 3 meses
5 = lo compra ahora mismo

CONDICIONES DURAS:
- Para poner 4 o 5, el perfil DEBE nombrar en el campo FRENO el lugar exacto de su casa o el uso concreto en su negocio donde lo pondría. Si no puede nombrarlo con precisión, el máximo es 3.
- Si el precio supera el "tope" del perfil, el máximo es 3 salvo que el perfil dé una razón concreta para estirarse.
- El campo ALTERNATIVA es obligatorio SIEMPRE, incluso si compra: en qué gastaría esa misma plata, o con qué producto lo compara.

FORMATO DE SALIDA (obligatorio, sin texto adicional antes ni después):
Una línea por perfil, en el orden en que te los doy:
ID|COMPRA|FRENO|ALTERNATIVA

FRENO: máximo 90 caracteres. Si compra (4-5), acá va dónde lo pondría. Si no compra, acá va qué lo detiene.
ALTERNATIVA: máximo 60 caracteres.

Después de la última línea de perfil, agrega exactamente este bloque:
---
FRENOS: los 3 frenos que más se repiten, separados por " ;; ", cada uno con el número de perfiles que lo mencionan entre paréntesis
COMPRADOR: en una línea, el perfil-tipo que sí compraría (o "ninguno claro")
PRECIO: el precio en pesos chilenos al que este panel dejaría de objetar, y por qué en media línea

Español chileno. Sin emojis, sin markdown, sin asteriscos.`;

function _simUserPrompt(linea, contexto, concepto, precio, perfiles){
  const lista = perfiles.map(p=>`${p.id} | tope $${p.tope.toLocaleString('es-CL')} | ${p.desc}`).join('\n');
  const precioTxt = precio ? `$${Number(precio).toLocaleString('es-CL')} CLP (IVA incluido)` : 'sin precio definido — evalúa solo el concepto';
  return `LÍNEA DE PRODUCTO: ${linea}
CONTEXTO: ${contexto}

CONCEPTO A EVALUAR: ${concepto}
PRECIO AL PÚBLICO: ${precioTxt}

PERFILES (${perfiles.length}):
${lista}

Responde una línea por perfil y luego el bloque de resumen.`;
}

// ── PARSEO ─────────────────────────────────────────────────────
// Tolerante a propósito: si el modelo agrega una línea de más o cambia el orden,
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

// ── VEREDICTO ──────────────────────────────────────────────────
// Los cortes son deliberadamente duros: la pega de esta herramienta es descartar.
// Con menos del 10% de intención real, un producto nuevo sin marca no despega.
function _simVeredicto(pctCompra, promedio){
  if(pctCompra < 10 || promedio < 1.8) return 'descartar';
  if(pctCompra >= 25 && promedio >= 2.8) return 'prototipar';
  return 'dudoso';
}

// Cobertura mínima para dar un veredicto. Bajo esto el porcentaje se calcularía
// sobre una base más chica que el panel y saldría inflado: 8 compradores sobre 20
// respuestas es 40%, pero sobre el panel real de 44 es 18% — la diferencia entre
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
    // Sin panel completo no se emite veredicto: un número calculado sobre media
    // muestra es peor que no tener número, porque igual se usa para decidir.
    veredicto: incompleto ? 'incompleto' : _simVeredicto(pctCompra, promedio),
    frenos: resumen.frenos,
    comprador: resumen.comprador,
    precioSugerido: resumen.precio,
    votos,
    ...(extra || {}),
  };
}

// ── ENTRADA DEL USUARIO ────────────────────────────────────────
// Formato por línea: "Nombre del concepto | 49900". El precio es opcional.
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

// ── BARRIDO DE PRECIO ──────────────────────────────────────────
// "34900, 49900, 79900" → [34900,49900,79900]. Con barrido activo cada concepto se
// evalúa una vez por precio y el precio propio del concepto se ignora: la gracia
// es ver la curva, no mezclar anclas distintas.
// Se limpian los no-dígitos para aceptar "$34.900". Efecto lateral: "-5" quedaría
// como 5, y un dedazo tipo "3" pasaría como precio válido. El piso de $100 los
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

// Expande conceptos × precios. `base` agrupa las variantes del mismo concepto para
// poder dibujar la curva. El tope se aplica DESPUÉS de expandir: lo que cuesta
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
// por concepto. Sirve para que nadie lance 25 conceptos sin saber qué gasta.
function _simCosto(nConceptos, nPerfiles){
  const inTok  = (1200 + nPerfiles*45) * nConceptos;
  const outTok = (nPerfiles*22 + 120) * nConceptos;
  const usd = inTok/1e6*1 + outTok/1e6*5;
  return Math.max(1, Math.round(usd * SIM_USD_CLP));
}

// ── INIT / UI ──────────────────────────────────────────────────
function initSimulacion(){
  const sel = document.getElementById('simLinea');
  if(sel && !sel.options.length){
    sel.innerHTML = Object.entries(SIM_LINEAS).map(([k,v])=>`<option value="${k}">${escapeHtml(v.nombre)}</option>`).join('');
  }
  _simCtxAuto = '';   // primera carga: el textarea viene vacío, no hay edición que proteger
  simLineaChange();
  simEstimar();
  renderSimHistorial();
  const av = document.getElementById('simAviso');
  if(av && !simHasIA()) av.textContent = 'Sin acceso a la IA — configura el proxy o la API key en Mi cuenta para poder correr el panel.';
}

// Último contexto puesto automáticamente. Sirve para distinguir "el usuario no lo
// tocó" de "lo editó a mano": pisar una edición al cambiar de línea y volver hacía
// perder el texto sin aviso.
let _simCtxAuto = '';

function simLineaChange(){
  const k = document.getElementById('simLinea')?.value || 'lamparas';
  const L = SIM_LINEAS[k] || SIM_LINEAS.lamparas;
  const ctx = document.getElementById('simContexto');
  if(ctx){
    const editado = ctx.value.trim() && ctx.value !== _simCtxAuto;
    if(!editado || confirm('Editaste el contexto a mano. ¿Reemplazarlo por el de esta línea?')){
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
    ? `${base.length} concepto${base.length>1?'s':''} × ${precios.length} precios = ${conceptos.length} corridas`
    : `${conceptos.length} concepto${conceptos.length>1?'s':''}`;
  el.textContent = `${detalle} × ${perfiles.length} perfiles · costo estimado ≈ $${_simCosto(conceptos.length, perfiles.length).toLocaleString('es-CL')} CLP`;
}

// ── CORRIDA ────────────────────────────────────────────────────
async function simCorrer(){
  if(_simBusy) return;
  if(!simHasIA()){ toast('Sin acceso a la IA — configúralo en Mi cuenta','error'); return; }
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
  if(!contexto){ toast('Describe el contexto de la línea','error'); return; }
  const publico = document.getElementById('simPublico')?.value || 'ambos';
  const perfiles = _simPerfiles(publico);

  _simBusy = true; _simAbort = false;
  const btn = document.getElementById('simCorrerBtn');
  if(btn){ btn.disabled = true; btn.textContent = '⏳ Corriendo…'; }
  const stop = document.getElementById('simDetenerBtn');
  if(stop) stop.style.display = 'inline-flex';

  const resultados = new Array(conceptos.length).fill(null);
  let hechos = 0, fallidos = 0, reintentos = 0;
  const progreso = (msg)=>{ const p = document.getElementById('simProgreso'); if(p) p.textContent = msg; };
  progreso(`0 de ${conceptos.length} conceptos…`);

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
        if(!p.votos.length) throw new Error('la IA no devolvió votos legibles');
        resultados[i] = _simAgrega(c.nombre, c.precio, p.votos, p.resumen, perfiles.length, {base:c.base||c.nombre});
      }catch(e){
        fallidos++;
        resultados[i] = {concepto:c.nombre, precio:c.precio, base:c.base||c.nombre, error:String(e.message||e), veredicto:'error', n:0, esperados:perfiles.length, cobertura:0, promedio:0, pctCompra:0, votos:[]};
      }
      hechos++;
      progreso(`${hechos} de ${conceptos.length} conceptos…`);
    }
  }
  await Promise.all(Array.from({length:Math.min(SIM_CONCURRENCIA, conceptos.length)}, worker));

  _simBusy = false;
  if(btn){ btn.disabled = false; btn.textContent = '▶ Correr panel'; }
  if(stop) stop.style.display = 'none';
  progreso(_simAbort ? 'Detenido.' : '');

  const items = resultados.filter(Boolean);
  if(!items.length){ toast('No se pudo correr ningún concepto','error'); return; }

  _simRun = {
    id: 'sim_' + Date.now(),
    fecha: hoyCL(),   // nunca toISOString(): en UTC el día cambia a las 21:00 en Chile
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
  if(fallidos) toast(`${fallidos} concepto(s) fallaron — revisa el detalle`,'error');
  else if(incompletos) toast(`${incompletos} concepto(s) sin panel completo — sin veredicto`,'error');
  else toast(`✓ Panel corrido: ${items.length} concepto(s)`+(reintentos?` (${reintentos} reintento/s)`:''),'success');
}

// No aborta lo que ya salió: esas llamadas se pagan igual. Se dice en el toast
// para que nadie crea que detener es gratis.
function simDetener(){ _simAbort = true; toast('Se detiene al terminar los conceptos en vuelo (esos se cobran igual)','info'); }

// ── RENDER ─────────────────────────────────────────────────────
const SIM_VEREDICTO_UI = {
  descartar:  {label:'DESCARTAR',  color:'#ff4444', bg:'rgba(255,68,68,.10)',  borde:'rgba(255,68,68,.35)'},
  dudoso:     {label:'DUDOSO',     color:'#f5a524', bg:'rgba(245,165,36,.10)', borde:'rgba(245,165,36,.35)'},
  prototipar: {label:'PROTOTIPAR', color:'#00d4aa', bg:'rgba(0,212,170,.10)',  borde:'rgba(0,212,170,.35)'},
  incompleto: {label:'SIN VEREDICTO', color:'#9b6bff', bg:'rgba(155,107,255,.10)', borde:'rgba(155,107,255,.35)'},
  error:      {label:'ERROR',      color:'#9a9a9a', bg:'rgba(154,154,154,.10)',borde:'rgba(154,154,154,.3)'},
};

function _simMoneda(n){ return n ? '$'+Number(n).toLocaleString('es-CL') : '—'; }

function renderSimResultados(run){
  const cont = document.getElementById('simResultados');
  if(!cont || !run) return;
  // Peor primero: la pega de esta herramienta es descartar, no premiar.
  const orden = [...run.items].sort((a,b)=>(a.pctCompra-b.pctCompra) || (a.promedio-b.promedio));
  const prev = _simPrevia(run);

  cont.innerHTML = `
  <div class="card" style="margin-bottom:16px">
    <div class="card-header">
      <span class="card-title">Resultado · ${escapeHtml(run.linea)}</span>
      <div style="display:flex;gap:6px;align-items:center">
        <span class="badge badge-purple">${run.nPerfiles} perfiles · panel v${run.panel}</span>
        <button class="btn btn-ghost btn-sm" onclick="simCopiarResumen()">Copiar resumen</button>
      </div>
    </div>
    <div style="padding:12px 16px;font-size:11.5px;color:var(--text3);line-height:1.55">
      Ordenado de peor a mejor. Esto <b>no mide estética</b>: los perfiles leen una descripción, no ven el producto.
      Úsalo para bajar de muchas ideas a pocas — la ganadora la eligen prototipos reales con fotos y botón de compra.
    </div>
  </div>
  ${_simCurvaPrecio(run)}
  ${orden.map(it=>_simCardConcepto(it, prev)).join('')}`;
}

function _simCardConcepto(it, prev){
  const ui = SIM_VEREDICTO_UI[it.veredicto] || SIM_VEREDICTO_UI.error;
  if(it.veredicto === 'error'){
    return `<div class="card" style="margin-bottom:12px;border-color:${ui.borde}">
      <div style="padding:14px 16px">
        <div style="font-size:14px;font-weight:600;margin-bottom:4px">${escapeHtml(it.concepto)}</div>
        <div style="font-size:12px;color:#ff6b6b">No se pudo evaluar: ${escapeHtml(it.error||'')}</div>
      </div></div>`;
  }
  const antes = prev && prev[it.concepto];
  const delta = antes ? it.pctCompra - antes.pctCompra : null;
  const deltaTxt = (delta === null || delta === 0) ? '' :
    `<span style="font-size:11px;color:${delta>0?'#00d4aa':'#ff6b6b'};margin-left:6px">${delta>0?'▲':'▼'} ${Math.abs(delta)} pts vs corrida anterior</span>`;
  const noCompran = it.votos.filter(v=>v.compra <= 3);
  const compran = it.votos.filter(v=>v.compra >= 4);
  const frenos = (it.frenos||'').split(';;').map(s=>s.trim()).filter(Boolean);

  return `
  <div class="card" style="margin-bottom:12px;border-color:${ui.borde};background:${ui.bg}">
    <div style="padding:14px 16px">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <div style="font-size:14.5px;font-weight:600">${escapeHtml(it.concepto)}</div>
          <div style="font-size:11.5px;color:var(--text3);margin-top:3px">Precio evaluado: ${_simMoneda(it.precio)}${it.precio?' (IVA incl.)':''}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:10.5px;font-weight:700;letter-spacing:.8px;color:${ui.color}">${ui.label}</div>
          <div style="font-size:20px;font-weight:700;color:${ui.color};line-height:1.2">${it.veredicto==='incompleto'?'—':it.pctCompra+'%'}</div>
          <div style="font-size:10.5px;color:var(--text3)">${it.veredicto==='incompleto'?`solo ${it.n} de ${it.esperados} perfiles`:`compraría · nota ${it.promedio.toFixed(1)}/5${deltaTxt}`}</div>
        </div>
      </div>

      ${it.veredicto==='incompleto' ? `<div style="margin-top:10px;font-size:12px;line-height:1.55;color:#c9a9ff">
        El panel respondió incompleto (${it.cobertura}% de cobertura) incluso tras reintentar. No se emite veredicto:
        calcular el porcentaje sobre ${it.n} respuestas en vez de ${it.esperados} lo dejaría inflado. Vuelve a correr este concepto solo.
      </div>`:''}

      ${frenos.length ? `<div style="margin-top:12px">
        <div style="font-size:10.5px;font-weight:700;letter-spacing:.7px;color:var(--text3);text-transform:uppercase;margin-bottom:5px">Qué los frena</div>
        ${frenos.map(f=>`<div style="font-size:12.5px;line-height:1.5;padding:3px 0">• ${escapeHtml(f)}</div>`).join('')}
      </div>`:''}

      ${it.comprador ? `<div style="margin-top:10px">
        <div style="font-size:10.5px;font-weight:700;letter-spacing:.7px;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Quién sí compra</div>
        <div style="font-size:12.5px;line-height:1.5">${escapeHtml(it.comprador)}</div>
      </div>`:''}

      ${it.precioSugerido ? `<div style="margin-top:10px">
        <div style="font-size:10.5px;font-weight:700;letter-spacing:.7px;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Precio sin objeción</div>
        <div style="font-size:12.5px;line-height:1.5">${escapeHtml(it.precioSugerido)}</div>
      </div>`:''}

      ${!it.votos.length ? '' : `
      <details style="margin-top:12px">
        <summary style="cursor:pointer;font-size:11.5px;color:var(--text2)">Ver los ${it.n} votos del panel (${compran.length} compran · ${noCompran.length} no)</summary>
        <div style="margin-top:8px;max-height:320px;overflow:auto">
          ${it.votos.slice().sort((a,b)=>b.compra-a.compra).map(v=>{
            const p = SIM_PERFILES.find(x=>x.id===v.id);
            const c = v.compra>=4 ? '#00d4aa' : (v.compra<=1 ? '#ff6b6b' : 'var(--text2)');
            return `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:11.5px;line-height:1.5">
              <span style="color:${c};font-weight:700">${v.compra}</span>
              <span style="color:var(--text3)"> · ${v.id}</span>
              <span style="color:var(--text3)">${p?' · '+escapeHtml(p.desc.split('.')[0]):''}</span>
              <div style="color:var(--text2)">${escapeHtml(v.freno||'')}</div>
              ${v.alternativa?`<div style="color:var(--text3);font-size:11px">En vez: ${escapeHtml(v.alternativa)}</div>`:''}
            </div>`;
          }).join('')}
        </div>
      </details>`}
    </div>
  </div>`;
}

// ── CURVA DE PRECIO ────────────────────────────────────────────
// El entregable del barrido: el mismo concepto a varios precios, para ver dónde se
// cae la intención. Es lo que no se lee bien en el ranking, porque las variantes
// quedan repartidas entre otros conceptos.
function _simCurvaPrecio(run){
  if(!run.barrido || !run.barrido.length) return '';
  const grupos = new Map();
  for(const it of run.items){
    if(it.veredicto === 'error' || it.veredicto === 'incompleto') continue;
    if(!grupos.has(it.base||it.concepto)) grupos.set(it.base||it.concepto, []);
    grupos.get(it.base||it.concepto).push(it);
  }
  if(!grupos.size) return '';
  const filas = [...grupos.entries()].map(([nombre, vs])=>{
    const orden = vs.slice().sort((a,b)=>a.precio-b.precio);
    const mejor = orden.reduce((a,b)=>b.pctCompra > a.pctCompra ? b : a, orden[0]);
    return `<tr>
      <td style="padding:7px 10px;font-size:12px;border-bottom:1px solid var(--border)">${escapeHtml(nombre)}</td>
      ${orden.map(v=>`<td style="padding:7px 10px;text-align:center;border-bottom:1px solid var(--border);white-space:nowrap">
        <div style="font-size:13px;font-weight:700;color:${v===mejor?'#00d4aa':'var(--text2)'}">${v.pctCompra}%</div>
        <div style="font-size:10px;color:var(--text3)">${_simMoneda(v.precio)}</div>
      </td>`).join('')}
    </tr>`;
  }).join('');
  return `<div class="card" style="margin-bottom:16px">
    <div class="card-header"><span class="card-title">Curva de precio</span>
      <span class="badge badge-purple">${run.barrido.map(p=>_simMoneda(p)).join(' · ')}</span></div>
    <div style="padding:4px 6px;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse"><tbody>${filas}</tbody></table>
    </div>
    <div style="padding:8px 16px 12px;font-size:11px;color:var(--text3);line-height:1.5">
      En verde el precio con más intención de compra de cada concepto. Si la intención casi no baja al subir el precio,
      estás dejando plata en la mesa; si se desploma entre dos escalones, ahí está tu techo.
    </div>
  </div>`;
}

function simCopiarResumen(){
  if(!_simRun){ toast('No hay corrida para copiar','error'); return; }
  const l = [`Panel sintético — ${_simRun.linea} — ${_simRun.fecha} — ${_simRun.nPerfiles} perfiles`, ''];
  [..._simRun.items].sort((a,b)=>a.pctCompra-b.pctCompra).forEach(it=>{
    if(it.veredicto === 'error'){ l.push(`[ERROR] ${it.concepto}`); return; }
    l.push(`[${(SIM_VEREDICTO_UI[it.veredicto]||{}).label}] ${it.concepto} — ${_simMoneda(it.precio)} — ${it.pctCompra}% compraría, nota ${it.promedio.toFixed(1)}`);
    if(it.frenos) l.push(`  Frenos: ${it.frenos}`);
    if(it.comprador) l.push(`  Compra: ${it.comprador}`);
    if(it.precioSugerido) l.push(`  Precio: ${it.precioSugerido}`);
    l.push('');
  });
  navigator.clipboard.writeText(l.join('\n')).then(()=>toast('Copiado ✓','success')).catch(()=>toast('No se pudo copiar','error'));
}

// ── HISTORIAL ──────────────────────────────────────────────────
// localStorage + respaldo en Monitor Sistema (mismo patrón que la agenda), para
// que el historial sobreviva a limpiar la caché sin pedir una tabla nueva.
const SIM_HIST_KEY = 'thelab_simulacion_v1';
const SIM_HIST_MAX = 30;

function _simHist(){ try{ return JSON.parse(localStorage.getItem(SIM_HIST_KEY)||'[]'); }catch(e){ return []; } }

// Guarda solo el agregado, no los 44 votos crudos de cada concepto: el respaldo
// remoto tiene tope de tamaño y el detalle no se usa para comparar corridas.
function simGuardar(run){
  const liviano = {
    id:run.id, fecha:run.fecha, ts:run.ts, linea:run.linea, lineaKey:run.lineaKey,
    publico:run.publico, panel:run.panel, nPerfiles:run.nPerfiles, barrido:run.barrido||[],
    items: run.items.map(i=>({concepto:i.concepto, base:i.base, precio:i.precio, veredicto:i.veredicto, pctCompra:i.pctCompra, promedio:i.promedio, cobertura:i.cobertura, esperados:i.esperados, frenos:i.frenos, comprador:i.comprador, precioSugerido:i.precioSugerido})),
  };
  const arr = [liviano, ..._simHist()].slice(0, SIM_HIST_MAX);
  try{ localStorage.setItem(SIM_HIST_KEY, JSON.stringify(arr)); }catch(e){}
  renderSimHistorial();
  _simRespaldar(arr);
}

// Respaldo remoto best-effort. Dos cuidados:
//  · _monitorUpsert devuelve una promesa: un try/catch síncrono NO atrapa su
//    rechazo y se escapa como unhandled rejection.
//  · marketing no tiene escritura global y 'Monitor Sistema' no está en los
//    carve-outs de Redes/Newsletter, así que airtableWrite lanza y saca un toast
//    rojo en cada corrida. Si el rol no puede escribir, ni se intenta.
function _simRespaldar(arr){
  try{
    if(typeof _monitorUpsert !== 'function') return;
    const u = (typeof AUTH !== 'undefined' && AUTH.getUser) ? AUTH.getUser() : null;
    if(u && typeof RBAC !== 'undefined' && RBAC.canWriteTable && !RBAC.canWriteTable(u.role, 'Monitor Sistema')) return;
    Promise.resolve(_monitorUpsert('SIMULACION', JSON.stringify(arr).slice(0,95000), 'simRecordId')).catch(()=>{});
  }catch(e){}
}

// Corrida INMEDIATAMENTE ANTERIOR de la misma línea, indexada por concepto.
// Debe filtrarse por ts: antes tomaba la más nueva del historial, así que al abrir
// una corrida vieja la comparaba contra una posterior y mostraba el delta al revés.
function _simPrevia(run){
  const prev = _simHist()
    .filter(h=>h.lineaKey===run.lineaKey && h.id!==run.id && h.panel===run.panel && h.ts < run.ts)
    .sort((a,b)=>b.ts - a.ts)[0];
  if(!prev) return null;
  const map = {};
  prev.items.forEach(i=>{ map[i.concepto] = i; });
  return map;
}

function renderSimHistorial(){
  const el = document.getElementById('simHistorial');
  if(!el) return;
  const h = _simHist();
  if(!h.length){ el.innerHTML = '<div style="padding:14px 16px;font-size:12px;color:var(--text3)">Sin corridas todavía.</div>'; return; }
  el.innerHTML = h.map(r=>{
    const d = r.items.filter(i=>i.veredicto==='descartar').length;
    const p = r.items.filter(i=>i.veredicto==='prototipar').length;
    return `<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;padding:9px 16px;border-bottom:1px solid var(--border);font-size:12px">
      <div style="min-width:0">
        <div style="font-weight:600">${escapeHtml(r.linea)}</div>
        <div style="color:var(--text3);font-size:11px">${escapeHtml(_simFechaCL(r.fecha))} · ${r.items.length} conceptos · ${r.nPerfiles} perfiles</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
        <span class="badge" style="background:rgba(255,68,68,.12);color:#ff6b6b">${d} descartar</span>
        <span class="badge" style="background:rgba(0,212,170,.12);color:#00d4aa">${p} prototipar</span>
        <button class="btn btn-ghost btn-sm" onclick="simVerHistorial('${r.id}')">Ver</button>
      </div>
    </div>`;
  }).join('');
}

// Fechas en DD-MM-AAAA (convención del proyecto). El historial guarda ISO.
function _simFechaCL(f){
  const m = String(f||'').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(f||'');
}

function simVerHistorial(id){
  const r = _simHist().find(x=>x.id===id);
  if(!r){ toast('Corrida no encontrada','error'); return; }
  // El historial no guarda los votos crudos: se re-renderiza el agregado y la
  // tarjeta omite el bloque de detalle en vez de prometer votos que no tiene.
  renderSimResultados({...r, items:r.items.map(i=>({...i, n:i.n||r.nPerfiles, esperados:i.esperados||r.nPerfiles, votos:[]}))});
  document.getElementById('simResultados')?.scrollIntoView({behavior:'smooth', block:'start'});
}

function simBorrarHistorial(){
  if(!confirm('¿Borrar el historial completo de corridas? No se puede deshacer.')) return;
  try{ localStorage.removeItem(SIM_HIST_KEY); }catch(e){}
  _simRespaldar([]);
  renderSimHistorial();
  toast('Historial borrado','info');
}
