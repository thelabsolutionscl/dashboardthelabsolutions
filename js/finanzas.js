/* js/finanzas.js — módulo extraído de index.html (mismo orden de carga).
 * El deploy estampa la versión en el src del index para bustear la caché. */

/* ══════════════════════════════════════════════════════════════
   FINANZAS — OPTIMIZADO v2
   ══════════════════════════════════════════════════════════════ */

/* ── Datos mensuales por año (neto sin IVA) ── */
const FIN_MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const FIN_VENTAS = {
  2022: [0,0,0,0,0,2600000,400000,800000,1400000,1400000,800000,1600000],
  2023: [1610100,1638504,3070827,4246782,1200532,2958445,2559724,3464269,2433360,954400,16789488,6235284],
  2024: [4255270,5013442,4343000,1267882,16071493,1591279,10946818,8886000,12445264,19130663,16001944,8471000],
  2025: [0,1382040,6025486,6460093,5152953,837600,2210780,19170355,8935134,8537317,13666039,1357000],
  2026: [180000,5734120,5179000,2391000,19977700,0,0,0,0,0,0,0]
};

/* ── Facturas históricas (muestra completa 2026) ── */
const FIN_FACTURAS_BASE = [
  /* ─ ENE 2026 ─ */
  {year:'2026',mes:'01',nombre:'Jourdan Lucente',empresa:'—',item:'SINTRA',cant:1,valor:108000,canal:'CONTACTO',cat:'IMPRENTA',fact:'356',pago:128520,porCobrar:0},
  {year:'2026',mes:'01',nombre:'Jourdan Lucente',empresa:'—',item:'VINILO',cant:1,valor:87000,canal:'CONTACTO',cat:'IMPRENTA',fact:'356',pago:103530,porCobrar:0},
  {year:'2026',mes:'01',nombre:'Jourdan Lucente',empresa:'—',item:'DESPACHO',cant:1,valor:30000,canal:'CONTACTO',cat:'IMPRENTA',fact:'356',pago:35700,porCobrar:0},
  {year:'2026',mes:'01',nombre:'Jourdan Lucente',empresa:'—',item:'DESCUENTO',cant:1,valor:-45000,canal:'CONTACTO',cat:'IMPRENTA',fact:'356',pago:-53550,porCobrar:0},
  /* ─ FEB 2026 ─ */
  {year:'2026',mes:'02',nombre:'Marco Pulgar',empresa:'LifeFitness',item:'DISEÑO 3D (10 modelos)',cant:10,valor:94000,canal:'CONTACTO',cat:'3D',fact:'357',pago:535500,porCobrar:69200},
  {year:'2026',mes:'02',nombre:'Julio Miranda',empresa:'Comercial TSA SPA',item:'TROFEO',cant:2,valor:57000,canal:'CONTACTO',cat:'3D',fact:'358',pago:135660,porCobrar:0},
  {year:'2026',mes:'02',nombre:'Claudia Carvallo',empresa:'Jardín Taruca',item:'AGENDAS ANILLADAS 122p',cant:100,valor:9000,canal:'CONTACTO',cat:'IMPRENTA',fact:'359',pago:1071000,porCobrar:0},
  {year:'2026',mes:'02',nombre:'Ignacio Besnier',empresa:'Graficas City Spa',item:'CARTEL NEON NIVEA 130×90',cant:1,valor:500000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'360',pago:595000,porCobrar:0},
  {year:'2026',mes:'02',nombre:'Virginia Venturino',empresa:'BCI Pagos',item:'BOLSAS TNT',cant:2000,valor:1550,canal:'CONTACTO',cat:'IMPRENTA',fact:'361',pago:3689000,porCobrar:0},
  /* ─ MAR 2026 ─ */
  {year:'2026',mes:'03',nombre:'María Jesús Vergara',empresa:'Cervecería Chile SA',item:'TABLE TEND STELLA',cant:500,valor:7500,canal:'CONTACTO',cat:'IMPRENTA',fact:'366',pago:4462500,porCobrar:0},
  {year:'2026',mes:'03',nombre:'Ignacio Besnier',empresa:'Graficas City Spa',item:'PARIS × LOLLA 210×62',cant:1,valor:450000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'367',pago:535500,porCobrar:535500},
  {year:'2026',mes:'03',nombre:'Ignacio Besnier',empresa:'Graficas City Spa',item:'ISOTIPO MISTRAL 42cm Ø',cant:2,valor:70000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'365',pago:166600,porCobrar:0},
  {year:'2026',mes:'03',nombre:'Ignacio Besnier',empresa:'Graficas City Spa',item:'LOLLA × MISTRAL 157×31',cant:1,valor:360000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'368',pago:428400,porCobrar:0},
  {year:'2026',mes:'03',nombre:'Marcelo Cabrera',empresa:'BIG CUT SPA',item:'PAPEL MANTEQUILLA',cant:2000,valor:52,canal:'CONTACTO',cat:'IMPRENTA',fact:'369',pago:123760,porCobrar:0},
  /* ─ ABR 2026 ─ */
  {year:'2026',mes:'04',nombre:'Ignacio Besnier',empresa:'Graficas City Spa',item:'CARTEL NEON VANS',cant:2,valor:100000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'370',pago:238000,porCobrar:0},
  {year:'2026',mes:'04',nombre:'Keybin Gil Ramirez',empresa:'Impulso Creativo KD SPA',item:'FRASE NEON 110×30',cant:1,valor:275000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'372',pago:327250,porCobrar:0},
  {year:'2026',mes:'04',nombre:'Keybin Gil Ramirez',empresa:'Impulso Creativo KD SPA',item:'FRANJAS NEON COLORES 200×50',cant:1,valor:297000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'372',pago:353430,porCobrar:0},
  {year:'2026',mes:'04',nombre:'Joaquín Urrutia',empresa:'ART DESIGN SPA',item:'NEON MICHAEL',cant:1,valor:479000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'373',pago:570010,porCobrar:0},
  {year:'2026',mes:'04',nombre:'Nayareth Guerra',empresa:'DERMIK',item:'CARTEL 28×18',cant:1,valor:50000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'374',pago:59500,porCobrar:0},
  {year:'2026',mes:'04',nombre:'Ignacio Besnier',empresa:'Graficas City Spa',item:'NEON NBY',cant:1,valor:300000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'375',pago:357000,porCobrar:0},
  {year:'2026',mes:'04',nombre:'Ignacio Besnier',empresa:'Graficas City Spa',item:'NEON RUN NIKE',cant:1,valor:300000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'376',pago:357000,porCobrar:0},
  {year:'2026',mes:'04',nombre:'Joaquín Urrutia',empresa:'ART DESIGN SPA',item:'NEON MIKO × GAP',cant:1,valor:350000,canal:'CONTACTO',cat:'NEON/CARTEL',fact:'377',pago:416500,porCobrar:0},
  /* ─ MAY 2026 ─ */
  {year:'2026',mes:'05',nombre:'Virginia Venturino',empresa:'BCI Pagos',item:'CAJAS BCI 5/0',cant:2000,valor:3890,canal:'CONTACTO',cat:'IMPRENTA',fact:'378',pago:9258200,porCobrar:0},
  {year:'2026',mes:'05',nombre:'María Jesús Vergara',empresa:'Cervecería Chile SA',item:'TAP HANDLER QUILMES',cant:10,valor:72700,canal:'CONTACTO',cat:'IMPRENTA',fact:'380',pago:865130,porCobrar:0},
  {year:'2026',mes:'05',nombre:'María Jesús Vergara',empresa:'Cervecería Chile SA',item:'TABLE TENT QUILMES',cant:100,valor:6162,canal:'CONTACTO',cat:'IMPRENTA',fact:'',pago:733278,porCobrar:0},
  {year:'2026',mes:'05',nombre:'Francisco Contardo',empresa:'Comité de Paltas de Chile A.G.',item:'LLAVERO NFC',cant:30,valor:5000,canal:'CONTACTO',cat:'DISEÑO',fact:'379',pago:178500,porCobrar:0},
  {year:'2026',mes:'05',nombre:'María Jesús Vergara',empresa:'Cervecería Chile SA',item:'TABLE TENT MICHELOB',cant:400,valor:11817,canal:'CONTACTO',cat:'IMPRENTA',fact:'',pago:5624892,porCobrar:0},
  {year:'2026',mes:'05',nombre:'María Jesús Vergara',empresa:'Cervecería Chile SA',item:'HIELERA MICHELOB',cant:70,valor:82390,canal:'CONTACTO',cat:'IMPRENTA',fact:'',pago:6863087,porCobrar:0},
  {year:'2026',mes:'05',nombre:'Ahira General Vera',empresa:'Exportadora Baika SA',item:'LLAVEROS PALTAS',cant:30,valor:5000,canal:'CONTACTO',cat:'DISEÑO',fact:'382',pago:178500,porCobrar:0},
  /* ─ muestra 2025 ─ */
  {year:'2025',mes:'08',nombre:'Gonzalo Casas',empresa:'Constructora DLB',item:'MUSEO',cant:1,valor:3640485,canal:'CONTACTO',cat:'SERVICIO',fact:'305',pago:4332177,porCobrar:0},
  {year:'2025',mes:'08',nombre:'Virginia Venturino',empresa:'BCI Pagos',item:'CAJA BCI 2 (x2000)',cant:2000,valor:3890,canal:'VENDEDORES',cat:'IMPRENTA',fact:'314',pago:9258200,porCobrar:0},
  {year:'2025',mes:'09',nombre:'María Jesús Vergara',empresa:'Cervecería Chile SA',item:'TABLE TEND STELLA 1000',cant:1000,valor:7100,canal:'CONTACTO',cat:'IMPRENTA',fact:'319',pago:8449000,porCobrar:0},
  {year:'2025',mes:'10',nombre:'Martín Caballero',empresa:'Tres Dedos Producciones',item:'MACETERO CONTAINER ×250',cant:250,valor:11000,canal:'CONTACTO',cat:'IMPRENTA',fact:'339',pago:3272500,porCobrar:0},
  {year:'2025',mes:'11',nombre:'Virginia Venturino',empresa:'BCI Pagos',item:'BOLSAS BCI (×2000)',cant:2000,valor:1530,canal:'VENDEDORES',cat:'IMPRENTA',fact:'345',pago:3641400,porCobrar:0},
  {year:'2025',mes:'11',nombre:'Israel Muñoz',empresa:'Multigremial Nacional',item:'STAND MULTIGREMIAL',cant:1,valor:4420000,canal:'CONTACTO',cat:'SERVICIO',fact:'249',pago:5259800,porCobrar:0},
  {year:'2025',mes:'07',nombre:'Hans Schmitz',empresa:'TECH STREAM SPA',item:'LOBERA ×500',cant:500,valor:2470,canal:'ADWORDS',cat:'DISEÑO',fact:'304',pago:1469650,porCobrar:0},
  {year:'2025',mes:'03',nombre:'Virginia Venturino',empresa:'BCI Pagos',item:'ADHESIVO VERIFONE V240M ×600',cant:600,valor:608,canal:'VENDEDORES',cat:'IMPRENTA',fact:'278',pago:434112,porCobrar:0},
  {year:'2025',mes:'06',nombre:'Ricardo Jorquera',empresa:'Aerovantage',item:'LOGO + WEB + BRANDING',cant:1,valor:717600,canal:'CONTACTO',cat:'DISEÑO',fact:'296',pago:837600,porCobrar:0},
  /* ─ muestra 2024 ─ */
  {year:'2024',mes:'05',nombre:'Francisco Dittborn',empresa:'Inversiones Las Rosas LTDA.',item:'DISEÑO Y REMODELACIÓN',cant:1,valor:13803300,canal:'CONTACTO',cat:'SERVICIO',fact:'147',pago:16425927,porCobrar:0},
  {year:'2024',mes:'10',nombre:'Virginia Venturino',empresa:'BCI Pagos',item:'CAJAS BCI ×2000',cant:2000,valor:3300,canal:'VENDEDORES',cat:'IMPRENTA',fact:'232',pago:7854000,porCobrar:0},
  {year:'2024',mes:'11',nombre:'Alvaro Hidalgo',empresa:'Grupo NTS',item:'Articulado Billy y Mike ×5000',cant:5000,valor:1200,canal:'CONTACTO',cat:'3D',fact:'101',pago:7140000,porCobrar:0},
  {year:'2024',mes:'10',nombre:'Virginia Venturino',empresa:'BCI Pagos',item:'BOLSA TNT 30×40×12 ×2000',cant:2000,valor:1500,canal:'VENDEDORES',cat:'IMPRENTA',fact:'',pago:3570000,porCobrar:0},
  {year:'2024',mes:'08',nombre:'Virginia Venturino',empresa:'BCI Pagos',item:'CAJAS BCI ×2000',cant:2000,valor:3300,canal:'VENDEDORES',cat:'IMPRENTA',fact:'185',pago:7854000,porCobrar:0},
  {year:'2024',mes:'11',nombre:'Israel Muñoz',empresa:'Multigremial Nacional',item:'STAND MULTIGREMIAL',cant:1,valor:4420000,canal:'CONTACTO',cat:'SERVICIO',fact:'249',pago:5259800,porCobrar:0},
  /* ─ muestra 2023 ─ */
  {year:'2023',mes:'11',nombre:'Virginia Venturino',empresa:'BCI Pagos',item:'CAJA BCI ×2000',cant:2000,valor:3250,canal:'VENDEDORES',cat:'IMPRENTA',fact:'106',pago:7735000,porCobrar:0},
  {year:'2023',mes:'11',nombre:'Alvaro Hidalgo',empresa:'Grupo NTS',item:'Articulado Billy y Mike ×5000',cant:5000,valor:1200,canal:'CONTACTO',cat:'3D',fact:'101',pago:7140000,porCobrar:0},
  {year:'2023',mes:'04',nombre:'Hans Schmitz',empresa:'Techstream',item:'Loberas ×500',cant:500,valor:2586,canal:'CONTACTO',cat:'DISEÑO',fact:'41',pago:1538670,porCobrar:0},
];

/* ── Préstamos ── */
const FIN_PRESTAMOS = [
  {fecha:'05/01/26',prestamo:200000,devolucion:null,deuda:4985904,obs:''},
  {fecha:'23/01/26',prestamo:200000,devolucion:null,deuda:5185904,obs:''},
  {fecha:'03/02/26',prestamo:2499990,devolucion:null,deuda:7685894,obs:'ELEGOO'},
  {fecha:'09/02/26',prestamo:3689000,devolucion:null,deuda:11374894,obs:'BOLSAS'},
  {fecha:'24/02/26',prestamo:1200000,devolucion:null,deuda:12574894,obs:''},
  {fecha:'04/03/26',prestamo:361364,devolucion:null,deuda:12936258,obs:''},
  {fecha:'13/03/25',prestamo:null,devolucion:1500000,deuda:11436258,obs:'Devolución'},
  {fecha:'13/03/26',prestamo:1500980,devolucion:null,deuda:12937238,obs:'2 ENDER 5 MAX TARJETA DE CRÉDITO'},
  {fecha:'16/03/26',prestamo:1500980,devolucion:null,deuda:14438218,obs:'2 ENDER 5 MAX TARJETA DE CRÉDITO'},
  {fecha:'27/03/26',prestamo:300000,devolucion:null,deuda:14738218,obs:''},
  {fecha:'01/04/26',prestamo:400000,devolucion:null,deuda:15138218,obs:''},
  {fecha:'03/04/26',prestamo:200000,devolucion:null,deuda:15338218,obs:''},
  {fecha:'08/04/26',prestamo:4320000,devolucion:null,deuda:19658218,obs:'PARA PAGOS DE FACTURAS'},
  {fecha:'13/04/26',prestamo:275571,devolucion:null,deuda:19933789,obs:'674311'},
  {fecha:'14/04/26',prestamo:100000,devolucion:null,deuda:20033789,obs:''},
  {fecha:'22/04/26',prestamo:200000,devolucion:null,deuda:20233789,obs:''},
  {fecha:'24/04/26',prestamo:1337431,devolucion:null,deuda:21571220,obs:''},
  {fecha:'06/05/26',prestamo:1500000,devolucion:null,deuda:23071220,obs:'PAGOS FACTURAS'},
];

/* ── Estado global finanzas ── */
let finCurrentTab = 'resumen';
let finFactPag = 0;
const FIN_PAG_SIZE = 20;
let finFactFiltradas = [];
let finChartActiveYear = 'all';

/* ── Formateadores ── */
function clp(n){
  if(n===null||n===undefined||n==='')return '—';
  const abs=Math.abs(Number(n));
  const fmt='$'+abs.toLocaleString('es-CL');
  return n<0?'-'+fmt:fmt;
}
function pct(v){
  if(v===null||v===undefined)return '—';
  const n=Number(v);
  const cls=n>=0?'badge-green':'badge-red';
  return `<span class="badge ${cls}">${n>=0?'+':''}${n.toFixed(1)}%</span>`;
}
function varPct(a,b){if(!a||!b)return null;return ((b-a)/a)*100;}

/* ── Sub-tabs internos ── */
function finSwitchTab(tab){
  finCurrentTab=tab;
  ['resumen','facturas','cobrar','prestamos','deudas','nueva','diario','aging','presupuesto'].forEach(t=>{
    document.getElementById('fin-panel-'+t).style.display=(t===tab)?'':'none';
    const btn=document.getElementById('fin-nav-'+t);
    if(btn){
      btn.classList.toggle('active-filter',t===tab);
    }
  });
  if(tab==='resumen'){finDrawChart();finDrawCanalDonut();finRenderResumenAnual();finRenderTopClientes();}
  if(tab==='facturas'){finRenderFacturas();}
  if(tab==='cobrar'){finRenderCobrar();}
  if(tab==='prestamos'){finRenderPrestamos();finDrawDeudaTimeline();}
  if(tab==='nueva'){finRenderNuevaLista();}
  if(tab==='diario'){ldInit();}
  if(tab==='aging'){finRenderAging();}
  if(tab==='presupuesto'){renderPresupuesto();}
}

/* ── Tabla mensual comparativa ── */
function finRenderMensual(){
  const tb=document.getElementById('finMensualBody');
  if(!tb)return;
  const VM=finVentasMerged();
  const max23=Math.max(...VM[2023]);
  const max24=Math.max(...VM[2024]);
  const max25=Math.max(...VM[2025]);
  const max26=Math.max(...VM[2026]);
  function heatBg(v,maxV,alpha){
    if(!v||!maxV)return '';
    const ratio=v/maxV;
    const r=Math.round(0*ratio+30*(1-ratio));
    const g=Math.round(212*ratio+30*(1-ratio));
    const b=Math.round(204*ratio+30*(1-ratio));
    return `background:rgba(${r},${g},${b},${alpha*ratio.toFixed(2)})`;
  }
  let html='';
  FIN_MESES.forEach((m,i)=>{
    const v23=VM[2023][i]||0;
    const v24=VM[2024][i]||0;
    const v25=VM[2025][i]||0;
    const v26=VM[2026][i]||0;
    const p2324=varPct(v23,v24),p2425=varPct(v24,v25),p2526=varPct(v25,v26);
    html+=`<tr>
      <td style="font-weight:600">${m}</td>
      <td style="${heatBg(v23,max23,0.35)}">${v23?clp(v23):'—'}</td>
      <td style="${heatBg(v24,max24,0.35)}">${v24?clp(v24):'—'}</td>
      <td>${p2324!==null?pct(p2324):'—'}</td>
      <td style="${heatBg(v25,max25,0.35)}">${v25?clp(v25):'—'}</td>
      <td>${p2425!==null?pct(p2425):'—'}</td>
      <td style="${heatBg(v26,max26,0.4)};color:var(--accent);font-weight:700">${v26?clp(v26):'—'}</td>
      <td>${(v25&&v26)?pct(p2526):'—'}</td>
    </tr>`;
  });
  tb.innerHTML=html;
}

/* ── Gráfico canvas ── */
function finChartSetYear(y){
  finChartActiveYear=y;
  ['all',2023,2024,2025,2026].forEach(k=>{
    const btn=document.getElementById('fc-'+k);
    if(btn)btn.classList.toggle('btn-mini-yellow',k===y);
  });
  finDrawChart();
}
function finDrawChart(){
  const canvas=document.getElementById('finVentasChart');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const w=canvas.offsetWidth||canvas.parentElement?.clientWidth||600;
  canvas.width=w;
  canvas.height=220;
  ctx.clearRect(0,0,w,220);
  const years=finChartActiveYear==='all'?[2023,2024,2025,2026]:[finChartActiveYear];
  const colors={2023:'rgba(167,139,250,0.8)',2024:'rgba(255,170,0,0.8)',2025:'rgba(255,107,53,0.8)',2026:'rgba(0,212,204,0.9)'};
  const pad={t:20,r:10,b:40,l:60};
  const ch=220-pad.t-pad.b;
  const cw=w-pad.l-pad.r;
  // max
  const VM=finVentasMerged();
  let maxVal=0;
  years.forEach(y=>VM[y].forEach(v=>{if(v>maxVal)maxVal=v;}));
  if(!maxVal)maxVal=1;
  const barW=Math.max(4,Math.floor((cw/12)/years.length)-2);
  const grpW=cw/12;
  // grid lines
  ctx.strokeStyle='rgba(255,255,255,0.06)';ctx.lineWidth=1;
  for(let i=0;i<=4;i++){
    const y2=pad.t+ch*(1-i/4);
    ctx.beginPath();ctx.moveTo(pad.l,y2);ctx.lineTo(w-pad.r,y2);ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.3)';ctx.font='9px DM Sans';ctx.textAlign='right';
    ctx.fillText(clp(Math.round(maxVal*i/4)),pad.l-4,y2+3);
  }
  // bars
  years.forEach((y,yi)=>{
    VM[y].forEach((v,mi)=>{
      if(!v)return;
      const bh=Math.round((v/maxVal)*ch);
      const x=pad.l+grpW*mi+(yi*(barW+2))+(grpW-years.length*(barW+2))/2;
      const yPos=pad.t+ch-bh;
      ctx.fillStyle=colors[y]||'rgba(0,212,204,0.8)';
      ctx.beginPath();ctx.roundRect(x,yPos,barW,bh,2);ctx.fill();
    });
  });
  // month labels
  ctx.fillStyle='rgba(255,255,255,0.4)';ctx.font='9px DM Sans';ctx.textAlign='center';
  FIN_MESES.forEach((m,i)=>{ctx.fillText(m,pad.l+grpW*i+grpW/2,220-pad.b+12);});
  // legend
  ctx.font='10px DM Sans';ctx.textAlign='left';
  years.forEach((y,i)=>{
    ctx.fillStyle=colors[y];ctx.fillRect(pad.l+i*60,6,10,8);
    ctx.fillStyle='rgba(255,255,255,0.6)';ctx.fillText(y,pad.l+i*60+14,14);
  });
}

/* ── Tabla de facturas ── */
function finFacturasFromAirtable(){
  return state.facturas
    .filter(r=>r.fields['Total']>0||r.fields['Neto']>0)
    .map(r=>{
      const f=r.fields;
      const fecha=f['Fecha']||'';
      const year=fecha.slice(0,4)||String(new Date().getFullYear());
      const mes=String(parseInt(fecha.slice(5,7))||1).padStart(2,'0');
      const neto=f['Neto']||0;
      const iva=f['IVA']||0;
      const exento=f['Exento']||0;
      const total=f['Total']||0;
      const porCobrar=f['Estado Pago']==='Cobrada'?0:total;
      return{
        year,mes,
        nombre:f['Cliente']||'—',
        empresa:f['Cliente']||'—',
        item:f['Tipo DTE']||'DTE',
        cant:1,
        valor:neto||total,
        porCobrar,
        fact:f['Folio']||'',
        canal:'DTE',
        cat:f['Estado Pago']||'Pendiente',
        _neto:neto,_iva:iva,_exento:exento,_total:total,
      };
    });
}
function finGetAllFacturas(){
  let local;try{local=JSON.parse(localStorage.getItem('fin_ventas')||'[]');}catch(e){local=[];}
  return [...FIN_FACTURAS_BASE,...local,...finFacturasFromAirtable()];
}
function finVentasMerged(){
  const m={};
  [2022,2023,2024,2025,2026].forEach(y=>{m[y]=[...FIN_VENTAS[y]];});
  let _fvLocal;try{_fvLocal=JSON.parse(localStorage.getItem('fin_ventas')||'[]');}catch(e){_fvLocal=[];}
  _fvLocal.forEach(r=>{
    const y=parseInt(r.year,10),mi=(parseInt(r.mes,10)||1)-1;
    if(m[y])m[y][mi]=(m[y][mi]||0)+r.valor*r.cant;
  });
  return m;
}
function finRenderFacturas(){
  const year=document.getElementById('fin-filtro-year')?.value||'';
  const mes=document.getElementById('fin-filtro-mes')?.value||'';
  const canal=document.getElementById('fin-filtro-canal')?.value||'';
  const buscar=(document.getElementById('fin-filtro-buscar')?.value||'').toLowerCase();
  let data=finGetAllFacturas().filter(r=>{
    if(year&&r.year!==year)return false;
    if(mes&&r.mes!==mes)return false;
    if(canal&&r.canal!==canal)return false;
    if(buscar&&!(r.nombre.toLowerCase().includes(buscar)||r.empresa.toLowerCase().includes(buscar)||r.item.toLowerCase().includes(buscar)))return false;
    return true;
  });
  finFactFiltradas=data;
  finFactPag=0;
  finRenderFacturasPage();
}
function finRenderFacturasPage(){
  const data=finFactFiltradas;
  const total=data.length;
  const pages=Math.ceil(total/FIN_PAG_SIZE)||1;
  const slice=data.slice(finFactPag*FIN_PAG_SIZE,(finFactPag+1)*FIN_PAG_SIZE);
  const MESES_FULL=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  let html='',sumNeto=0,sumIva=0,sumTotal=0,sumCobrar=0;
  data.forEach(r=>{
    const neto=r._neto!=null?r._neto:r.valor*r.cant;
    const iva=r._iva!=null?r._iva:Math.round(neto*0.19);
    const tot=r._total!=null?r._total:neto+iva;
    sumNeto+=neto;sumIva+=iva;sumTotal+=tot;sumCobrar+=r.porCobrar||0;
  });
  slice.forEach(r=>{
    const neto=r._neto!=null?r._neto:r.valor*r.cant;
    const iva=r._iva!=null?r._iva:Math.round(neto*0.19);
    const tot=r._total!=null?r._total:neto+iva;
    const mesNombre=MESES_FULL[(parseInt(r.mes,10)||1)-1];
    const canalBadge=r.canal==='ADWORDS'?'badge-yellow':r.canal==='VENDEDORES'?'badge-green':r.canal==='DTE'?'badge-purple':'badge-gray';
    html+=`<tr>
      <td data-label="Mes/Año" style="white-space:nowrap">${mesNombre} ${r.year}</td>
      <td data-label="Cliente" style="font-weight:600;white-space:nowrap">${r.nombre}</td>
      <td data-label="Empresa" style="color:var(--text2);font-size:11px">${r.empresa}</td>
      <td data-label="Ítem">${r.item}</td>
      <td data-label="Cant." style="text-align:right">${r.cant.toLocaleString('es-CL')}</td>
      <td data-label="Valor Unit." style="text-align:right">${clp(r.valor)}</td>
      <td data-label="Neto" style="text-align:right">${clp(neto)}</td>
      <td data-label="IVA" style="text-align:right;color:var(--text3)">${clp(iva)}</td>
      <td data-label="Total+IVA" style="text-align:right;font-weight:600;color:var(--accent)">${clp(tot)}</td>
      <td data-label="Por Cobrar" style="text-align:right;color:${r.porCobrar>0?'var(--danger)':'var(--accent3)'}">${clp(r.porCobrar)}</td>
      <td data-label="Fact.N°" style="font-size:11px;color:var(--text3)">${r.fact||'—'}</td>
      <td data-label="Canal"><span class="badge ${canalBadge}">${r.canal}</span></td>
      <td data-label="Categoría" style="font-size:11px">${r.cat||'—'}</td>
    </tr>`;
  });
  if(!slice.length)html='<tr><td colspan="13" style="text-align:center;padding:30px;color:var(--text3)">Sin resultados</td></tr>';
  document.getElementById('fin-facturas-body').innerHTML=html;
  document.getElementById('fin-fact-count').textContent=total+' registros';
  document.getElementById('fin-fact-totales').textContent=`Totales filtrados → Neto: ${clp(sumNeto)} | IVA: ${clp(sumIva)} | Total: ${clp(sumTotal)} | Por cobrar: ${clp(sumCobrar)}`;
  document.getElementById('fin-pag-info').textContent=`${finFactPag+1}/${pages}`;
  document.getElementById('fin-pag-prev').disabled=finFactPag===0;
  document.getElementById('fin-pag-next').disabled=finFactPag>=pages-1;
}
function finPagPrev(){if(finFactPag>0){finFactPag--;finRenderFacturasPage();}}
function finPagNext(){const pages=Math.ceil(finFactFiltradas.length/FIN_PAG_SIZE);if(finFactPag<pages-1){finFactPag++;finRenderFacturasPage();}}

/* ── Por cobrar ── */
// Plazo de pago por defecto (configurable) — muchos clientes B2B en Chile son a 30/60/90 días
function finPlazoDefault(){const v=parseInt(localStorage.getItem('fin_plazo_default'));return(v>0&&v<=365)?v:30;}
function setFinPlazoDefault(v){const n=parseInt(v)||30;localStorage.setItem('fin_plazo_default',Math.max(0,Math.min(365,n)));try{finRenderCobrar();finRenderAging();}catch(e){}}
// Vencimiento real de una factura: usa fecha explícita o plazo propio si existen; si no, el plazo por defecto
function finVenc(r){
  if(r&&r.venc){const d=new Date(r.venc);if(!isNaN(d))return d;}
  const base=new Date(`${r.year}-${r.mes}-01`).getTime();
  const plazo=(r&&r.plazoDias>0)?r.plazoDias:finPlazoDefault();
  return new Date(base+plazo*86400000);
}
function finRenderCobrar(){
  const data=finGetAllFacturas().filter(r=>r.porCobrar>0);
  const MESES_FULL=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const hoy=Date.now();
  // Aging buckets
  const buckets={b0:0,b30:0,b60:0,b90:0};
  let sumTotal=0;
  data.forEach(r=>{
    const tot=r._total!=null?r._total:(r.valor*r.cant+Math.round(r.valor*r.cant*0.19));
    const cobrar=r.porCobrar||tot;
    sumTotal+=cobrar;
    const venc=finVenc(r);
    const dias=Math.max(0,Math.floor((hoy-venc.getTime())/86400000));
    if(dias<=30) buckets.b0+=cobrar;
    else if(dias<=60) buckets.b30+=cobrar;
    else if(dias<=90) buckets.b60+=cobrar;
    else buckets.b90+=cobrar;
  });

  // Resumen aging
  // Proyección de caja del libro de pedidos en curso: anticipos/saldos aún no cobrados (distinto de facturas emitidas)
  const _pedCurso=(state.pedidos||[]).filter(p=>!['Despachado','Cancelado'].includes(p.fields['Estado pedido']||''));
  const proyPedidos=_pedCurso.reduce((s,p)=>{const f=p.fields,neto=(f['Monto total (CLP)']||0)/1.19;let r=0;if(!f['Anticipo pagado (50%)'])r+=neto*0.5;if(!f['Saldo pagado (50%)'])r+=neto*0.5;return s+r;},0);
  const nProy=_pedCurso.filter(p=>{const f=p.fields;return!f['Anticipo pagado (50%)']||!f['Saldo pagado (50%)'];}).length;
  const agingEl=document.getElementById('fin-cobrar-aging');
  if(agingEl){
    agingEl.innerHTML=(data.length?`
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <div class="fac-kpi" style="flex:1;min-width:80px"><span class="fac-kpi-lbl">Total cobrar</span><span class="fac-kpi-val" style="color:var(--danger)">${clp(sumTotal)}</span></div>
      <div class="fac-kpi" style="flex:1;min-width:80px"><span class="fac-kpi-lbl">0–30 días</span><span class="fac-kpi-val" style="color:var(--warn)">${clp(buckets.b0)}</span></div>
      <div class="fac-kpi" style="flex:1;min-width:80px"><span class="fac-kpi-lbl">31–60 días</span><span class="fac-kpi-val" style="color:var(--warn)">${clp(buckets.b30)}</span></div>
      <div class="fac-kpi" style="flex:1;min-width:80px"><span class="fac-kpi-lbl">61–90 días</span><span class="fac-kpi-val" style="color:var(--danger)">${clp(buckets.b60)}</span></div>
      <div class="fac-kpi fac-kpi-danger" style="flex:1;min-width:80px"><span class="fac-kpi-lbl">&gt;90 días</span><span class="fac-kpi-val">${clp(buckets.b90)}</span></div>
    </div>
    <div style="display:flex;align-items:center;gap:7px;margin-bottom:12px;font-size:11px;color:var(--text3)">
      <span>Plazo de pago estándar:</span>
      <input type="number" min="0" max="365" value="${finPlazoDefault()}" onchange="setFinPlazoDefault(this.value)" style="width:60px;background:var(--surface);border:1px solid var(--border2);border-radius:6px;padding:3px 7px;color:var(--text);font-size:11px;text-align:center"> días
      <span style="color:var(--text3)" title="La mora se calcula desde el vencimiento (inicio de mes de la factura + este plazo). Las facturas con fecha o plazo propio usan el suyo.">ⓘ</span>
    </div>`:'')+(proyPedidos>0?`
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:9px 12px;background:rgba(0,212,170,0.06);border:1px solid rgba(0,212,170,0.22);border-radius:8px;font-size:11px">
      <span style="font-size:14px">📥</span>
      <span style="color:var(--text2)">Por entrar de <b>pedidos en curso</b> (anticipos/saldos pendientes, neto): <b style="color:var(--accent3)">${clp(proyPedidos)}</b> · ${nProy} pedido${nProy!==1?'s':''}</span>
      <span style="color:var(--text3)" title="Proyección de caja del libro de pedidos activos (no despachados ni cancelados): suma los 50% de anticipo y saldo aún no marcados como pagados. Es distinto de las facturas emitidas de arriba.">ⓘ</span>
    </div>`:'');
  }

  // Mora por factura + orden por urgencia (más morosa primero)
  const ordenadas=data.map(r=>{
    const dias=Math.max(0,Math.floor((hoy-finVenc(r).getTime())/86400000));
    return{...r,_dias:dias};
  }).sort((a,b)=>b._dias-a._dias||(b.porCobrar||0)-(a.porCobrar||0));
  let html='';
  ordenadas.forEach(r=>{
    const tot=r._total!=null?r._total:(r.valor*r.cant+Math.round(r.valor*r.cant*0.19));
    const cobrar=r.porCobrar||tot;
    const mesNombre=MESES_FULL[(parseInt(r.mes,10)||1)-1];
    const d=r._dias;const mcol=d>90?'var(--danger)':d>30?'var(--warn)':'var(--text3)';
    const mlbl=d<=0?'—':`${d}d`;
    html+=`<tr>
      <td data-label="Mes">${mesNombre} ${r.year}</td>
      <td data-label="Cliente" style="font-weight:600">${r.nombre}</td>
      <td data-label="Empresa">${r.empresa}</td>
      <td data-label="Ítem">${r.item}</td>
      <td data-label="Total+IVA" style="text-align:right">${clp(tot)}</td>
      <td data-label="Por Cobrar" style="text-align:right;color:var(--danger);font-weight:700">${clp(cobrar)}</td>
      <td data-label="Mora" style="text-align:right;color:${mcol};font-weight:600">${mlbl}</td>
      <td data-label="Fact.N°">${r.fact||'—'}</td>
    </tr>`;
  });
  if(!html)html='<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--accent3)">✓ Sin facturas pendientes de cobro registradas</td></tr>';
  document.getElementById('fin-cobrar-body').innerHTML=html;
  try{finRenderCobranzaActions();}catch(e){}
}
// Exporta la cartera por cobrar (ordenada por mora) a CSV para trabajarla aparte o pasarla a cobranza
function finExportCobranza(){
  const data=finGetAllFacturas().filter(r=>r.porCobrar>0);
  if(!data.length){toast('No hay facturas pendientes de cobro','error');return;}
  const hoy=Date.now();const MESES=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const rows=data.map(r=>{const tot=r._total!=null?r._total:(r.valor*r.cant+Math.round(r.valor*r.cant*0.19));const cobrar=r.porCobrar||tot;const dias=Math.max(0,Math.floor((hoy-finVenc(r).getTime())/86400000));return{r,tot,cobrar,dias};}).sort((a,b)=>b.dias-a.dias||b.cobrar-a.cobrar);
  const head=['Cliente','Empresa','Mes','Ítem','Total+IVA','Por Cobrar','Mora (días)','Fact. N°'];
  const lines=[head.map(q).join(',')];
  rows.forEach(({r,tot,cobrar,dias})=>lines.push([r.nombre,r.empresa,`${MESES[(parseInt(r.mes,10)||1)-1]} ${r.year}`,r.item,tot,cobrar,dias,r.fact||''].map(q).join(',')));
  const blob=new Blob(['﻿'+lines.join('\n')],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='cobranza_pendiente_'+new Date().toISOString().slice(0,10)+'.csv';a.click();
  toast('✓ Cobranza exportada a CSV','success');
}
// ── COBRANZA SEMI-AUTOMÁTICA ───────────────────────────────────
// Lista accionable de la cartera priorizada por mora: cada cliente con botones
// de recordatorio (WhatsApp / correo desde hola@ con la firma de Andrea) y
// registro de cuándo se le cobró (localStorage + nota en el cliente).
const _COB_LOG_KEY='thelab_cob_log_v1';
function _cobLog(){try{return JSON.parse(localStorage.getItem(_COB_LOG_KEY)||'{}');}catch(e){return{};}}
function _cobLast(empresa){const l=_cobLog()[(empresa||'').toLowerCase()];return l&&l.length?l[l.length-1]:null;}
function _cobCliente(empresa){
  const k=(empresa||'').toLowerCase(); if(!k||k==='—') return null;
  return (state.clientes||[]).find(c=>((c.fields['Empresa']||'').toLowerCase()===k)||((c.fields['Contacto']||'').toLowerCase()===k))||null;
}
function _cobGrupos(){
  const data=finGetAllFacturas().filter(r=>r.porCobrar>0);
  const hoy=Date.now(),byCli=new Map();
  data.forEach(r=>{
    const dias=Math.max(0,Math.floor((hoy-finVenc(r).getTime())/86400000));
    const k=(r.empresa&&r.empresa!=='—')?r.empresa:(r.nombre||'—');
    const e=byCli.get(k)||{empresa:k,total:0,maxDias:0,n:0};
    e.total+=r.porCobrar;e.maxDias=Math.max(e.maxDias,dias);e.n++;byCli.set(k,e);
  });
  return [...byCli.values()].sort((a,b)=>b.maxDias-a.maxDias||b.total-a.total);
}
function _cobMsg(g,contacto){
  const facts=g.n>1?`${g.n} facturas pendientes`:'una factura pendiente';
  return `Hola${contacto?' '+contacto:''} 👋 Te saludo de The Lab Solutions. Te escribo por ${facts} por un total de ${clp(g.total)}${g.maxDias>0?` (la más antigua lleva ${g.maxDias} días vencida)`:''}. ¿Me confirmas si el pago ya está programado o necesitas que te reenviemos los documentos? ¡Muchas gracias! 💙\n— Andrea Garrido · The Lab Solutions`;
}
function finRenderCobranzaActions(){
  const box=document.getElementById('finCobranzaActions'); if(!box) return;
  const gs=_cobGrupos().slice(0,10);
  if(!gs.length){box.style.display='none';box.innerHTML='';return;}
  box.style.display='block';
  box.innerHTML='<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--warn);padding:0 14px 6px">📞 Acciones de cobranza · prioridad por mora</div>'+gs.map(g=>{
    const cli=_cobCliente(g.empresa);
    const tienePhone=!!(cli&&_getClienteWAPhone(cli));
    const last=_cobLast(g.empresa);
    const lastChip=last?`<span class="badge badge-gray" style="flex-shrink:0" title="Último recordatorio (${last.via})">✓ hace ${Math.max(0,Math.floor((Date.now()-last.ts)/864e5))}d</span>`:'';
    const emp=escapeHtml(g.empresa);
    return `<div style="display:flex;align-items:center;gap:9px;padding:8px 14px;border-top:1px solid var(--border)">
      <span class="badge ${g.maxDias>60?'badge-red':(g.maxDias>30?'badge-orange':'badge-yellow')}" style="flex-shrink:0" title="Mora máxima">${g.maxDias} d</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${emp}</div>
        <div style="font-size:10.5px;color:var(--text3)">${clp(g.total)} · ${g.n} factura${g.n>1?'s':''}${cli?'':' · <span style="color:var(--warn)">sin ficha de cliente</span>'}</div>
      </div>
      ${lastChip}
      <button class="btn btn-primary btn-sm" style="flex-shrink:0" data-emp="${emp}" onclick="cobWhatsApp(this.dataset.emp)" ${tienePhone?'':'title="Sin teléfono en la ficha — se abrirá WhatsApp para elegir contacto"'}>📲</button>
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0" data-emp="${emp}" onclick="cobEmail(this.dataset.emp,this)">📧</button>
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0" data-emp="${emp}" title="Registrar gestión de cobro sin enviar" onclick="cobRegistrar(this.dataset.emp,'gestión manual')">✓</button>
    </div>`;
  }).join('');
}
function cobWhatsApp(empresa){
  const g=_cobGrupos().find(x=>x.empresa===empresa); if(!g){toast('Sin datos de esa empresa','error');return;}
  const cli=_cobCliente(empresa);
  const phone=cli?_getClienteWAPhone(cli):'';
  const nombre=cli&&cli.fields['Contacto']?String(cli.fields['Contacto']).trim().split(/\s+/)[0]:'';
  window.open('https://wa.me/'+(phone||'')+'?text='+encodeURIComponent(_cobMsg(g,nombre)),'_blank');
  cobRegistrar(empresa,'WhatsApp',true);
}
async function cobEmail(empresa,btn){
  const g=_cobGrupos().find(x=>x.empresa===empresa); if(!g){toast('Sin datos de esa empresa','error');return;}
  const cli=_cobCliente(empresa);
  let to=cli?.fields['Email']||prompt('¿A qué correo enviamos el recordatorio a '+empresa+'?','');
  if(!to)return; to=String(to).trim();
  if(!validEmail(to)){toast('Correo inválido','error');return;}
  const nombre=cli&&cli.fields['Contacto']?String(cli.fields['Contacto']).trim().split(/\s+/)[0]:'';
  const prev=btn?btn.innerHTML:'';
  if(btn){btn.disabled=true;btn.textContent='…';}
  try{
    const r=await MAIL.postAs(AGENT_CTA_FROM.email,{action:'send',to,subject:'Recordatorio de pago — The Lab Solutions',body:_cobMsg(g,nombre),from_name:AGENT_CTA_FROM.name});
    if(r&&!r.error){toast('✓ Recordatorio enviado a '+to,'success');cobRegistrar(empresa,'correo',true);}
    else throw new Error(r?.error||'Error desconocido');
  }catch(e){toast('Error: '+e.message,'error');}
  finally{if(btn){btn.disabled=false;btn.innerHTML=prev;}}
}
async function cobRegistrar(empresa,via,silent){
  const k=(empresa||'').toLowerCase();
  const log=_cobLog(); (log[k]=log[k]||[]).push({ts:Date.now(),via:via||'—'});
  try{localStorage.setItem(_COB_LOG_KEY,JSON.stringify(log));}catch(e){}
  // Deja constancia en la ficha del cliente (best-effort)
  const cli=_cobCliente(empresa);
  if(cli){
    const nota=`[${new Date().toISOString().slice(0,10)}] Recordatorio de cobranza enviado por ${via} (Andrea)`;
    const nuevo=(cli.fields['Notas internas']?String(cli.fields['Notas internas']).trim()+'\n':'')+nota;
    try{await airtableWriteTolerant('Clientes','PATCH',cli.id,{'Notas internas':nuevo});cli.fields['Notas internas']=nuevo;}catch(e){}
  }
  if(!silent) toast('✓ Gestión de cobro registrada','success');
  finRenderCobranzaActions();
}

// Plan de cobranza con IA: prioriza toda la cartera por mora y monto (FINANCE_AGENT)
async function finPlanCobranzaIA(){
  const data=finGetAllFacturas().filter(r=>r.porCobrar>0);
  if(!data.length){toast('No hay facturas pendientes de cobro','info');return;}
  const hoy=Date.now(),byCli=new Map();
  data.forEach(r=>{
    const dias=Math.max(0,Math.floor((hoy-finVenc(r).getTime())/86400000));
    const k=r.empresa||r.nombre||'—';
    const e=byCli.get(k)||{empresa:k,total:0,maxDias:0,n:0};
    e.total+=r.porCobrar;e.maxDias=Math.max(e.maxDias,dias);e.n++;byCli.set(k,e);
  });
  const lista=[...byCli.values()].sort((a,b)=>b.maxDias-a.maxDias||b.total-a.total);
  const total=lista.reduce((s,e)=>s+e.total,0);
  const ctx=`CARTERA POR COBRAR (total ${formatCLP(total)}, ${lista.length} clientes):\n`+
    lista.map(e=>`- ${e.empresa}: ${formatCLP(e.total)} · ${e.n} factura(s) · mora máx ${e.maxDias} días`).join('\n')+
    `\n\nTAREA: prioriza la cobranza de esta semana. Para los 5–8 casos más urgentes indica en orden: prioridad, canal recomendado (WhatsApp → email → llamada → carta según mora) y la acción concreta. Cierra con el monto total recuperable priorizado.`;
  const out=document.getElementById('finCobranzaIAout'),btn=document.getElementById('finCobranzaIABtn'),prev=btn.innerHTML;
  btn.disabled=true;btn.innerHTML='⏳ Analizando…';
  if(out){out.style.display='block';out.textContent='⏳ FINANCE_AGENT priorizando la cobranza…';}
  try{showAgentWorking('FINANCE',{verb:'está priorizando tu cobranza…',messages:['Revisando la cartera por cobrar…','Ordenando por mora y monto…','Definiendo canal y acción por cliente…']});}catch(e){}
  try{
    const cfg=AGENTES_CFG.find(a=>a.id==='FINANCE');
    const resp=await callClaude(cfg.sys,ctx);
    if(out){out.style.whiteSpace='normal';out.innerHTML=formatAgentReport(resp);}
    try{AGENT_LOG.add('FINANCE_AGENT','Plan de cobranza ('+lista.length+' clientes)',resp);}catch(e){}
  }catch(e){if(out)out.textContent='Error: '+e.message;}
  finally{try{hideAgentWorking();}catch(e){}btn.disabled=false;btn.innerHTML=prev;}
}

/* ── Antigüedad de cuentas por cobrar ── */
function finRenderAging(){
  const data=finGetAllFacturas().filter(r=>r.porCobrar>0);
  const filterVal=document.getElementById('fin-aging-filter')?.value||'all';
  const hoy=Date.now();
  const buckets={b0:0,b30:0,b60:0,b90:0};
  let sumTotal=0;
  const rows=[];
  data.forEach(r=>{
    const tot=r._total!=null?r._total:(r.valor*r.cant+Math.round(r.valor*r.cant*0.19));
    const cobrar=r.porCobrar||tot;
    sumTotal+=cobrar;
    const dias=Math.max(0,Math.floor((hoy-finVenc(r).getTime())/86400000));
    let tramo,tramoLabel,tramoColor;
    if(dias<=30){buckets.b0+=cobrar;tramo='0';tramoLabel='Corriente';tramoColor='var(--accent3)';}
    else if(dias<=60){buckets.b30+=cobrar;tramo='31';tramoLabel='31–60 días';tramoColor='var(--warn)';}
    else if(dias<=90){buckets.b60+=cobrar;tramo='61';tramoLabel='61–90 días';tramoColor='var(--accent2)';}
    else{buckets.b90+=cobrar;tramo='91';tramoLabel='+90 días';tramoColor='var(--danger)';}
    if(filterVal==='all'||filterVal===tramo) rows.push({r,tot,cobrar,dias,tramoLabel,tramoColor});
  });
  // KPIs
  const setText=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  setText('fin-ag-total',clp(sumTotal));
  setText('fin-ag-cnt',`${data.length} facturas`);
  setText('fin-ag-b0',clp(buckets.b0));
  setText('fin-ag-b30',clp(buckets.b30));
  setText('fin-ag-b60',clp(buckets.b60));
  setText('fin-ag-b90',clp(buckets.b90));
  // Barra visual
  const barEl=document.getElementById('fin-ag-bar');
  if(barEl&&sumTotal>0){
    const segs=[
      {v:buckets.b0,c:'var(--accent3)'},
      {v:buckets.b30,c:'var(--warn)'},
      {v:buckets.b60,c:'var(--accent2)'},
      {v:buckets.b90,c:'var(--danger)'}
    ].filter(s=>s.v>0);
    barEl.innerHTML=segs.map(s=>`<div style="flex:${s.v};background:${s.c};min-width:4px"></div>`).join('');
  }
  // Tabla
  let html='';
  rows.sort((a,b)=>b.dias-a.dias).forEach(({r,tot,cobrar,dias,tramoLabel,tramoColor})=>{
    html+=`<tr>
      <td><div style="font-weight:600">${escapeHtml(r.nombre||'—')}</div><div style="font-size:10px;color:var(--text3)">${escapeHtml(r.empresa||'')}</div></td>
      <td style="font-size:11px">${escapeHtml(r.item||r.fact||'—')}</td>
      <td style="text-align:right">${clp(tot)}</td>
      <td style="text-align:right;color:var(--danger);font-weight:700">${clp(cobrar)}</td>
      <td style="text-align:center;font-family:'JetBrains Mono',monospace;font-size:12px;color:${tramoColor};font-weight:700">${dias}</td>
      <td style="text-align:center"><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:${tramoColor}22;color:${tramoColor};border:1px solid ${tramoColor}44">${tramoLabel}</span></td>
    </tr>`;
  });
  if(!html)html='<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--accent3)">✓ Sin facturas pendientes de cobro</td></tr>';
  const tb=document.getElementById('fin-aging-body');if(tb)tb.innerHTML=html;
}
function finExportAgingCSV(){
  const data=finGetAllFacturas().filter(r=>r.porCobrar>0);
  const hoy=Date.now();
  const rows=[['Cliente','Empresa','Referencia','Total c/IVA','Por Cobrar','Días Vencido','Tramo']];
  data.forEach(r=>{
    const tot=r._total!=null?r._total:(r.valor*r.cant+Math.round(r.valor*r.cant*0.19));
    const cobrar=r.porCobrar||tot;
    const dias=Math.max(0,Math.floor((hoy-finVenc(r).getTime())/86400000));
    const tramo=dias<=30?'Corriente':dias<=60?'31-60 días':dias<=90?'61-90 días':'+90 días';
    rows.push([r.nombre||'',r.empresa||'',r.item||r.fact||'',tot,cobrar,dias,tramo]);
  });
  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,﻿'+encodeURIComponent(csv);
  a.download='antiguedad_'+new Date().toISOString().slice(0,10)+'.csv';a.click();
}

/* ── Préstamos ── */
function finRenderPrestamos(){
  const tb=document.getElementById('fin-prestamos-body');
  if(!tb)return;
  const maxDeuda=Math.max(...FIN_PRESTAMOS.map(r=>r.deuda));
  let html='';
  FIN_PRESTAMOS.forEach(r=>{
    const esDev=!r.prestamo&&r.devolucion;
    const pct=Math.round((r.deuda/maxDeuda)*100);
    const barColor=esDev?'var(--accent3)':'var(--danger)';
    html+=`<tr>
      <td data-label="Fecha" style="font-family:monospace;font-size:11px">${r.fecha}</td>
      <td data-label="Préstamo" style="color:${r.prestamo?'var(--danger)':'var(--text3)'};font-weight:${r.prestamo?700:400}">${r.prestamo?clp(r.prestamo):'—'}</td>
      <td data-label="Devolución" style="color:${esDev?'var(--accent3)':'var(--text3)'};font-weight:${esDev?700:400}">${r.devolucion?clp(r.devolucion):'—'}</td>
      <td data-label="Deuda" style="font-weight:700;color:var(--accent)">${clp(r.deuda)}</td>
      <td data-label="Progreso" style="min-width:80px"><div style="height:6px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden"><div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;transition:width .3s"></div></div></td>
      <td data-label="Obs." style="font-size:11px;color:var(--text3)">${r.obs||''}</td>
    </tr>`;
  });
  tb.innerHTML=html;
}

/* ── Nueva Venta ── */
function nvRecalcular(){
  const cant=parseFloat(document.getElementById('nv-cantidad').value)||0;
  const val=parseFloat(document.getElementById('nv-valor').value)||0;
  const pago=parseFloat(document.getElementById('nv-pago').value)||0;
  const costo=parseFloat(document.getElementById('nv-costo').value)||0;
  const neto=cant*val;
  const iva=Math.round(neto*0.19);
  const tot=neto+iva;
  document.getElementById('nv-total').value=clp(neto);
  document.getElementById('nv-iva').value=clp(iva);
  document.getElementById('nv-total-iva').value=clp(tot);
  document.getElementById('nv-utilidad').value=costo?clp(tot-costo):'—';
}
function nvLimpiar(){
  ['nv-nombre','nv-empresa','nv-rut','nv-factura','nv-item','nv-pago','nv-costo','nv-fecha-fact','nv-fecha-pago'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.value='';
  });
  ['nv-cantidad','nv-valor'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  nvRecalcular();
}
function nvGuardar(){
  const cant=parseFloat(document.getElementById('nv-cantidad').value)||1;
  const val=parseFloat(document.getElementById('nv-valor').value)||0;
  const pago=parseFloat(document.getElementById('nv-pago').value)||0;
  const nombre=document.getElementById('nv-nombre').value.trim();
  const empresa=document.getElementById('nv-empresa').value.trim();
  const item=document.getElementById('nv-item').value.trim();
  if(!nombre||!item||!val){alert('Completa al menos Nombre, Ítem y Valor.');return;}
  const noto=cant*val;
  const iva=Math.round(noto*0.19);
  const tot=noto+iva;
  const cobrar=Math.max(0,tot-pago);
  const rec={
    year:document.getElementById('nv-year').value,
    mes:document.getElementById('nv-mes').value,
    nombre,empresa,item,cant,valor:val,
    canal:document.getElementById('nv-canal').value,
    cat:document.getElementById('nv-categoria').value,
    fact:document.getElementById('nv-factura').value,
    pago:pago,porCobrar:cobrar,
    fechaFact:document.getElementById('nv-fecha-fact').value,
    fechaPago:document.getElementById('nv-fecha-pago').value,
    _manual:true
  };
  let existing;try{existing=JSON.parse(localStorage.getItem('fin_ventas')||'[]');}catch(e){existing=[];}
  existing.push(rec);
  try{localStorage.setItem('fin_ventas',JSON.stringify(existing));}catch(e){toast('Sin espacio para guardar','error');return;}
  saveFinVentasAirtable();
  nvLimpiar();
  finRenderNuevaLista();
  toast('Venta guardada correctamente','success');
  finInit();
}
function nvLimpiarTodas(){
  if(!confirm('¿Eliminar todas las ventas ingresadas manualmente?'))return;
  localStorage.removeItem('fin_ventas');
  saveFinVentasAirtable();
  finRenderNuevaLista();
  finInit();
}
function finRenderNuevaLista(){
  let data;try{data=JSON.parse(localStorage.getItem('fin_ventas')||'[]');}catch(e){data=[];}
  const MESES_FULL=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  let html='';
  data.forEach((r,idx)=>{
    const neto=r.valor*r.cant;
    const tot=neto+Math.round(neto*0.19);
    const mesNombre=MESES_FULL[(parseInt(r.mes,10)||1)-1];
    const canalBadge=r.canal==='ADWORDS'?'badge-yellow':r.canal==='VENDEDORES'?'badge-green':'badge-gray';
    html+=`<tr>
      <td>${mesNombre} ${r.year}</td>
      <td style="font-weight:600">${r.nombre}</td>
      <td>${r.empresa||'—'}</td>
      <td>${r.item}</td>
      <td style="color:var(--accent);font-weight:700">${clp(tot)}</td>
      <td><span class="badge ${canalBadge}">${r.canal}</span></td>
      <td><button class="btn-mini btn-mini-red" onclick="nvEliminar(${idx})">✕</button></td>
    </tr>`;
  });
  if(!html)html='<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text3)">Sin ventas ingresadas aún</td></tr>';
  const tb=document.getElementById('fin-nueva-lista-body');
  if(tb)tb.innerHTML=html;
}
function nvEliminar(idx){
  let data;try{data=JSON.parse(localStorage.getItem('fin_ventas')||'[]');}catch(e){data=[];}
  data.splice(idx,1);
  localStorage.setItem('fin_ventas',JSON.stringify(data));
  saveFinVentasAirtable();
  finRenderNuevaLista();
}

/* ── Exportar CSV ── */
function exportarFinanzasCSV(){
  const data=finGetAllFacturas();
  const headers=['Año','Mes','Nombre','Empresa','Ítem','Cantidad','Valor Unit.','Total Neto','IVA','Total+IVA','Por Cobrar','Canal','Categoría','Factura N°'];
  const rows=data.map(r=>{
    const neto=r.valor*r.cant;
    const iva=Math.round(neto*0.19);
    return [r.year,r.mes,r.nombre,r.empresa,r.item,r.cant,r.valor,neto,iva,neto+iva,r.porCobrar||0,r.canal,r.cat||'',r.fact||''];
  });
  const csv=[headers,...rows].map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='finanzas_thelab.csv';a.click();
  URL.revokeObjectURL(url);
}

/* ── KPI expand toggle ── */
function finToggleKPI(n,e){
  e.stopPropagation();
  const exp=document.getElementById('fin-k'+n+'-exp');
  const btn=e.currentTarget;
  if(!exp)return;
  const open=exp.style.display!=='none';
  exp.style.display=open?'none':'block';
  btn.innerHTML=open?btn.dataset.label:'▴ cerrar';
}

/* ── KPIs dinámicos ── */
function finInitKPIs(){
  const VM=finVentasMerged();
  const v26=VM[2026];
  const v25=VM[2025];
  const tot26=v26.reduce((a,b)=>a+b,0);
  const meses26=v26.filter(v=>v>0).length||1;
  const avg26=Math.round(tot26/meses26);
  const tot25=v25.reduce((a,b)=>a+b,0);
  const avg25=Math.round(tot25/12);
  const varAvg=avg25?Math.round((avg26/avg25-1)*100):0;
  // Por cobrar: facturas con porCobrar>0 (incluyendo ventas manuales)
  const cobrar=finGetAllFacturas().filter(r=>r.porCobrar>0).reduce((a,r)=>a+r.porCobrar,0);
  const cobrarNeto=Math.round(cobrar/1.19);
  // Prestamo ultimo
  const lastPrestamo=FIN_PRESTAMOS[FIN_PRESTAMOS.length-1];
  // Deuda: prestamos + cobrar estimado
  const deudaPrest=lastPrestamo.deuda;
  // 2024 total
  const tot24=VM[2024].reduce((a,b)=>a+b,0);
  function fmt(n){
    if(n>=1e9)return '$'+(n/1e9).toFixed(1)+'B';
    if(n>=1e6)return '$'+(n/1e6).toFixed(1)+'M';
    return clp(n);
  }
  function setKPI(k,val,sub){
    const el=document.getElementById('fin-k'+k);
    const els=document.getElementById('fin-k'+k+'s');
    if(el)el.textContent=val;
    if(els)els.textContent=sub;
  }
  // Totales por año (para expand y record dinámico)
  const yearTotals={};
  [2022,2023,2024,2025,2026].forEach(y=>{yearTotals[y]=VM[y].reduce((a,b)=>a+b,0);});
  const recordYear=Object.entries(yearTotals).reduce((a,b)=>b[1]>a[1]?b:a)[0];
  const recordVal=yearTotals[recordYear];
  // Actualizar label record dinámicamente
  const lbl6=document.getElementById('fin-k6-label');
  if(lbl6)lbl6.textContent='Record — Año '+recordYear;
  setKPI(1,fmt(tot26),'Ene–May 2026');
  setKPI(2,fmt(avg26),(varAvg>=0?'↑':'↓')+Math.abs(varAvg)+'% vs 2025');
  setKPI(3,fmt(cobrar),'Neto: '+fmt(cobrarNeto));
  setKPI(4,fmt(deudaPrest),'Al '+lastPrestamo.fecha);
  setKPI(5,fmt(deudaPrest),'Préstamos pendientes');
  setKPI(6,fmt(recordVal),'Mejor año histórico');
  // ── Contenido expandido ──
  const MS=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  function er(label,val,hl,note){
    const n=note?`<span style="font-size:10px;opacity:0.5;margin-left:5px">${note}</span>`:'';
    return `<div class="kpi-exp-row${hl?' hl':''}"><span class="ker">${label}</span><span class="kev">${val}${n}</span></div>`;
  }
  function setExp(n,html){const el=document.getElementById('fin-k'+n+'-exp');if(el)el.innerHTML=html;
    const btn=document.querySelector('[onclick="finToggleKPI('+n+',event)"]');
    if(btn&&!btn.dataset.label)btn.dataset.label=btn.innerHTML;}
  // Card 1 — Ventas totales por año
  setExp(1,[2022,2023,2024,2025,2026].map(y=>er(String(y),fmt(yearTotals[y]),y===2026,y===2026?'YTD':y===+recordYear?'★ record':'')).join(''));
  // Card 2 — Media mensual por año
  setExp(2,[2022,2023,2024,2025,2026].map(y=>{const v=VM[y].filter(x=>x>0);const a=v.length?Math.round(v.reduce((s,x)=>s+x,0)/v.length):0;return er(String(y),fmt(a),y===2026,v.length+'m');}).join(''));
  // Card 3 — Top deudores
  const byC={};finGetAllFacturas().filter(r=>r.porCobrar>0).forEach(r=>{const k=(r.nombre||r.empresa||'—').slice(0,22);byC[k]=(byC[k]||0)+(r.porCobrar||0);});
  const topC=Object.entries(byC).sort((a,b)=>b[1]-a[1]).slice(0,6);
  setExp(3,topC.length?topC.map(([n,v])=>er(n.length>20?n.slice(0,19)+'…':n,fmt(v),false)).join(''):'<div style="font-size:11px;opacity:0.55;padding:4px 0">Sin facturas pendientes</div>');
  // Card 4 — Historial préstamos (últimas 7 entradas)
  setExp(4,FIN_PRESTAMOS.slice(-7).reverse().map(r=>{const label=r.fecha+(r.obs?' · '+r.obs.slice(0,16):'');const note=r.prestamo?'+'+fmt(r.prestamo):r.devolucion?'−'+fmt(r.devolucion):'';return er(label,fmt(r.deuda),false,note);}).join(''));
  // Card 5 — Evolución deuda (último registro de cada año)
  const dbyY={};FIN_PRESTAMOS.forEach(r=>{const y=r.fecha.slice(-2);dbyY[y]=r.deuda;});
  setExp(5,Object.entries(dbyY).sort().map(([y,d])=>er("'"+y,fmt(d),false)).join(''));
  // Card 6 — Totales por año (con mes récord de cada año)
  setExp(6,[2022,2023,2024,2025,2026].map(y=>{const mx=Math.max(...VM[y]);const mi=VM[y].indexOf(mx);return er(String(y),fmt(yearTotals[y]),y===+recordYear,MS[mi]+' '+fmt(mx));}).join(''));
  // fecha actualización
  const fa=document.getElementById('finActualizadoEn');
  if(fa){const now=new Date();fa.textContent='Datos al '+now.getDate()+'/'+(now.getMonth()+1)+'/'+now.getFullYear();}
}

/* ── Sparklines en KPIs ── */
function finDrawSparklines(){
  const VM=finVentasMerged();
  const datasets=[
    VM[2026].slice(0,6),
    VM[2026].slice(0,6),
    finGetAllFacturas().filter(r=>r.porCobrar>0).reduce((acc,r)=>{const m=parseInt(r.mes)-1;acc[m]=(acc[m]||0)+r.porCobrar;return acc;},Array(6).fill(0)),
    FIN_PRESTAMOS.slice(-6).map(r=>r.deuda),
    FIN_PRESTAMOS.slice(-6).map(r=>r.deuda),
    [2022,2023,2024,2025,2026].map(y=>VM[y].reduce((a,b)=>a+b,0)/1e6)
  ];
  datasets.forEach((data,idx)=>{
    const canvas=document.getElementById('fin-sp'+(idx+1));
    if(!canvas)return;
    const ctx=canvas.getContext('2d');
    const w=80,h=32;
    ctx.clearRect(0,0,w,h);
    const max=Math.max(...data)||1;
    const min=Math.min(...data.filter(v=>v>0))||0;
    const range=max-min||1;
    const pts=data.map((v,i)=>[i*(w/(data.length-1||1)),(1-(v-min)/range)*(h-4)+2]);
    ctx.strokeStyle='rgba(255,255,255,0.7)';
    ctx.lineWidth=1.5;
    ctx.beginPath();
    pts.forEach(([x,y],i)=>i===0?ctx.moveTo(x,y):ctx.lineTo(x,y));
    ctx.stroke();
  });
}

/* ── Donut canal ── */
function finDrawCanalDonut(){
  const canvas=document.getElementById('finCanalDonut');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const w=160,h=160,cx=80,cy=80,r=60,ri=38;
  ctx.clearRect(0,0,w,h);
  const facts2026=finGetAllFacturas().filter(r=>String(r.year)==='2026');
  const totByCanal={};
  facts2026.forEach(r=>{const amt=r.pago!=null?r.pago:r.valor*r.cant;totByCanal[r.canal]=(totByCanal[r.canal]||0)+amt;});
  const entries=Object.entries(totByCanal).sort((a,b)=>b[1]-a[1]);
  const total=entries.reduce((s,[,v])=>s+v,0)||1;
  const colors=['#00d4cc','#a78bfa','#ffaa00','#ff6b35','#00d4aa','#ff4444'];
  let angle=-Math.PI/2;
  entries.forEach(([canal,val],i)=>{
    const sweep=(val/total)*2*Math.PI;
    ctx.beginPath();ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,r,angle,angle+sweep);ctx.closePath();
    ctx.fillStyle=colors[i%colors.length];ctx.fill();
    ctx.beginPath();ctx.arc(cx,cy,ri,0,2*Math.PI);ctx.fillStyle='#111';ctx.fill();
    angle+=sweep;
  });
  ctx.fillStyle='rgba(255,255,255,0.7)';ctx.font='bold 11px DM Sans';ctx.textAlign='center';
  ctx.fillText('Canal',cx,cy-5);ctx.fillText('2026',cx,cy+10);
  // leyenda
  const legend=document.getElementById('fin-donut-legend');
  if(legend){
    legend.innerHTML=entries.map(([canal,val],i)=>`<div style="display:flex;align-items:center;gap:6px"><div style="width:10px;height:10px;border-radius:2px;background:${colors[i%colors.length]};flex-shrink:0"></div><span style="flex:1;color:var(--text2)">${canal}</span><span style="color:var(--text1);font-weight:600">${Math.round(val/1e6*10)/10}M</span></div>`).join('');
  }
}

/* ── Resumen anual dinámico ── */
function finRenderResumenAnual(){
  const tb=document.getElementById('fin-resumen-anual-body');
  if(!tb)return;
  const anos=[2022,2023,2024,2025,2026];
  const VM=finVentasMerged();
  const totales=anos.map(y=>VM[y].reduce((a,b)=>a+b,0));
  const maxTot=Math.max(...totales)||1;
  const meses={2022:7,2023:12,2024:12,2025:12,2026:5};
  const badges={2022:'badge-gray',2023:'badge-yellow',2024:'badge-orange',2025:'badge-orange',2026:'badge-green'};
  let html='';
  anos.forEach((y,i)=>{
    const tot=totales[i];
    const avg=Math.round(tot/meses[y]);
    const prev=i>0?totales[i-1]:null;
    const varPct2=prev?Math.round((tot/prev-1)*100):null;
    const barW=Math.round((tot/maxTot)*100);
    const isRecord=y===2024;
    html+=`<tr style="${isRecord?'background:rgba(255,170,0,0.06)':''}">
      <td><span class="badge ${badges[y]}">${y}${y===2022||y===2026?' *':''}</span></td>
      <td style="font-weight:${isRecord?700:400}">${clp(tot)}</td>
      <td style="font-size:11px">${clp(avg)}</td>
      <td>${varPct2!==null?`<span class="badge ${varPct2>=0?'badge-green':'badge-red'}">${varPct2>=0?'+':''}${varPct2}%</span>`:'<span class="badge badge-gray">—</span>'}</td>
      <td style="min-width:80px"><div style="height:5px;border-radius:3px;background:rgba(255,255,255,0.06)"><div style="height:100%;width:${barW}%;background:${isRecord?'#ffaa00':'rgba(0,212,204,0.7)'};border-radius:3px"></div></div></td>
    </tr>`;
  });
  tb.innerHTML=html;
}

/* ── Top clientes ── */
function finRenderTopClientes(year){
  if(year===undefined)year=2026;
  const tb=document.getElementById('fin-top-clientes-body');
  if(!tb)return;
  // Botón activo
  ['all',2022,2023,2024,2025,2026].forEach(y=>{
    const btn=document.getElementById('ftc-'+y);
    if(!btn)return;
    const active=String(y)===String(year);
    btn.style.background=active?'rgba(0,212,204,0.18)':'';
    btn.style.color=active?'var(--accent)':'';
  });
  // Título
  const title=document.getElementById('fin-topclientes-title');
  if(title)title.textContent='Top Clientes '+(year==='all'?'— Todos los años':year);
  // Datos
  const all=finGetAllFacturas();
  const filtered=year==='all'?all:all.filter(r=>String(r.year)===String(year));
  const byCliente={};
  filtered.forEach(r=>{
    const key=(r.empresa&&r.empresa!=='—')?r.empresa:r.nombre;
    const amt=r.pago!=null?r.pago:r.valor*r.cant;
    byCliente[key]=(byCliente[key]||0)+amt;
  });
  const total=Object.values(byCliente).reduce((a,b)=>a+b,0)||1;
  const sorted=Object.entries(byCliente).sort((a,b)=>b[1]-a[1]).slice(0,8);
  tb.innerHTML=sorted.length?sorted.map(([nombre,val])=>`<tr>
    <td style="font-size:11px">${nombre}</td>
    <td style="font-weight:600">${clp(val)}</td>
    <td style="font-size:11px;color:var(--accent)">${Math.round(val/total*100)}%</td>
  </tr>`).join(''):'<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text3)">Sin datos para este período</td></tr>';
}

/* ── Evolución de deuda (line chart) ── */
function finDrawDeudaTimeline(){
  const canvas=document.getElementById('finDeudaChart');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const w=canvas.offsetWidth||canvas.parentElement?.clientWidth||600;
  canvas.width=w;canvas.height=120;
  ctx.clearRect(0,0,w,120);
  const data=FIN_PRESTAMOS.map(r=>r.deuda);
  const labels=FIN_PRESTAMOS.map(r=>r.fecha);
  const maxV=Math.max(...data)||1;
  const pad={t:10,r:10,b:24,l:70};
  const ch=120-pad.t-pad.b;
  const cw=w-pad.l-pad.r;
  const n=data.length;
  // grid
  ctx.strokeStyle='rgba(255,255,255,0.05)';ctx.lineWidth=1;
  for(let i=0;i<=3;i++){
    const y2=pad.t+ch*(1-i/3);
    ctx.beginPath();ctx.moveTo(pad.l,y2);ctx.lineTo(w-pad.r,y2);ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.3)';ctx.font='8px DM Sans';ctx.textAlign='right';
    ctx.fillText(clp(Math.round(maxV*i/3)),pad.l-3,y2+3);
  }
  // gradient fill
  const grad=ctx.createLinearGradient(0,pad.t,0,pad.t+ch);
  grad.addColorStop(0,'rgba(255,68,68,0.35)');
  grad.addColorStop(1,'rgba(255,68,68,0)');
  const pts=data.map((v,i)=>[pad.l+i*(cw/(n-1||1)),pad.t+ch*(1-v/maxV)]);
  ctx.beginPath();
  pts.forEach(([x,y2],i)=>i===0?ctx.moveTo(x,y2):ctx.lineTo(x,y2));
  ctx.lineTo(pts[pts.length-1][0],pad.t+ch);
  ctx.lineTo(pts[0][0],pad.t+ch);
  ctx.closePath();ctx.fillStyle=grad;ctx.fill();
  // line
  ctx.beginPath();
  pts.forEach(([x,y2],i)=>i===0?ctx.moveTo(x,y2):ctx.lineTo(x,y2));
  ctx.strokeStyle='rgba(255,68,68,0.9)';ctx.lineWidth=2;ctx.stroke();
  // dots at key points
  [0,Math.floor(n/2),n-1].forEach(i=>{
    ctx.beginPath();ctx.arc(pts[i][0],pts[i][1],3,0,2*Math.PI);
    ctx.fillStyle='#ff4444';ctx.fill();
    if(i===0||i===n-1){
      ctx.fillStyle='rgba(255,255,255,0.5)';ctx.font='8px DM Sans';
      ctx.textAlign=i===0?'left':'right';
      ctx.fillText(labels[i],pts[i][0]+(i===0?2:-2),pad.t+ch+14);
    }
  });
}

/* ── Tooltip para el chart principal ── */
function finSetupTooltip(){
  const canvas=document.getElementById('finVentasChart');
  const tooltip=document.getElementById('fin-chart-tooltip');
  if(!canvas||!tooltip)return;
  canvas.addEventListener('mousemove',(e)=>{
    const years=finChartActiveYear==='all'?[2023,2024,2025,2026]:[finChartActiveYear];
    const w=canvas.width;
    const pad={t:20,r:10,b:40,l:60};
    const cw=w-pad.l-pad.r;
    const grpW=cw/12;
    const rect=canvas.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(canvas.width/rect.width);
    const mi=Math.floor((mx-pad.l)/grpW);
    if(mi<0||mi>11){tooltip.style.display='none';return;}
    const colors={2023:'#a78bfa',2024:'#ffaa00',2025:'#ff6b35',2026:'#00d4cc'};
    const VM=finVentasMerged();
    let lines=`<div style="font-weight:700;margin-bottom:5px;color:var(--text1)">${FIN_MESES[mi]}</div>`;
    years.forEach(y=>{
      const v=VM[y][mi];
      if(v)lines+=`<div style="color:${colors[y]||'#fff'}">${y}: ${clp(v)}</div>`;
    });
    tooltip.innerHTML=lines;
    tooltip.style.display='block';
    const canvasEl=canvas.parentElement;
    const lx=e.clientX-canvasEl.getBoundingClientRect().left;
    tooltip.style.left=Math.min(lx+10,canvasEl.offsetWidth-160)+'px';
    tooltip.style.top=(e.clientY-canvasEl.getBoundingClientRect().top-10)+'px';
  });
  canvas.addEventListener('mouseleave',()=>{tooltip.style.display='none';});
}

/* ── Init cuando se activa el tab ── */
function finInit(){
  finRenderMensual();
  finInitKPIs();
  renderOverviewFinanzas();
  if(finCurrentTab==='facturas') finRenderFacturas();
  setTimeout(()=>{
    finDrawChart();
    finDrawSparklines();
    finDrawCanalDonut();
    finRenderResumenAnual();
    finRenderTopClientes();
    finSetupTooltip();
  },120);
}

// ═══════════════════════════════════════════════════════════════
// LIBRO DIARIO — Gastos e Ingresos diarios
// ═══════════════════════════════════════════════════════════════
const LD_KEY='fin_diario';
const LD_PAG=25;
let ldFiltradas=[];
let ldPag=0;
let ldSortKey='fecha';
let ldSortDir=-1;

const LD_CAT={
  gasto:['Materiales e insumos','Filamentos / resinas','Maquinaria y equipos',
    'Arriendo local','Servicios básicos','Internet y telecomunicaciones',
    'Marketing y publicidad','Sueldos y honorarios','Cuota préstamo',
    'Transporte y logística','Software y tecnología','Mantención',
    'Contabilidad y legal','Otros gastos'],
  ingreso:['Impresión 3D','Diseño 3D','Papelería corporativa',
    'Desarrollo web','Marketing digital','Consultoría',
    'Arriendo de equipos','Otros ingresos']
};

function ldGetAll(){try{return JSON.parse(localStorage.getItem(LD_KEY)||'[]');}catch(e){return[];}}
function ldSaveAll(arr){try{localStorage.setItem(LD_KEY,JSON.stringify(arr));}catch(e){toast('Sin espacio de almacenamiento','error');}}

function ldSwitchTipo(){
  const tipo=document.getElementById('ld-tipo')?.value||'gasto';
  const sel=document.getElementById('ld-categoria');
  if(!sel)return;
  sel.innerHTML=(LD_CAT[tipo]||[]).map(c=>`<option>${c}</option>`).join('');
}

function ldLimpiar(){
  const hoy=new Date().toISOString().split('T')[0];
  const f=document.getElementById('ld-fecha');if(f)f.value=hoy;
  const t=document.getElementById('ld-tipo');if(t)t.value='gasto';
  ldSwitchTipo();
  ['ld-descripcion','ld-referencia','ld-contraparte'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const m=document.getElementById('ld-monto');if(m)m.value='';
  const mt=document.getElementById('ld-metodo');if(mt)mt.value='Transferencia';
}

function ldGuardar(){
  const fecha=document.getElementById('ld-fecha')?.value;
  const tipo=document.getElementById('ld-tipo')?.value;
  const categoria=document.getElementById('ld-categoria')?.value||'';
  const descripcion=(document.getElementById('ld-descripcion')?.value||'').trim();
  const monto=parseFloat(document.getElementById('ld-monto')?.value||0);
  const metodo=document.getElementById('ld-metodo')?.value||'Transferencia';
  const referencia=(document.getElementById('ld-referencia')?.value||'').trim();
  const contraparte=(document.getElementById('ld-contraparte')?.value||'').trim();
  if(!fecha){toast('Selecciona una fecha','error');return;}
  if(!descripcion){toast('Ingresa una descripción','error');return;}
  if(!monto||monto<=0){toast('Ingresa un monto válido','error');return;}
  const entry={
    id:Date.now()+'_'+Math.random().toString(36).slice(2,7),
    fecha,tipo,categoria,descripcion,monto,metodo,referencia,contraparte
  };
  const all=ldGetAll();all.push(entry);ldSaveAll(all);
  ldLimpiar();ldInit();
  toast('✓ Registro guardado correctamente','success');
}

function ldEliminar(id){
  if(!confirm('¿Eliminar este registro?'))return;
  ldSaveAll(ldGetAll().filter(e=>e.id!==id));
  ldInit();toast('Registro eliminado','success');
}

function ldSort(key){
  if(ldSortKey===key)ldSortDir*=-1;
  else{ldSortKey=key;ldSortDir=-1;}
  ldRenderTabla();
}

function ldFiltrar(){
  const desde=document.getElementById('ld-f-desde')?.value||'';
  const hasta=document.getElementById('ld-f-hasta')?.value||'';
  const tipo=document.getElementById('ld-f-tipo')?.value||'';
  const busca=(document.getElementById('ld-f-busca')?.value||'').toLowerCase();
  ldFiltradas=ldGetAll().filter(e=>{
    if(desde&&e.fecha<desde)return false;
    if(hasta&&e.fecha>hasta)return false;
    if(tipo&&e.tipo!==tipo)return false;
    if(busca&&![e.descripcion,e.categoria,e.referencia,e.contraparte].join(' ').toLowerCase().includes(busca))return false;
    return true;
  });
  ldFiltradas.sort((a,b)=>{
    let va=a[ldSortKey],vb=b[ldSortKey];
    if(ldSortKey==='monto'){va=+va;vb=+vb;}
    return va>vb?ldSortDir:va<vb?-ldSortDir:0;
  });
  ldPag=0;ldRenderTabla();ldRenderKPIs();
}

function ldRenderTabla(){
  const tb=document.getElementById('ld-tbody');
  if(!tb)return;
  const total=ldFiltradas.length;
  const countEl=document.getElementById('ld-count');
  if(countEl){
    const ing=ldFiltradas.filter(e=>e.tipo==='ingreso');
    const gas=ldFiltradas.filter(e=>e.tipo==='gasto');
    const sumIng=ing.reduce((s,e)=>s+(+e.monto||0),0);
    const sumGas=gas.reduce((s,e)=>s+(+e.monto||0),0);
    const neto=sumIng-sumGas;
    countEl.innerHTML=total===0?'Sin registros para este filtro':
      `<span style="color:var(--accent3)">↑ ${ing.length} ingresos ${fmtMoney(sumIng)}</span>&nbsp;·&nbsp;<span style="color:var(--danger)">↓ ${gas.length} gastos ${fmtMoney(sumGas)}</span>&nbsp;·&nbsp;<strong style="color:${neto>=0?'var(--accent3)':'var(--danger)'}">Neto: ${neto>=0?'+':'−'}${fmtMoney(Math.abs(neto))}</strong>`;
  }
  const page=ldFiltradas.slice(ldPag*LD_PAG,(ldPag+1)*LD_PAG);
  if(!page.length){
    tb.innerHTML='<tr><td colspan="9" style="text-align:center;padding:28px;color:var(--text3)">Sin registros — agrega el primer movimiento arriba</td></tr>';
    document.getElementById('ld-pag').innerHTML='';return;
  }
  tb.innerHTML=page.map(e=>{
    const isIng=e.tipo==='ingreso';
    const color=isIng?'var(--accent3)':'var(--danger)';
    const badge=isIng
      ?'<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:rgba(100,220,80,0.12);color:var(--accent3);font-weight:600">↑ Ingreso</span>'
      :'<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:rgba(255,68,68,0.12);color:var(--danger);font-weight:600">↓ Gasto</span>';
    return`<tr>
<td style="white-space:nowrap;font-size:12px">${e.fecha}</td>
<td>${badge}</td>
<td style="color:var(--text2);font-size:11px">${escapeHtml(e.categoria||'—')}</td>
<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(e.descripcion)}">${escapeHtml(e.descripcion)}</td>
<td style="font-weight:700;color:${color};white-space:nowrap;text-align:right">${isIng?'+':'−'}${fmtMoney(e.monto)}</td>
<td style="font-size:11px;color:var(--text3)">${escapeHtml(e.metodo||'—')}</td>
<td style="font-size:11px;color:var(--text3)">${escapeHtml(e.referencia||'—')}</td>
<td style="font-size:11px;color:var(--text3)">${escapeHtml(e.contraparte||'—')}</td>
<td><button class="btn btn-danger btn-sm" style="padding:2px 6px;font-size:12px" onclick="ldEliminar('${e.id}')" title="Eliminar">✕</button></td>
</tr>`;
  }).join('');
  const totalPages=Math.ceil(total/LD_PAG);
  const pagEl=document.getElementById('ld-pag');
  if(totalPages<=1){pagEl.innerHTML='';return;}
  pagEl.innerHTML=`<button class="btn btn-ghost btn-sm" onclick="ldPagGo(${ldPag-1})" ${ldPag===0?'disabled':''}>‹ Anterior</button><span style="font-size:11px;color:var(--text3);margin:0 8px">Pág ${ldPag+1} / ${totalPages}</span><button class="btn btn-ghost btn-sm" onclick="ldPagGo(${ldPag+1})" ${ldPag>=totalPages-1?'disabled':''}>Siguiente ›</button>`;
}

function ldPagGo(p){ldPag=p;ldRenderTabla();}

function ldRenderKPIs(){
  const hoy=new Date().toISOString().split('T')[0];
  const mes=hoy.slice(0,7);
  const all=ldGetAll();
  const mesData=all.filter(e=>e.fecha.startsWith(mes));
  const hoyData=all.filter(e=>e.fecha===hoy);
  const sum=(arr,tipo)=>arr.filter(e=>e.tipo===tipo).reduce((s,e)=>s+(+e.monto||0),0);
  const fIng=sum(ldFiltradas,'ingreso'),fGas=sum(ldFiltradas,'gasto');
  const mIng=sum(mesData,'ingreso'),mGas=sum(mesData,'gasto');
  const hNet=sum(hoyData,'ingreso')-sum(hoyData,'gasto');
  const saldo=fIng-fGas,sMes=mIng-mGas;
  function s(id,v){const el=document.getElementById(id);if(el)el.textContent=v;}
  function sc(id,c){const el=document.getElementById(id);if(el)el.style.color=c;}
  const ingCount=ldFiltradas.filter(e=>e.tipo==='ingreso').length;
  const gasCount=ldFiltradas.filter(e=>e.tipo==='gasto').length;
  s('ld-k-ing',fmtMoney(fIng));s('ld-k-ings',ingCount+' entr'+(ingCount===1?'ada':'adas'));
  s('ld-k-gas',fmtMoney(fGas));s('ld-k-gass',gasCount+' salid'+(gasCount===1?'a':'as'));
  s('ld-k-sal',fmtMoney(Math.abs(saldo)));s('ld-k-sals',saldo>=0?'superávit':'déficit');sc('ld-k-sal',saldo>=0?'var(--accent3)':'var(--danger)');
  s('ld-k-mes',fmtMoney(Math.abs(sMes)));s('ld-k-mess',(sMes>=0?'↑ superávit':'↓ déficit')+' en '+new Date().toLocaleString('es-CL',{month:'long'}));sc('ld-k-mes',sMes>=0?'var(--accent3)':'var(--danger)');
  s('ld-k-hoy',hoyData.length===0?'$0':fmtMoney(Math.abs(hNet)));s('ld-k-hoys',hoyData.length+' mov. hoy'+(hNet!==0?' · '+(hNet>=0?'↑':'↓'):''));sc('ld-k-hoy',hNet>=0?'var(--accent3)':'var(--danger)');
}

function ldExportCSV(){
  if(!ldFiltradas.length){toast('Sin datos para exportar','error');return;}
  const rows=[['Fecha','Tipo','Categoría','Descripción','Monto','Método','Referencia','Proveedor/Cliente']];
  ldFiltradas.forEach(e=>rows.push([e.fecha,e.tipo,e.categoria,e.descripcion,e.monto,e.metodo||'',e.referencia||'',e.contraparte||'']));
  const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='libro_diario_thelab.csv';a.click();
  URL.revokeObjectURL(url);toast('✓ CSV exportado','success');
}

function ldInit(){
  const hoy=new Date().toISOString().split('T')[0];
  const fd=document.getElementById('ld-fecha');if(fd&&!fd.value)fd.value=hoy;
  const desde=document.getElementById('ld-f-desde');
  const hasta=document.getElementById('ld-f-hasta');
  if(desde&&!desde.value)desde.value=hoy.slice(0,8)+'01';
  if(hasta&&!hasta.value)hasta.value=hoy;
  ldSwitchTipo();
  ldFiltrar();
}

/* ── Overview Google Ads snapshot ── */
function ovSyncAdsKPIs(data){
  function set(id,v){const el=document.getElementById(id);if(el)el.textContent=v;}
  const gasto=data.gasto||0,conv=data.conversiones||0,clics=data.clics||0;
  const valConv=data.valor_conversion||0;
  const roas=gasto>0?(valConv/gasto):0;
  set('ov-ads-gasto',fmtMoney(gasto));
  set('ov-ads-gastos',data.periodo||'30 días');
  set('ov-ads-conv',conv>0?conv.toFixed(0):'0');
  set('ov-ads-convs',conv>0?fmtMoney(valConv/conv)+'/conv':'—');
  set('ov-ads-clics',fmtNum(clics));
  set('ov-ads-roas',roas>0?roas.toFixed(2)+'x':'—');
  set('ov-ads-roass',roas>0?'retorno sobre gasto':'sin conversiones');
  set('ov-ads-status','Actualizado '+new Date().toLocaleTimeString('es-CL'));
}

/* ── Overview Finanzas snapshot ── */
function renderOverviewFinanzas(){
  function fmt(n){
    if(n>=1e9)return '$'+(n/1e9).toFixed(1)+'B';
    if(n>=1e6)return '$'+(n/1e6).toFixed(1)+'M';
    return clp(n);
  }
  function set(id,v){const el=document.getElementById(id);if(el)el.textContent=v;}

  const VM=finVentasMerged();
  const v26=VM[2026];
  const v25=VM[2025];
  const tot26=v26.reduce((a,b)=>a+b,0);
  const meses26=v26.filter(v=>v>0).length||1;
  const avg26=Math.round(tot26/meses26);
  const avg25=Math.round(v25.reduce((a,b)=>a+b,0)/12);
  const varAvg=avg25?Math.round((avg26/avg25-1)*100):0;
  const allFacts=finGetAllFacturas();
  const cobrar=allFacts.filter(r=>r.porCobrar>0).reduce((a,r)=>a+r.porCobrar,0);
  const nFact=allFacts.filter(r=>r.porCobrar>0).length;
  const deuda=FIN_PRESTAMOS[FIN_PRESTAMOS.length-1].deuda;

  set('ov-fin-v26', fmt(tot26));
  set('ov-fin-v26s', 'Ene–May 2026 · '+meses26+' meses');
  set('ov-fin-avg', fmt(avg26));
  set('ov-fin-avgs', (varAvg>=0?'↑':'↓')+Math.abs(varAvg)+'% vs media 2025');
  set('ov-fin-cobrar', fmt(cobrar));
  set('ov-fin-cobras', nFact+' factura'+(nFact!==1?'s':'')+' pendiente'+(nFact!==1?'s':''));
  set('ov-fin-deuda', fmt(deuda));
  set('ov-fin-deudas', 'al '+FIN_PRESTAMOS[FIN_PRESTAMOS.length-1].fecha);

  // Mini bar chart: últimos 8 meses (Oct 2025 – May 2026)
  setTimeout(drawOvFinChart, 80);
}

function drawOvFinChart(){
  const canvas=document.getElementById('ov-fin-chart');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const w=canvas.offsetWidth||canvas.parentElement?.clientWidth||400;
  canvas.width=w; canvas.height=54;
  ctx.clearRect(0,0,w,54);

  // oct=9, nov=10, dic=11 de 2025; ene=0..may=4 de 2026
  const VM=finVentasMerged();
  const meses=[
    {lbl:'Oct25',v:VM[2025][9],color:'rgba(255,107,53,0.7)'},
    {lbl:'Nov25',v:VM[2025][10],color:'rgba(255,107,53,0.7)'},
    {lbl:'Dic25',v:VM[2025][11],color:'rgba(255,107,53,0.7)'},
    {lbl:'Ene26',v:VM[2026][0],color:'rgba(0,212,204,0.85)'},
    {lbl:'Feb26',v:VM[2026][1],color:'rgba(0,212,204,0.85)'},
    {lbl:'Mar26',v:VM[2026][2],color:'rgba(0,212,204,0.85)'},
    {lbl:'Abr26',v:VM[2026][3],color:'rgba(0,212,204,0.85)'},
    {lbl:'May26',v:VM[2026][4],color:'rgba(0,212,204,0.85)'},
  ];
  const maxV=Math.max(...meses.map(m=>m.v))||1;
  const pad={t:4,b:16,l:2,r:2};
  const ch=54-pad.t-pad.b;
  const cw=w-pad.l-pad.r;
  const bw=Math.floor(cw/meses.length)-3;
  meses.forEach((m,i)=>{
    if(!m.v)return;
    const bh=Math.round((m.v/maxV)*ch);
    const x=pad.l+i*(bw+3)+1;
    const y=pad.t+ch-bh;
    ctx.fillStyle=m.color;
    ctx.beginPath();ctx.roundRect(x,y,bw,bh,2);ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.35)';
    ctx.font='7px DM Sans';ctx.textAlign='center';
    ctx.fillText(m.lbl,x+bw/2,54-2);
  });
}

/* Hookear al switchTab existente */
const _origSwitch=typeof switchTab!=='undefined'?switchTab:null;
document.addEventListener('DOMContentLoaded',()=>{
  // Precargar mes actual en el form de nueva venta
  const now=new Date();
  const mesEl=document.getElementById('nv-mes');
  if(mesEl)mesEl.value=String(now.getMonth()+1).padStart(2,'0');
  const yearEl=document.getElementById('nv-year');
  if(yearEl)yearEl.value=String(now.getFullYear());
  // Renderizar snapshot de finanzas en el overview al cargar
  renderOverviewFinanzas();
});

/* Observar cuando el tab finanzas se activa */
const _finObserver=new MutationObserver((muts)=>{
  muts.forEach(m=>{
    if(m.target.id==='tab-finanzas'&&m.target.classList.contains('active')){
      finInit();
    }
  });
});
const _finPanel=document.getElementById('tab-finanzas');
if(_finPanel)_finObserver.observe(_finPanel,{attributes:true,attributeFilter:['class']});

/* ResizeObserver para redibujado responsivo */
if(typeof ResizeObserver!=='undefined'&&_finPanel){
  let _finResizeTimer;
  const _finResizeObs=new ResizeObserver(()=>{
    clearTimeout(_finResizeTimer);
    _finResizeTimer=setTimeout(()=>{
      if(_finPanel.classList.contains('active')){
        finDrawChart();
        finDrawCanalDonut();
        finDrawDeudaTimeline();
        finDrawSparklines();
      }
    },100);
  });
  _finResizeObs.observe(_finPanel);
}

// ── Menú NUEVO (dropdown topbar + acordeón mobile) ──────────────
function irALibroDiario(){
  switchTab('finanzas');
  setTimeout(()=>{
    finSwitchTab('diario');
    setTimeout(()=>{
      const el=document.getElementById('ld-fecha');
      if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.focus();}
    },100);
  },80);
}
function irANuevaVenta(){
  switchTab('finanzas');
  setTimeout(()=>{
    finSwitchTab('nueva');
    setTimeout(()=>{
      const el=document.getElementById('nv-nombre');
      if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.focus();}
    },100);
  },80);
}
// ── CALCULADORA COTIZACIÓN 3D ─────────────────────────────────
const C3D_MATERIALES={
  'PLA':      {preciog:18,merma:0.2,unidad:'gramos'},
  'PLA+':     {preciog:20,merma:0.2,unidad:'gramos'},
  'PETG':     {preciog:20,merma:0.2,unidad:'gramos'},
  'Resina UV':{preciog:30,merma:0.2,unidad:'mL'}
};
const C3D_MAQUINAS=[
  {id:'ender7',  nombre:'Ender 7',        sub:'FDM',      costo:150},
  {id:'halot',   nombre:'Halot One',      sub:'Resina',   costo:150},
  {id:'wycure',  nombre:'Wash & Cure',    sub:'Post-proc',costo:150},
  {id:'cnc',     nombre:'CNC',            sub:'$330/h',   costo:330},
  {id:'router',  nombre:'Router',         sub:'$100/h',   costo:100},
  {id:'fresa',   nombre:'Fresa',          sub:'$500/h',   costo:500},
  {id:'luz',     nombre:'Luz / Electr.',  sub:'$100/h',   costo:100},
];
const C3D_EXTRAS=[
  {id:'disenio',  nombre:'Diseño (flat)',       costo:20000, tipo:'flat'},
  {id:'hxh',      nombre:'Post-proceso HXH',    costo:5000,  tipo:'flat'},
  {id:'packaging',nombre:'Packaging',           costo:100,   tipo:'unit'},
  {id:'pintura',  nombre:'Pintado',             costo:2000,  tipo:'unit'},
  {id:'lija',     nombre:'Lija / Pulido',       costo:420,   tipo:'unit'},
  {id:'acetona',  nombre:'Acetona (frasco)',     costo:10000, tipo:'flat'},
  {id:'alcohol',  nombre:'Alcohol ISO 10lt',    costo:36600, tipo:'flat'},
  {id:'cianoacr', nombre:'Cianoacrilato',        costo:10000, tipo:'flat'},
  {id:'poliur',   nombre:'Poliuretano',         costo:10000, tipo:'flat'},
  {id:'laca',     nombre:'Laca (por pieza)',     costo:500,   tipo:'unit'},
  {id:'filler',   nombre:'Filler / Masilla',    costo:10000, tipo:'flat'},
  {id:'dtf',      nombre:'Impresión DTF',       costo:18000, tipo:'flat'},
];

// ── CALCULADORA 3D INLINE (dentro de Nueva Cotización) ────────────────────
let c3dPiezaCounter=0;
let c3dPiezasActivas=[];
let c3dTarget='n'; // 'n' = nueva cotización, 'e' = editar cotización

function _c3dBtns(){return{n:document.getElementById('c3d-toggle-btn'),e:document.getElementById('c3d-btn-e')};}
function toggleC3dInline(ctx){
  ctx=ctx||'n';
  const panel=document.getElementById('c3d-inline-panel');
  if(!panel) return;
  const btns=_c3dBtns();
  const isOpen=panel.style.display!=='none';
  if(isOpen&&c3dTarget===ctx){
    panel.style.display='none';
    Object.values(btns).forEach(b=>{if(b)b.style.background='';});
    return;
  }
  // El panel es único: se mueve al host del contexto activo
  c3dTarget=ctx;
  const host=document.getElementById('calc-host-'+ctx);
  if(host) host.appendChild(panel);
  panel.style.display='block';
  Object.entries(btns).forEach(([k,b])=>{if(b)b.style.background=k===ctx?'rgba(0,212,204,0.15)':'';});
  if(!c3dPiezasActivas.length) c3dAddPieza();
  c3dUpdateAll();
}

function c3dAddPieza(){
  const id=c3dPiezaCounter++;
  c3dPiezasActivas.push(id);
  const list=document.getElementById('c3d-i-piezas');
  if(!list) return;
  const maqInputs=C3D_MAQUINAS.map(m=>`<div style="display:flex;align-items:center;gap:5px;min-width:120px"><span style="font-size:9px;color:var(--text3);flex:1;white-space:nowrap">${m.nombre}<br><span style="color:var(--text3);font-size:8px">$${m.costo.toLocaleString('es-CL')}/h</span></span><input type="number" min="0" step="0.5" value="0" id="c3d-pm-${id}-${m.id}" oninput="c3dUpdateAll()" style="background:var(--surface2);border:1px solid var(--border2);border-radius:5px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:11px;padding:3px 5px;outline:none;width:52px;text-align:center"></div>`).join('');
  const extrasInputs=C3D_EXTRAS.map(e=>`<div style="display:flex;align-items:center;gap:5px;background:var(--surface3);border-radius:5px;padding:4px 7px"><input type="checkbox" id="c3d-ex-${id}-${e.id}" onchange="c3dUpdateAll()" style="accent-color:var(--accent);cursor:pointer;width:13px;height:13px;flex-shrink:0"><label for="c3d-ex-${id}-${e.id}" style="font-size:10px;color:var(--text2);cursor:pointer;flex:1;line-height:1.2">${e.nombre}</label>${e.tipo==='unit'?`<input type="number" min="1" value="1" id="c3d-exqty-${id}-${e.id}" oninput="c3dUpdateAll()" title="Cantidad" style="width:40px;background:var(--surface2);border:1px solid var(--border2);border-radius:4px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:10px;padding:2px 4px;outline:none;text-align:center">`:'&nbsp;'}<span style="font-size:9px;color:var(--text3);white-space:nowrap;flex-shrink:0">$${e.costo.toLocaleString('es-CL')}${e.tipo==='unit'?'/u':''}</span></div>`).join('');
  const wrapper=document.createElement('div');
  wrapper.id='c3d-pieza-'+id;
  wrapper.innerHTML=`<div style="border:1px solid var(--border2);border-radius:8px;overflow:hidden">
    <div style="background:var(--surface3);padding:6px 10px;border-bottom:1px solid var(--border2);display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;flex-shrink:0">Pieza ${c3dPiezasActivas.length}</span>
      <input type="text" placeholder="Descripción de la pieza..." id="c3d-p-desc-${id}" oninput="c3dUpdateAll()" style="flex:1;min-width:140px;background:var(--surface2);border:1px solid var(--border2);border-radius:5px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:11px;padding:4px 8px;outline:none">
      <input type="number" min="1" value="1" id="c3d-p-qty-${id}" oninput="c3dUpdateAll()" title="Cantidad de piezas" style="width:56px;background:var(--surface2);border:1px solid var(--border2);border-radius:5px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:11px;padding:4px 6px;outline:none;text-align:center">
      <span style="font-size:10px;color:var(--text3);flex-shrink:0">und.</span>
      <button type="button" onclick="c3dRemovePieza(${id})" style="background:none;border:none;color:var(--text3);font-size:16px;cursor:pointer;padding:0 2px;line-height:1;flex-shrink:0" onmouseenter="this.style.color='var(--danger)'" onmouseleave="this.style.color='var(--text3)'" title="Quitar pieza">✕</button>
    </div>
    <div style="display:grid;grid-template-columns:200px 1fr;gap:0">
      <div style="padding:8px 10px;border-right:1px solid var(--border2)">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:5px">Material</div>
        <select id="c3d-p-mat-${id}" onchange="c3dUpdMatLbl(${id});c3dUpdateAll()" style="background:var(--surface2);border:1px solid var(--border2);border-radius:5px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:11px;padding:4px 8px;outline:none;width:100%;margin-bottom:6px;cursor:pointer">
          <option value="PLA">PLA — $18/g</option>
          <option value="PLA+" selected>PLA+ — $20/g</option>
          <option value="PETG">PETG — $20/g</option>
          <option value="Resina UV">Resina UV — $30/mL</option>
        </select>
        <div style="display:flex;align-items:center;gap:6px">
          <input type="number" min="0" value="0" id="c3d-p-matqty-${id}" oninput="c3dUpdateAll()" placeholder="0" style="background:var(--surface2);border:1px solid var(--border2);border-radius:5px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:11px;padding:4px 7px;outline:none;width:75px">
          <span id="c3d-p-matunit-${id}" style="font-size:10px;color:var(--text3)">g</span>
        </div>
      </div>
      <div style="padding:8px 10px">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:5px">Máquinas (horas)</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:6px">${maqInputs}</div>
      </div>
    </div>
    <div style="padding:8px 10px;border-top:1px solid var(--border2)">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Extras / Insumos <span style="font-weight:400;color:var(--text3)">(u = por pieza · flat = costo fijo)</span></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(195px,1fr));gap:5px">${extrasInputs}</div>
    </div>
    <div style="padding:6px 10px;border-top:1px solid var(--border2);background:var(--surface3);display:flex;justify-content:flex-end;gap:16px;align-items:center;font-size:11px;flex-wrap:wrap">
      <span style="color:var(--text3)">Costo: <strong id="c3d-p-costo-${id}" style="font-family:'JetBrains Mono',monospace">$0</strong></span>
      <span>Precio neto: <strong id="c3d-p-neto-${id}" style="font-family:'JetBrains Mono',monospace;color:var(--accent)">$0</strong></span>
      <span>Total c/IVA: <strong id="c3d-p-total-${id}" style="font-family:'JetBrains Mono',monospace;color:var(--accent3)">$0</strong></span>
    </div>
  </div>`;
  list.appendChild(wrapper);
  c3dUpdateAll();
}

function c3dRemovePieza(id){
  c3dPiezasActivas=c3dPiezasActivas.filter(x=>x!==id);
  document.getElementById('c3d-pieza-'+id)?.remove();
  c3dUpdateAll();
}

function c3dUpdMatLbl(id){
  const mat=document.getElementById('c3d-p-mat-'+id)?.value||'PLA+';
  const lbl=document.getElementById('c3d-p-matunit-'+id);
  if(lbl) lbl.textContent=mat==='Resina UV'?'mL':'g';
}

function c3dCalcPieza(id){
  const matKey=document.getElementById('c3d-p-mat-'+id)?.value||'PLA+';
  const mat=C3D_MATERIALES[matKey]||{preciog:20,merma:0.2};
  const matQty=parseFloat(document.getElementById('c3d-p-matqty-'+id)?.value)||0;
  const qty=Math.max(1,parseFloat(document.getElementById('c3d-p-qty-'+id)?.value)||1);
  const margen=(parseFloat(document.getElementById('c3d-i-margen')?.value)||65)/100;
  const costoMat=Math.round(matQty*mat.preciog*(1+mat.merma));
  let costoMaq=0;
  C3D_MAQUINAS.forEach(m=>{const h=parseFloat(document.getElementById('c3d-pm-'+id+'-'+m.id)?.value)||0;costoMaq+=Math.round(h*m.costo);});
  let costoExtras=0;
  C3D_EXTRAS.forEach(e=>{
    const chk=document.getElementById('c3d-ex-'+id+'-'+e.id);
    if(!chk?.checked) return;
    if(e.tipo==='unit'){const extQty=parseFloat(document.getElementById('c3d-exqty-'+id+'-'+e.id)?.value)||qty;costoExtras+=Math.round(e.costo*extQty);}
    else costoExtras+=e.costo;
  });
  const costoUnit=costoMat+costoMaq+costoExtras;
  const netoUnit=margen<1?Math.round(costoUnit/(1-margen)):costoUnit;
  return{costoUnit,netoUnit,costoTotal:costoUnit*qty,netoTotal:netoUnit*qty,totalConIva:Math.round(netoUnit*qty*1.19),qty};
}

function c3dUpdateAll(){
  const margenVal=parseFloat(document.getElementById('c3d-i-margen')?.value)||65;
  const lbl=document.getElementById('c3d-i-margen-lbl');
  if(lbl) lbl.textContent=margenVal+'%';
  let grandTotal=0;
  c3dPiezasActivas.forEach(id=>{
    const{costoTotal,netoTotal,totalConIva}=c3dCalcPieza(id);
    const co=document.getElementById('c3d-p-costo-'+id);if(co) co.textContent=formatCLP(costoTotal);
    const ne=document.getElementById('c3d-p-neto-'+id);if(ne) ne.textContent=formatCLP(netoTotal);
    const to=document.getElementById('c3d-p-total-'+id);if(to) to.textContent=formatCLP(totalConIva);
    grandTotal+=totalConIva;
  });
  const tel=document.getElementById('c3d-i-total');if(tel) tel.textContent=formatCLP(grandTotal);
}

function c3dAplicarACot(){
  if(!c3dPiezasActivas.length){toast('Agrega al menos una pieza','error');return;}
  c3dPiezasActivas.forEach(id=>{
    const desc=(document.getElementById('c3d-p-desc-'+id)?.value||'').trim()||'Pieza impresión 3D';
    const{costoUnit,netoUnit,qty}=c3dCalcPieza(id);
    qcalcInsertRow(c3dTarget,{desc,und:qty,costoUnit,ventaUnit:netoUnit});
  });
  const count=c3dPiezasActivas.length;
  c3dPiezasActivas=[];c3dPiezaCounter=0;
  const plist=document.getElementById('c3d-i-piezas');if(plist) plist.innerHTML='';
  const tel=document.getElementById('c3d-i-total');if(tel) tel.textContent='$0';
  const panel=document.getElementById('c3d-inline-panel');if(panel) panel.style.display='none';
  Object.values(_c3dBtns()).forEach(b=>{if(b)b.style.background='';});
  toast(count+' pieza'+(count!==1?'s':'')+' agregada'+(count!==1?'s':'')+' a la cotización ✓','success');
}

// keep stub so old bookmarked calls don't crash
function calc3dInit(){}

function toggleNuevoMenu(e){
  e.stopPropagation();
  const panel=document.getElementById('nuevoDropPanel');
  const btn=document.getElementById('nuevoDropBtn');
  const arrow=document.getElementById('nuevoDropArrow');
  const isOpen=panel.style.display!=='none';
  if(isOpen){
    panel.style.display='none';
    if(arrow)arrow.style.transform='rotate(0deg)';
  } else {
    const rect=btn.getBoundingClientRect();
    panel.style.top=(rect.bottom+8)+'px';
    panel.style.right=(window.innerWidth-rect.right)+'px';
    panel.style.left='auto';
    panel.style.display='block';
    if(arrow)arrow.style.transform='rotate(180deg)';
  }
}
function toggleNuevoMenuMobile(e){
  e.stopPropagation();
  const panel=document.getElementById('nuevoDropPanel');
  const btn=document.getElementById('mobilePlusBtn');
  if(!panel||!btn) return;
  // #nuevoDropdown has display:none!important on mobile, which hides its children
  // even when they have position:fixed. Move panel to <body> to escape that.
  if(panel.parentElement!==document.body) document.body.appendChild(panel);
  const isOpen=panel.style.display!=='none';
  if(isOpen){panel.style.display='none';}
  else{
    const rect=btn.getBoundingClientRect();
    panel.style.top=(rect.bottom+6)+'px';
    panel.style.left=Math.max(8,rect.left-100)+'px';
    panel.style.right='auto';
    panel.style.display='block';
  }
}
function closeNuevoMenu(){
  const panel=document.getElementById('nuevoDropPanel');
  const arrow=document.getElementById('nuevoDropArrow');
  if(panel)panel.style.display='none';
  if(arrow)arrow.style.transform='rotate(0deg)';
}
function toggleMobileNuevo(){
  const body=document.getElementById('mobileNuevoBody');
  const chevron=document.getElementById('mobileNuevoChevron');
  const isOpen=body&&body.style.display!=='none';
  if(body)body.style.display=isOpen?'none':'block';
  if(chevron)chevron.style.transform=isOpen?'rotate(0deg)':'rotate(180deg)';
}
function toggleMobileConfig(){
  const body=document.getElementById('mobileConfigBody');
  const chevron=document.getElementById('mobileConfigChevron');
  const isOpen=body&&body.style.display!=='none';
  if(body)body.style.display=isOpen?'none':'flex';
  if(chevron)chevron.style.transform=isOpen?'rotate(0deg)':'rotate(180deg)';
  if(!isOpen) populateMobileConfig();
}
function populateMobileConfig(){
  const at=document.getElementById('mbAirtableToken');
  if(at){const v=lsGet('airtable_token');at.value=v?'••••••••'+v.slice(-4):'';at.placeholder=v?'(guardado)':'patXXX...';at.onfocus=()=>{if(at.value.startsWith('••')){at.value='';at.placeholder='patXXX...';}};at.onblur=()=>{if(!at.value){const vv=lsGet('airtable_token');at.value=vv?'••••••••'+vv.slice(-4):'';at.placeholder=vv?'(guardado)':'patXXX...';}}}
  const oi=document.getElementById('mbOpenaiKey');
  if(oi){const v=localStorage.getItem('fp_openai_key');oi.value='';oi.placeholder=v?'(guardada — escribe nueva para cambiar)':'sk-proj-...';}
  const gc=document.getElementById('mbGoogleClientId');
  if(gc){const v=localStorage.getItem('google_drive_client_id')||'';gc.value=v?v.slice(0,12)+'…'+v.slice(-8):'';}
  const ds=document.getElementById('mbDriveStatus');
  if(ds){const v=localStorage.getItem('google_drive_client_id');ds.textContent=v?'✓ Client ID configurado':'Sin configurar';}
  const pu=document.getElementById('mbProxyUrl');if(pu) pu.value=localStorage.getItem('proxy_url')||'';
  const pk=document.getElementById('mbProxyKey');
  if(pk){const v=localStorage.getItem('proxy_key');pk.value=v?'••••••••'+v.slice(-4):'';pk.onfocus=()=>{if(pk.value.startsWith('••')){pk.value='';pk.placeholder='clave-secreta';}};pk.onblur=()=>{if(!pk.value){const vv=localStorage.getItem('proxy_key');pk.value=vv?'••••••••'+vv.slice(-4):'';}};}
  const ps=document.getElementById('mbProxyStatus');
  if(ps){const v=localStorage.getItem('proxy_url');ps.textContent=v?'✓ Proxy activo':'Sin proxy — token local';}
  const pt=document.getElementById('mbPrinterTunnel');if(pt) pt.value=localStorage.getItem('printer_tunnel')||'';
  const ptk=document.getElementById('mbPrinterToken');if(ptk){const v=localStorage.getItem('printer_tunnel_token');ptk.value=v?'••••••••'+v.slice(-4):'';ptk.onfocus=()=>{if(ptk.value.startsWith('••'))ptk.value='';};ptk.onblur=()=>{if(!ptk.value){const vv=localStorage.getItem('printer_tunnel_token');ptk.value=vv?'••••••••'+vv.slice(-4):'';}};}
  const pts=document.getElementById('mbPrinterTunnelStatus');
  if(pts){const v=localStorage.getItem('printer_tunnel');pts.textContent=(v?'✓ '+v:'Default: https://printers.thelab.solutions')+(localStorage.getItem('printer_tunnel_token')?' · 🔑':'');}
  const ak=document.getElementById('mbAnthropicKey');
  if(ak){const v=lsGet('anthropic_key');ak.value='';ak.placeholder=v&&!v.startsWith('%%')?'(guardada — escribe nueva para cambiar)':'sk-ant-api03-...';}
  const aks=document.getElementById('mbAnthropicStatus');
  if(aks){const v=lsGet('anthropic_key');aks.textContent=v&&!v.startsWith('%%')?'✓ KAI conectado':'Sin configurar';}
}
function saveMbAirtableToken(){
  const inp=document.getElementById('mbAirtableToken');const v=(inp?.value||'').trim();
  if(!v)return toast('Ingresa un token válido','error');
  lsSet('airtable_token',v);inp.value='••••••••'+v.slice(-4);
  toast('Token Airtable guardado ✓','success');loadAllData();
}
function clearMbAirtableToken(){
  localStorage.removeItem('airtable_token');sessionStorage.removeItem('airtable_token');
  const inp=document.getElementById('mbAirtableToken');if(inp){inp.value='';inp.placeholder='patXXX...';}
  toast('Token Airtable eliminado','info');
}
function saveMbOpenaiKey(){
  const inp=document.getElementById('mbOpenaiKey');const v=(inp?.value||'').trim();
  if(!v){
    const existing=localStorage.getItem('fp_openai_key');
    return toast(existing?'OpenAI Key ya está configurada':'Ingresa una API Key válida', existing?'info':'error');
  }
  if(v.startsWith('•'))return toast('Ingresa la key completa','error');
  localStorage.setItem('fp_openai_key',v);
  if(inp){inp.value='';inp.placeholder='(guardada — escribe nueva para cambiar)';}
  toast('OpenAI Key guardada ✓','success');
}
function clearMbOpenaiKey(){
  localStorage.removeItem('fp_openai_key');
  const inp=document.getElementById('mbOpenaiKey');if(inp){inp.value='';inp.placeholder='sk-proj-...';}
  toast('OpenAI Key eliminada','info');
}
function saveMbGoogleClientId(){
  const inp=document.getElementById('mbGoogleClientId');const v=(inp?.value||'').trim();
  if(!v)return toast('Ingresa un Client ID válido','error');
  localStorage.setItem('google_drive_client_id',v);
  const ds=document.getElementById('mbDriveStatus');if(ds) ds.textContent='✓ Client ID configurado';
  toast('Google Drive Client ID guardado ✓','success');
}
function clearMbGoogleClientId(){
  localStorage.removeItem('google_drive_client_id');_driveTokenClient=null;_driveAccessToken=null;
  const inp=document.getElementById('mbGoogleClientId');if(inp) inp.value='';
  const ds=document.getElementById('mbDriveStatus');if(ds) ds.textContent='Sin configurar';
  toast('Google Client ID eliminado','info');
}
function saveMbProxy(){
  const urlInp=document.getElementById('mbProxyUrl');const keyInp=document.getElementById('mbProxyKey');
  const url=(urlInp?.value||'').trim();const key=(keyInp?.value||'').trim();
  if(url) localStorage.setItem('proxy_url',url); else localStorage.removeItem('proxy_url');
  if(key) localStorage.setItem('proxy_key',key); else localStorage.removeItem('proxy_key');
  const ps=document.getElementById('mbProxyStatus');
  if(ps) ps.textContent=url?'✓ Proxy activo':'Sin proxy — token local';
  toast(url?'Proxy Worker guardado ✓':'Proxy eliminado','success');
}
function clearMbProxy(){
  localStorage.removeItem('proxy_url');localStorage.removeItem('proxy_key');
  const urlInp=document.getElementById('mbProxyUrl');if(urlInp) urlInp.value='';
  const keyInp=document.getElementById('mbProxyKey');if(keyInp) keyInp.value='';
  const ps=document.getElementById('mbProxyStatus');if(ps) ps.textContent='Sin proxy — token local';
  toast('Proxy eliminado','info');
}
function saveMbPrinterTunnel(){
  const inp=document.getElementById('mbPrinterTunnel');const v=(inp?.value||'').trim();
  if(v) localStorage.setItem('printer_tunnel',v); else localStorage.removeItem('printer_tunnel');
  const tkInp=document.getElementById('mbPrinterToken');const tk=(tkInp?.value||'').trim();
  if(tk&&!tk.startsWith('••'))localStorage.setItem('printer_tunnel_token',tk);
  else if(!tk)localStorage.removeItem('printer_tunnel_token');
  if(tkInp&&tk&&!tk.startsWith('••'))tkInp.value='••••••••'+tk.slice(-4);
  const pts=document.getElementById('mbPrinterTunnelStatus');
  if(pts) pts.textContent=(v?'✓ '+v:'Default: https://printers.thelab.solutions')+(localStorage.getItem('printer_tunnel_token')?' · 🔑':'');
  toast(v?'Túnel guardado ✓':'Túnel restablecido al default','success');
  if(typeof pollPrinters==='function')pollPrinters();
}
function clearMbPrinterTunnel(){
  localStorage.removeItem('printer_tunnel');
  localStorage.removeItem('printer_tunnel_token');
  const inp=document.getElementById('mbPrinterTunnel');if(inp) inp.value='';
  const tkInp=document.getElementById('mbPrinterToken');if(tkInp) tkInp.value='';
  const pts=document.getElementById('mbPrinterTunnelStatus');if(pts) pts.textContent='Default: https://printers.thelab.solutions';
  toast('Túnel restablecido al default','info');
}
function saveMbAnthropicKey(){
  const inp=document.getElementById('mbAnthropicKey');const v=(inp?.value||'').trim();
  if(!v){
    const existing=lsGet('anthropic_key');
    if(existing&&!existing.startsWith('%%')) toast('KAI ya tiene una key configurada','info');
    else toast('Ingresa una API Key de Anthropic','error');
    return;
  }
  if(v.startsWith('•')){toast('Ingresa la key completa, no el valor enmascarado','error');return;}
  lsSet('anthropic_key',v);
  if(inp){inp.value='';inp.placeholder='(guardada — escribe nueva para cambiar)';}
  const st=document.getElementById('mbAnthropicStatus');if(st) st.textContent='✓ KAI conectado';
  toast('✓ KAI API Key guardada','success');
}
function clearMbAnthropicKey(){
  lsSet('anthropic_key','');
  const inp=document.getElementById('mbAnthropicKey');if(inp){inp.value='';inp.placeholder='sk-ant-api03-...';}
  const st=document.getElementById('mbAnthropicStatus');if(st) st.textContent='Sin configurar';
  toast('KAI API Key eliminada','info');
}
function saveMbElevenLabsKey(){
  const inp=document.getElementById('mbElevenLabsKey');const v=(inp?.value||'').trim();
  if(!v){toast('Ingresa una API Key de ElevenLabs','error');return;}
  localStorage.setItem('elevenlabs_key',v);
  if(inp){inp.value='';inp.placeholder='Guardada ✓';}
  const st=document.getElementById('mbElevenLabsStatus');if(st) st.textContent='✓ Voz ElevenLabs activa';
  toast('✓ ElevenLabs Key guardada','success');
}
function clearMbElevenLabsKey(){
  localStorage.removeItem('elevenlabs_key');
  const inp=document.getElementById('mbElevenLabsKey');if(inp){inp.value='';inp.placeholder='sk_...';}
  const st=document.getElementById('mbElevenLabsStatus');if(st) st.textContent='Sin configurar';
  toast('ElevenLabs Key eliminada','info');
}
document.addEventListener('click',function(e){
  const dd=document.getElementById('nuevoDropdown');
  if(dd&&!dd.contains(e.target))closeNuevoMenu();
});

// ══════════════════════════════════════════════════════════════
//  BÚSQUEDA GLOBAL  (command palette — secciones, acciones y datos)
// ══════════════════════════════════════════════════════════════
let _gsResults=[];   // funciones a ejecutar, indexadas (para teclado)
let _gsActive=-1;    // índice activo (navegación con flechas)
let _gsInited=false;

const GS_SECTIONS=[
  {tab:'overview',      icon:'icon-overview',      c:'#00d4cc',title:'Overview',        kw:'inicio resumen centro comando dashboard panel general home'},
  {tab:'clientes',      icon:'icon-clientes',       c:'#3b82f6',title:'Clientes',        kw:'crm contactos empresas leads'},
  {tab:'cotizaciones',  icon:'icon-cotizaciones',   c:'#a78bfa',title:'Cotizaciones',    kw:'presupuestos cotizar ofertas quotes'},
  {tab:'pedidos',       icon:'icon-pedidos',        c:'#ff6b35',title:'Pedidos',         kw:'ordenes produccion despacho ventas'},
  {tab:'proveedores',   icon:'icon-proveedores',    c:'#ffaa00',title:'Proveedores',     kw:'suppliers compras insumos'},
  {tab:'agentes',       icon:'icon-agentes',        c:'#10b981',title:'Agentes IA',      kw:'ia ai kai automatizacion bots asistentes'},
  {tab:'maquinas',      icon:'icon-maquinas',       c:'#ff4444',title:'Máquinas',        kw:'impresoras 3d printers monitor capacidad'},
  {tab:'equipo',        icon:'icon-equipo',         c:'#f472b6',title:'Equipo',          kw:'personas staff calendario turnos rrhh'},
  {tab:'reporte',       icon:'icon-reporte',        c:'#14b8a6',title:'Reportes',        kw:'analitica estadisticas metricas informes'},
  {tab:'web',           icon:'icon-web',            c:'#6366f1',title:'Web',             kw:'wordpress google ads seo sitio marketing'},
  {tab:'finanzas',      icon:'icon-finanzas',       c:'#22c55e',title:'Finanzas',        kw:'facturas dte sii caja flujo dinero contabilidad'},
  {tab:'visual',        icon:'icon-visual',         c:'#8b5cf6',title:'Visual AI',       kw:'imagenes render diseno generador'},
  {tab:'remuneraciones',icon:'icon-remuneraciones', c:'#84cc16',title:'Remuneraciones',  kw:'sueldos pagos nominas liquidaciones rrhh'},
  {tab:'redes',         icon:'icon-redes',          c:'#ec4899',title:'Redes Sociales',  kw:'instagram tiktok linkedin facebook social media contenido calendario posts comunidad'},
];
const GS_ACTIONS=[
  {nuevo:'nuevo-lead',     icon:'icon-user-plus',    title:'Nuevo Lead / Cliente',    kw:'crear agregar nuevo cliente contacto lead',  run:()=>switchTab('nuevo-lead')},
  {nuevo:'nuevo-proveedor',icon:'icon-proveedores',  title:'Nuevo Proveedor',         kw:'crear agregar proveedor',                    run:()=>switchTab('nuevo-proveedor')},
  {nuevo:'nueva-cot',      icon:'icon-cotizaciones', title:'Nueva Cotización',        kw:'crear cotizar presupuesto',                  run:()=>switchTab('nueva-cot')},
  {nuevo:'nueva-venta',    icon:'icon-trending',     title:'Nueva Venta',             kw:'registrar venta ingreso',                    run:()=>{try{irANuevaVenta();}catch(e){}}},
  {nuevo:'libro-diario',   icon:'icon-book',         title:'Nuevo Registro (Diario)', kw:'libro diario contabilidad asiento',          run:()=>{try{irALibroDiario();}catch(e){}}},
  {icon:'icon-refresh',    title:'Actualizar datos',           kw:'refrescar recargar sync sincronizar update', run:()=>{try{loadAllData();}catch(e){}}},
  {icon:'icon-settings',   title:'Mi cuenta / Configuración',  kw:'ajustes tokens api keys config cuenta',      run:()=>{try{openUserMenu();}catch(e){}}},
];

function _gsNorm(s){return (s||'').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');}
function _gsHi(text,q){
  const t=(text||'').toString(); if(!q) return escapeHtml(t);
  const i=_gsNorm(t).indexOf(_gsNorm(q)); if(i<0) return escapeHtml(t);
  return escapeHtml(t.slice(0,i))+'<mark>'+escapeHtml(t.slice(i,i+q.length))+'</mark>'+escapeHtml(t.slice(i+q.length));
}
function _gsAllowed(tab){
  const u=AUTH.getUser(); if(!u) return true;
  const allowed=[...(RBAC.tabs[u.role]||RBAC.tabs.demo),...(RBAC.nuevos[u.role]||[])];
  return allowed.includes(tab);
}
function _gsClienteNombre(rec){
  const st=window.state||{}; const cf=rec.fields&&rec.fields['Cliente'];
  const cid=Array.isArray(cf)?cf[0]:cf;
  if(cid&&st.clientesById&&st.clientesById[cid]) return st.clientesById[cid];
  return (typeof cf==='string')?cf:'';
}
function _gsFocusRow(id){
  const row=document.querySelector('[data-id="'+id+'"]')||document.getElementById('row-'+id);
  if(row&&row.scrollIntoView){row.scrollIntoView({behavior:'smooth',block:'center'});row.classList.add('row-selected');setTimeout(()=>row.classList.remove('row-selected'),2200);}
}

function globalSearchOnInput(raw){
  const q=(raw||'').trim();
  const clr=document.getElementById('gsClear'); if(clr) clr.style.display=q?'flex':'none';
  const kbd=document.querySelector('.gs-kbd'); if(kbd) kbd.style.display=q?'none':'';
  const box=document.getElementById('globalSearchResults'); if(!box) return;
  const nq=_gsNorm(q);
  const groups=[];

  // 1. Secciones
  const secs=GS_SECTIONS.filter(s=>_gsAllowed(s.tab)).filter(s=>!q||_gsNorm(s.title).includes(nq)||_gsNorm(s.kw).includes(nq));
  if(secs.length) groups.push({cat:'Secciones',items:secs.map(s=>({icon:s.icon,bg:s.c,title:s.title,sub:'',go:'Ir →',run:()=>switchTab(s.tab)}))});

  // 2. Acciones rápidas
  const acts=GS_ACTIONS.filter(a=>!a.nuevo||_gsAllowed(a.nuevo)).filter(a=>!q||_gsNorm(a.title).includes(nq)||_gsNorm(a.kw).includes(nq));
  if(acts.length) groups.push({cat:'Acciones',items:acts.map(a=>({icon:a.icon,bg:'',title:a.title,sub:'',go:'',run:a.run}))});

  // 3. Datos (sólo con 2+ caracteres)
  if(q.length>=2){
    const st=window.state||{}; const byCat={};
    const push=(cat,it)=>{(byCat[cat]=byCat[cat]||[]).push(it);};
    if(_gsAllowed('clientes')) (st.clientes||[]).forEach(c=>{
      const nom=c.fields['Empresa']||c.fields['Contacto']||'—';
      if(_gsNorm(nom).includes(nq)||_gsNorm(c.fields['Contacto']||'').includes(nq))
        push('Clientes',{icon:'icon-clientes',bg:'#3b82f6',title:nom,sub:'Cliente',go:'Abrir →',run:()=>{switchTab('clientes');setTimeout(()=>_gsFocusRow(c.id),250);}});
    });
    if(_gsAllowed('pedidos')) (st.pedidos||[]).forEach(p=>{
      const num=p.fields['N° Pedido']||p.id; const cli=_gsClienteNombre(p);
      if(_gsNorm(num).includes(nq)||_gsNorm(cli).includes(nq))
        push('Pedidos',{icon:'icon-pedidos',bg:'#ff6b35',title:num,sub:'Pedido'+(p.fields['Estado pedido']?' · '+p.fields['Estado pedido']:'')+(cli?' · '+cli:''),go:'Abrir →',run:()=>switchTab('pedidos')});
    });
    if(_gsAllowed('cotizaciones')) (st.cotizaciones||[]).forEach(co=>{
      const num=co.fields['N° Cotización']||co.id; const cli=_gsClienteNombre(co);
      if(_gsNorm(num).includes(nq)||_gsNorm(cli).includes(nq))
        push('Cotizaciones',{icon:'icon-cotizaciones',bg:'#a78bfa',title:num,sub:'Cotización'+(cli?' · '+cli:''),go:'Abrir →',run:()=>switchTab('cotizaciones')});
    });
    if(_gsAllowed('proveedores')) (st.proveedores||[]).forEach(pv=>{
      const nom=pv.fields['Nombre']||'—';
      if(_gsNorm(nom).includes(nq))
        push('Proveedores',{icon:'icon-proveedores',bg:'#ffaa00',title:nom,sub:'Proveedor',go:'Abrir →',run:()=>switchTab('proveedores')});
    });
    if(_gsAllowed('finanzas')){
      try{
        const fv=JSON.parse(localStorage.getItem('fin_ventas')||'[]');
        fv.filter(v=>_gsNorm((v.nro||'')+(v.cliente||'')+(v.concepto||'')).includes(nq)).slice(0,4).forEach(v=>{
          push('Facturas',{icon:'icon-finanzas',bg:'#22c55e',title:v.nro||'Sin N°',sub:(v.cliente||'—')+' · '+formatCLP(v.monto||0),go:'Abrir →',run:()=>{switchTab('finanzas');setTimeout(()=>finSwitchTab('facturas'),300);}});
        });
      }catch(e){}
    }
    ['Clientes','Pedidos','Cotizaciones','Proveedores','Facturas'].forEach(cat=>{
      if(byCat[cat]&&byCat[cat].length) groups.push({cat:cat,items:byCat[cat].slice(0,6)});
    });
  }

  _gsResults=[]; _gsActive=-1;
  if(!groups.length){
    box.innerHTML='<div class="gs-empty">Sin resultados para “'+escapeHtml(q)+'”</div>';
    box.classList.add('open'); return;
  }
  let html='';
  groups.forEach(g=>{
    html+='<div class="gs-cat">'+escapeHtml(g.cat)+'</div>';
    g.items.forEach(it=>{
      const idx=_gsResults.length; _gsResults.push(it.run);
      const emojiStyle=it.bg?('background:'+it.bg):'';
      const iconSvg=it.icon?'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="'+(it.bg?'#fff':'var(--accent)')+'" stroke-width="1.5" style="overflow:visible;flex-shrink:0"><use href="#'+it.icon+'"/></svg>':'';
      html+='<div class="gs-item" data-gsi="'+idx+'" onmousedown="event.preventDefault();_gsRun('+idx+')" onmouseenter="_gsSetActive('+idx+')">'
        +'<span class="gs-emoji" style="'+emojiStyle+'">'+iconSvg+'</span>'
        +'<span class="gs-txt"><span class="gs-title">'+_gsHi(it.title,q)+'</span>'+(it.sub?'<span class="gs-sub">'+escapeHtml(it.sub)+'</span>':'')+'</span>'
        +(it.go?'<span class="gs-go">'+escapeHtml(it.go)+'</span>':'')
      +'</div>';
    });
  });
  box.innerHTML=html;
  box.classList.add('open');
}
function _gsRun(idx){
  const fn=_gsResults[idx];
  if(typeof fn==='function'){ globalSearchClear(true); fn(); }
}
function _gsSetActive(idx){
  _gsActive=idx;
  document.querySelectorAll('#globalSearchResults .gs-item').forEach(el=>{
    el.classList.toggle('gs-active', parseInt(el.dataset.gsi)===idx);
  });
}
function _gsScrollActive(){
  const el=document.querySelector('#globalSearchResults .gs-item.gs-active');
  if(el&&el.scrollIntoView) el.scrollIntoView({block:'nearest'});
}
function globalSearchOnKey(e){
  const box=document.getElementById('globalSearchResults');
  if(e.key==='Escape'){ globalSearchClear(true); e.target.blur(); return; }
  if(!box||!box.classList.contains('open')){ if(e.key==='ArrowDown') globalSearchOnInput(e.target.value); return; }
  const n=_gsResults.length;
  if(e.key==='ArrowDown'){ e.preventDefault(); if(n){_gsSetActive((_gsActive+1)%n);_gsScrollActive();} }
  else if(e.key==='ArrowUp'){ e.preventDefault(); if(n){_gsSetActive((_gsActive-1+n)%n);_gsScrollActive();} }
  else if(e.key==='Enter'){ e.preventDefault(); if(_gsActive>=0)_gsRun(_gsActive); else if(n)_gsRun(0); }
}
function globalSearchClear(keepBlur){
  const inp=document.getElementById('globalSearchInput');
  if(inp) inp.value='';
  const clr=document.getElementById('gsClear'); if(clr) clr.style.display='none';
  const kbd=document.querySelector('.gs-kbd'); if(kbd) kbd.style.display='';
  closeGlobalSearch();
  if(!keepBlur&&inp) inp.focus();
}
function closeGlobalSearch(){
  const box=document.getElementById('globalSearchResults');
  if(box){box.classList.remove('open');box.innerHTML='';}
  _gsResults=[]; _gsActive=-1;
}
function initGlobalSearch(){
  if(_gsInited) return; _gsInited=true;
  document.addEventListener('click',e=>{
    const gs=document.getElementById('globalSearch');
    if(gs&&!gs.contains(e.target)) closeGlobalSearch();
  });
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&(e.key==='k'||e.key==='K')){
      e.preventDefault();
      const inp=document.getElementById('globalSearchInput');
      if(inp){inp.focus();inp.select();globalSearchOnInput(inp.value);}
    }
  });
}

// ── SII / DTE ─────────────────────────────────────────────────
function getSIICfg(){try{const c=JSON.parse(localStorage.getItem('sii_cfg')||'{}');return{webhookUrl:c.webhookUrl||_DEFAULTS.SII_WORKER_URL,rutEmisor:c.rutEmisor||_DEFAULTS.SII_RUT_EMISOR,razonEmisor:c.razonEmisor||_DEFAULTS.SII_RAZON_SOCIAL};}catch(e){return{webhookUrl:_DEFAULTS.SII_WORKER_URL,rutEmisor:_DEFAULTS.SII_RUT_EMISOR,razonEmisor:_DEFAULTS.SII_RAZON_SOCIAL};}}
async function uploadCAF(tipo,input){
  const file=input.files[0];if(!file)return;
  const cfg=getSIICfg();
  if(!cfg?.webhookUrl){toast('Configura primero la URL del Worker SII','error');input.value='';return;}
  const statusEl=document.getElementById('cafStatus'+tipo);
  if(statusEl){statusEl.style.color='var(--text3)';statusEl.textContent='⏳ Subiendo...';}
  try{
    const caf_xml=await file.text();
    const r=await fetch(cfg.webhookUrl+'/caf',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({tipo_documento:tipo,caf_xml})});
    const d=await r.json();
    if(r.ok){
      if(statusEl){statusEl.style.color='var(--accent)';statusEl.textContent='✅ Folios '+d.rango?.desde+'–'+d.rango?.hasta;}
      toast('✅ CAF tipo '+tipo+' subido — folios '+d.rango?.desde+'–'+d.rango?.hasta,'success');
    }else{
      if(statusEl){statusEl.style.color='var(--danger)';statusEl.textContent='⛔ '+(d.error||r.status);}
      toast('Error subiendo CAF: '+(d.error||r.status),'error');
    }
  }catch(e){
    if(statusEl){statusEl.style.color='var(--danger)';statusEl.textContent='⛔ '+e.message;}
    toast('Error: '+e.message,'error');
  }
  input.value='';
}
async function checkFolios(tipo){
  const cfg=getSIICfg();
  if(!cfg?.webhookUrl){toast('Configura primero la URL del Worker SII','error');return;}
  const statusEl=document.getElementById('cafStatus'+tipo);
  if(statusEl){statusEl.style.color='var(--text3)';statusEl.textContent='⏳...';}
  try{
    const r=await fetch(cfg.webhookUrl+'/folio/'+tipo);
    const d=await r.json();
    if(r.ok){
      const disp=d.folios_disponibles;
      const color=disp<=10?'var(--danger)':disp<=30?'var(--warning)':'var(--accent)';
      if(statusEl){statusEl.style.color=color;statusEl.textContent=(disp<=10?'⚠ ':'✅ ')+'Sgte: '+d.siguiente_folio+' · Disp: '+disp;}
    }else{
      if(statusEl){statusEl.style.color='var(--text3)';statusEl.textContent='Sin CAF cargado';}
    }
  }catch(e){
    if(statusEl){statusEl.style.color='var(--danger)';statusEl.textContent='⛔ '+e.message;}
  }
}
function openDTEModal(pedidoId){
  const p=state.pedidosById[pedidoId];if(!p) return;
  const f=p.fields;
  const clienteId=Array.isArray(f['Cliente'])?f['Cliente'][0]:f['Cliente'];
  const c=state.clientes.find(x=>x.id===clienteId);
  const cf=c?.fields||{};
  document.getElementById('dtePedidoId').value=pedidoId;
  document.getElementById('dteRefPedido').value=f['N° Pedido']||'';
  document.getElementById('dteRut').value=cf['RUT']||'';
  document.getElementById('dteRazonSocial').value=cf['Empresa']||'';
  document.getElementById('dteGiro').value=cf['Industria / Rubro']||'';
  document.getElementById('dteEmail').value=cf['Email']||'';
  document.getElementById('dteDescripcion').value=f['Solicitud cliente (texto libre)']||f['Detalle productos']||'Servicio de fabricación digital';
  const neto=Math.round((f['Monto total (CLP)']||0)/1.19);
  document.getElementById('dteMontoNeto').value=neto||'';
  dteRecalcular();
  document.getElementById('dteObservaciones').value=('Pedido '+(f['N° Pedido']||'')).trim();
  document.getElementById('dteRutMsg').textContent='';
  const btn=document.getElementById('dteSubmitBtn');if(btn){btn.disabled=false;btn.textContent='📤 Emitir DTE';}
  const dteNum=f['DTE N°']||'';
  if(dteNum&&btn){btn.textContent='📤 Emitir nuevo DTE';btn.style.opacity='0.85';}else if(btn){btn.style.opacity='1';}
  const cfg=getSIICfg();
  const sb=document.getElementById('dteSIIStatus');
  if(cfg?.webhookUrl){sb.style.color='var(--accent)';sb.innerHTML='\u2705 Webhook configurado \u2014 emisor: <strong>'+escapeHtml(cfg.razonEmisor||cfg.rutEmisor||'Tu empresa')+'</strong>'+(dteNum?' &nbsp;&middot;&nbsp; <span style="color:var(--accent3)">DTE anterior: N\u00b0 '+escapeHtml(dteNum)+'</span>':'');}
  else{sb.style.color='var(--text3)';sb.innerHTML='⚠ Sin configurar — <a href="#" onclick="openSIIConfigModal();event.preventDefault()" style="color:var(--accent)">configura el Worker SII</a>';}
  document.getElementById('dteModal').style.display='flex';
}
function closeDTEModal(){document.getElementById('dteModal').style.display='none';}
function dteRecalcular(){
  const neto=parseInt(document.getElementById('dteMontoNeto').value)||0;
  const iva=Math.round(neto*0.19);
  document.getElementById('dteIva').value=neto?formatCLP(iva):'';
  document.getElementById('dteTotal').value=neto?formatCLP(neto+iva):'';
}
function dteValidarRut(el){
  const msg=document.getElementById('dteRutMsg');const v=(el.value||'').trim();
  if(!v){msg.textContent='';return;}
  if(validRUT(v)){msg.style.color='var(--accent)';msg.textContent='✓ RUT válido';el.value=formatRUT(v);}
  else{msg.style.color='var(--danger)';msg.textContent='✗ RUT inválido — revisa el dígito verificador';}
}
async function emitirDTE(){
  const cfg=getSIICfg();
  if(!cfg?.webhookUrl){toast('Configura el Worker SII primero','error');openSIIConfigModal();return;}
  const pedidoId=document.getElementById('dtePedidoId').value;
  const rut=(document.getElementById('dteRut').value||'').trim();
  const razonSocial=(document.getElementById('dteRazonSocial').value||'').trim();
  const neto=parseInt(document.getElementById('dteMontoNeto').value)||0;
  if(!rut||!validRUT(rut)){toast('RUT receptor inválido — revisa el dígito verificador','error');return;}
  if(!razonSocial){toast('La razón social es requerida','error');return;}
  if(!neto){toast('El monto neto debe ser mayor a 0','error');return;}
  const btn=document.getElementById('dteSubmitBtn');btn.disabled=true;btn.textContent='⏳ Emitiendo...';
  const iva=Math.round(neto*0.19);
  const payload={
    tipo_documento:document.getElementById('dteTipoDoc').value,
    referencia:document.getElementById('dteRefPedido').value,
    emisor:{rut:cfg.rutEmisor||'',razon_social:cfg.razonEmisor||''},
    receptor:{rut:formatRUT(rut),razon_social:razonSocial,giro:document.getElementById('dteGiro').value,email:document.getElementById('dteEmail').value},
    detalle:[{nombre:document.getElementById('dteDescripcion').value||'Servicio de fabricación digital',cantidad:1,precio_unitario:neto,monto_neto:neto}],
    totales:{neto,iva,total:neto+iva},
    observaciones:document.getElementById('dteObservaciones').value
  };
  try{
    const r=await fetch(cfg.webhookUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(!r.ok) throw new Error(`HTTP ${r.status} — verifica la URL del webhook`);
    let resp={};try{resp=await r.json();}catch(e){}
    const dteNum=resp.dte_numero||resp.folio||resp.numero||resp.id||'';
    const tipoDTE=document.getElementById('dteTipoDoc').value;
    const pdfUrl=resp.pdf_url||resp.url_pdf||resp.pdf||(dteNum?cfg.webhookUrl+'/pdf/'+tipoDTE+'/'+dteNum:'');
    if(dteNum){
      try{await airtableWrite('Pedidos','PATCH',pedidoId,{'DTE N°':String(dteNum)});}catch(e){}
      const p=state.pedidosById[pedidoId];if(p) p.fields['DTE N°']=String(dteNum);
      renderPedidos();
    }
    toast('\u2705 DTE emitido'+(dteNum?' \u2014 N\u00b0 '+dteNum:'')+(pdfUrl?' \u00b7 <a href="'+escapeHtml(pdfUrl)+'" target="_blank" style="color:var(--accent)">Ver PDF</a>':''),'success');
    if(pdfUrl) window.open(pdfUrl,'_blank');
    closeDTEModal();
  }catch(e){toast('Error al emitir DTE: '+e.message,'error');}
  btn.disabled=false;btn.textContent='📤 Emitir DTE';
}
function openSIIConfigModal(){
  const cfg=getSIICfg();
  document.getElementById('siiWebhookUrl').value=cfg.webhookUrl||'';
  document.getElementById('siiRutEmisor').value=cfg.rutEmisor||'';
  document.getElementById('siiRazonEmisor').value=cfg.razonEmisor||'';
  const sb=document.getElementById('siiStatusBox');
  if(cfg?.webhookUrl){sb.style.color='var(--accent)';sb.innerHTML='✅ Worker activo: <strong>'+escapeHtml(cfg.webhookUrl)+'</strong>';}
  else{sb.style.color='var(--text3)';sb.textContent='Sin configurar — ingresa la URL del Worker SII.';}
  // Reset CAF status
  ['33','39','61'].forEach(t=>{const el=document.getElementById('cafStatus'+t);if(el){el.style.color='var(--text3)';el.textContent='—';}});
  document.getElementById('siiConfigModal').style.display='flex';
  // Auto-check folios if URL is configured
  if(cfg?.webhookUrl) setTimeout(()=>['33','39','61'].forEach(checkFolios),300);
}
function closeSIIConfigModal(){document.getElementById('siiConfigModal').style.display='none';}
function saveSIIConfig(){
  const webhookUrl=(document.getElementById('siiWebhookUrl').value||'').trim();
  const rutEmisor=(document.getElementById('siiRutEmisor').value||'').trim();
  const razonEmisor=(document.getElementById('siiRazonEmisor').value||'').trim();
  if(!webhookUrl){toast('La URL del Worker es requerida','error');return;}
  localStorage.setItem('sii_cfg',JSON.stringify({webhookUrl,rutEmisor,razonEmisor}));
  toast('✓ Configuración SII guardada','success');
  const sb=document.getElementById('dteSIIStatus');
  if(sb&&document.getElementById('dteModal').style.display!=='none'){
    sb.style.color='var(--accent)';sb.innerHTML='✅ Worker SII activo — emisor: <strong>'+escapeHtml(razonEmisor||rutEmisor||'Tu empresa')+'</strong>';
  }
  closeSIIConfigModal();
}
async function testSIIWorker(){
  const url=(document.getElementById('siiWebhookUrl').value||'').trim();
  if(!url){toast('Ingresa la URL del Worker primero','error');return;}
  const sb=document.getElementById('siiStatusBox');
  if(sb){sb.style.color='var(--text3)';sb.textContent='⏳ Probando conexión...';}
  try{
    const r=await fetch(url+'/health',{method:'GET'});
    const d=await r.json();
    if(r.ok){
      if(sb){sb.style.color='var(--accent)';sb.innerHTML='✅ Worker activo — env: <strong>'+escapeHtml(d.sii_env||'?')+'</strong> | RUT: '+escapeHtml(d.rut_emisor||'?')+'<br>'+(d.cert_loaded?'🔐 Certificado cargado':'⚠ Certificado no cargado');}
      toast('✅ Worker SII conectado','success');
    }else{
      if(sb){sb.style.color='var(--danger)';sb.textContent='⛔ Error '+r.status+': '+JSON.stringify(d);}
      toast('Error: '+r.status,'error');
    }
  }catch(e){
    if(sb){sb.style.color='var(--danger)';sb.textContent='⛔ No se pudo conectar: '+e.message;}
    toast('Error de conexión: '+e.message,'error');
  }
}

// ── FUNNEL DE CONVERSIÓN ─────────────────────────────────────────────
function renderFunnel(){
  const el=document.getElementById('ovFunnelBody');if(!el)return;
  const now=new Date();
  const ms=new Date(now.getFullYear(),now.getMonth(),1);
  const me=new Date(now.getFullYear(),now.getMonth()+1,0);
  const periodoLabel=ms.toLocaleDateString('es-CL',{month:'long',year:'numeric'});
  const lbl=document.getElementById('ovFunnelPeriodo');if(lbl)lbl.textContent=periodoLabel;
  const _cot=isVendorMode()?state.cotizaciones.filter(vendorOwnsRecord):state.cotizaciones;
  const _ped=isVendorMode()?state.pedidos.filter(vendorOwnsRecord):state.pedidos;
  const _cli=isVendorMode()?state.clientes.filter(vendorOwnsRecord):state.clientes;
  const inMes=d=>d&&new Date(d)>=ms&&new Date(d)<=me;
  // Stages
  const leads=_cli.filter(c=>c.createdTime&&inMes(c.createdTime)).length;
  const cots=_cot.filter(c=>c.createdTime&&inMes(c.createdTime)).length;
  const peds=_ped.filter(p=>p.createdTime&&inMes(p.createdTime)&&(p.fields['Estado pedido']||'')!=='Cancelado').length;
  const cerrados=_ped.filter(p=>p.fields['Estado pedido']==='Despachado'&&p.createdTime&&inMes(p.createdTime)).length;
  const valCots=_cot.filter(c=>c.createdTime&&inMes(c.createdTime)).reduce((s,c)=>s+Math.round((c.fields['Total final (CLP)']||0)/1.19),0);
  const valPeds=_ped.filter(p=>p.createdTime&&inMes(p.createdTime)&&(p.fields['Estado pedido']||'')!=='Cancelado').reduce((s,p)=>s+Math.round((p.fields['Monto total (CLP)']||0)/1.19),0);
  const valCerr=_ped.filter(p=>p.fields['Estado pedido']==='Despachado'&&p.createdTime&&inMes(p.createdTime)).reduce((s,p)=>s+Math.round((p.fields['Monto total (CLP)']||0)/1.19),0);
  const pct=(a,b)=>b>0?Math.round(a/b*100):0;
  const stages=[
    {icon:'<svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#icon-clientes"/></svg>',label:'Leads Nuevos',n:leads,val:null,color:'var(--accent4)',next:cots},
    {icon:'<svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#icon-cotizaciones"/></svg>',label:'Cotizaciones',n:cots,val:valCots,color:'var(--accent)',next:peds},
    {icon:'📦',label:'Pedidos',n:peds,val:valPeds,color:'var(--accent2)',next:cerrados},
    {icon:'✅',label:'Cerrados',n:cerrados,val:valCerr,color:'var(--accent3)',next:null},
  ];
  const cols=stages.map((s,i)=>{
    const conv=i>0&&stages[i-1].n>0?`<div style="font-size:10px;color:var(--text3);margin-top:4px">${pct(s.n,stages[i-1].n)}% conv.</div>`:'';
    const arrow=i<stages.length-1?`<div style="font-size:20px;color:var(--text3);align-self:center">→</div>`:'';
    return`<div style="text-align:center;flex:1;min-width:90px">
      <div style="font-size:22px;margin-bottom:2px">${s.icon}</div>
      <div style="font-size:28px;font-weight:700;color:${s.color};font-family:'Bebas Neue',sans-serif">${s.n}</div>
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px">${s.label}</div>
      ${s.val!=null?`<div style="font-size:11px;color:var(--text2);font-weight:600">${formatCLP(s.val)}</div>`:''}
      ${conv}
    </div>${arrow}`;
  }).join('');
  // Bar visual
  const max=Math.max(leads,cots,peds,cerrados,1);
  const bars=stages.map(s=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
    <div style="width:80px;font-size:10px;color:var(--text3);text-align:right;flex-shrink:0">${s.label}</div>
    <div style="flex:1;height:18px;background:var(--surface2);border-radius:4px;overflow:hidden">
      <div style="height:100%;width:${pct(s.n,max)}%;background:${s.color};border-radius:4px;transition:width .4s;min-width:${s.n>0?'24px':'0'}"></div>
    </div>
    <div style="width:28px;font-size:11px;font-weight:700;color:${s.color};text-align:right;flex-shrink:0">${s.n}</div>
  </div>`).join('');
  el.innerHTML=`<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:16px;padding:0 4px">${cols}</div><div style="border-top:1px solid var(--border);padding-top:14px">${bars}</div>`;
}

// ── REMUNERACIONES SUELDOS & LIQUIDACIÓN ─────────────────────────────
const REM_SUELDO_KEY='rem_sueldos_v1';
function remToggleSueldos(){
  const p=document.getElementById('remSueldoPanel');if(!p) return;
  const vis=p.style.display==='none';p.style.display=vis?'':'none';
  if(vis) remRenderSueldoGrid();
}
function remRenderSueldoGrid(){
  const grid=document.getElementById('remSueldoGrid');if(!grid) return;
  let sueldos;try{sueldos=JSON.parse(localStorage.getItem(REM_SUELDO_KEY)||'{}');}catch(e){sueldos={};}
  const personas=typeof PERSONAS!=='undefined'?PERSONAS:[];
  if(!personas.length){grid.innerHTML='<div style="font-size:11px;color:var(--text3)">No hay integrantes configurados</div>';return;}
  grid.innerHTML=personas.map(p=>`<div class="field-group" style="margin:0">
    <label class="field-label" style="display:flex;align-items:center;gap:4px"><span>${p.avatar}</span> ${escapeHtml(p.nombre)}</label>
    <input class="field-input" id="rem-sueldo-${p.nombre.replace(/\s/g,'_')}" type="number" min="0" step="10000" placeholder="0" value="${sueldos[p.nombre]||''}">
  </div>`).join('');
}
function remSaveSueldos(){
  const personas=typeof PERSONAS!=='undefined'?PERSONAS:[];
  const sueldos={};
  personas.forEach(p=>{const id='rem-sueldo-'+p.nombre.replace(/\s/g,'_');const v=parseInt(document.getElementById(id)?.value)||0;if(v>0) sueldos[p.nombre]=v;});
  localStorage.setItem(REM_SUELDO_KEY,JSON.stringify(sueldos));
  toast('✓ Sueldos guardados','success');
  renderRemuneraciones();
}
function remRenderLiquidacion(totalNeto,totalComision){
  const liqBody=document.getElementById('remLiqBody');if(!liqBody) return;
  let sueldos;try{sueldos=JSON.parse(localStorage.getItem(REM_SUELDO_KEY)||'{}');}catch(e){sueldos={};}
  const personas=typeof PERSONAS!=='undefined'?PERSONAS:[];
  const items=personas.map(p=>{
    const sueldo=sueldos[p.nombre]||0;
    const afp=Math.round(sueldo*0.10);
    const isapre=Math.round(sueldo*0.07);
    const comision=typeof vendorOwnsRecord!=='undefined'?0:Math.round(sueldo>0?totalComision/personas.length:0);
    const neto=sueldo-afp-isapre+comision;
    return{nombre:p.nombre,avatar:p.avatar,sueldo,afp,isapre,comision,neto};
  }).filter(x=>x.sueldo>0||x.comision>0);
  if(!items.length){liqBody.innerHTML='<div style="font-size:11px;color:var(--text3)">Configura los sueldos base para ver la liquidación</div>';return;}
  liqBody.innerHTML=items.map(x=>`<div style="background:var(--surface2);border-radius:8px;padding:10px 14px;font-size:11px;border:1px solid var(--border2)">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;font-weight:700">${x.avatar} ${escapeHtml(x.nombre)}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:4px">
      <div><span style="color:var(--text3)">Sueldo bruto:</span> <span style="font-weight:600">${formatCLP(x.sueldo)}</span></div>
      <div><span style="color:var(--text3)">AFP (10%):</span> <span style="color:var(--danger)">-${formatCLP(x.afp)}</span></div>
      <div><span style="color:var(--text3)">Isapre (7%):</span> <span style="color:var(--danger)">-${formatCLP(x.isapre)}</span></div>
      <div><span style="color:var(--text3)">Comisión:</span> <span style="color:var(--accent3)">+${formatCLP(x.comision)}</span></div>
      <div style="grid-column:1/-1;border-top:1px solid var(--border);padding-top:4px;margin-top:2px"><span style="color:var(--text3)">Sueldo neto:</span> <span style="font-weight:700;color:var(--accent);font-size:13px">${formatCLP(x.neto)}</span></div>
    </div>
  </div>`).join('');
}

// ── PRESUPUESTO MENSUAL ───────────────────────────────────────────────
const PRES_KEY='fin_presupuesto_v1';
const PRES_CATS_DEFAULT=[
  {id:'marketing',label:'Marketing & Ads',color:'#f59e0b',icon:'<svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#icon-megaphone"/></svg>'},
  {id:'proveedores',label:'Proveedores / Materiales',color:'#3b82f6',icon:'<svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#icon-proveedores"/></svg>'},
  {id:'sueldos',label:'Sueldos & Honorarios',color:'#10b981',icon:'<svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#icon-dollar"/></svg>'},
  {id:'arriendo',label:'Arriendo & Servicios',color:'#8b5cf6',icon:'<svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#icon-building2"/></svg>'},
  {id:'equipos',label:'Equipos & Herramientas',color:'#ef4444',icon:'<svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#icon-wrench"/></svg>'},
  {id:'otros',label:'Otros gastos',color:'#6b7280',icon:'<svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#icon-pedidos"/></svg>'},
];
function presGetData(){try{return JSON.parse(localStorage.getItem(PRES_KEY)||'{}');}catch(e){return{};}}
function presSetData(d){localStorage.setItem(PRES_KEY,JSON.stringify(d));}
function presKey(anio,mes){return`${anio}-${String(mes).padStart(2,'0')}`;}
function renderPresupuesto(){
  const anioSel=document.getElementById('pres-anio');
  const mesSel=document.getElementById('pres-mes');
  const now=new Date();
  if(anioSel&&!anioSel.options.length){
    [2024,2025,2026,2027].forEach(y=>{const o=document.createElement('option');o.value=y;o.textContent=y;if(y===now.getFullYear())o.selected=true;anioSel.appendChild(o);});
  }
  if(mesSel&&!mesSel.options.length){
    ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].forEach((m,i)=>{const o=document.createElement('option');o.value=i+1;o.textContent=m;if(i===now.getMonth())o.selected=true;mesSel.appendChild(o);});
  }
  const anio=parseInt(document.getElementById('pres-anio')?.value||now.getFullYear());
  const mes=parseInt(document.getElementById('pres-mes')?.value||now.getMonth()+1);
  const key=presKey(anio,mes);
  const data=presGetData();
  const periodoData=data[key]||{};
  const cats=periodoData.cats||PRES_CATS_DEFAULT.map(c=>({...c,budget:0,ejecutado:0}));
  // Intentar poblar ejecutado desde libro diario
  let ldData=[];try{ldData=JSON.parse(localStorage.getItem('ld_entries')||'[]');}catch(e){}
  const totalBudget=cats.reduce((s,c)=>s+(c.budget||0),0);
  const totalEjec=cats.reduce((s,c)=>s+(c.ejecutado||0),0);
  const disp=totalBudget-totalEjec;
  const pct=totalBudget>0?Math.round(totalEjec/totalBudget*100):0;
  const setText=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  setText('pres-k-total',formatCLP(totalBudget));
  setText('pres-k-ejec',formatCLP(totalEjec));
  setText('pres-k-disp',formatCLP(disp));
  setText('pres-k-pct',pct+'%');
  const catsEl=document.getElementById('pres-cats');if(!catsEl) return;
  catsEl.innerHTML=cats.map((c,i)=>{
    const pctC=c.budget>0?Math.round(c.ejecutado/c.budget*100):0;
    const barColor=pctC>=100?'var(--danger)':pctC>=80?'var(--warn)':c.color;
    return`<div style="border:1px solid var(--border2);border-radius:8px;padding:12px 14px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:16px">${c.icon}</span>
        <span style="font-weight:600;font-size:12px;flex:1">${escapeHtml(c.label)}</span>
        <span style="font-size:10px;color:${barColor};font-weight:700;background:${barColor}22;padding:2px 6px;border-radius:3px">${pctC}%</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="field-group" style="margin:0"><label class="field-label">Presupuesto (CLP)</label><input class="field-input" id="pres-cat-b-${i}" type="number" min="0" step="10000" value="${c.budget||''}" placeholder="0" oninput="presPreviewBar(${i})"></div>
        <div class="field-group" style="margin:0"><label class="field-label">Ejecutado (CLP)</label><input class="field-input" id="pres-cat-e-${i}" type="number" min="0" step="10000" value="${c.ejecutado||''}" placeholder="0" oninput="presPreviewBar(${i})"></div>
      </div>
      <div style="margin-top:8px;height:6px;background:var(--surface3);border-radius:3px;overflow:hidden" id="pres-bar-${i}">
        <div style="height:100%;width:${Math.min(pctC,100)}%;background:${barColor};border-radius:3px;transition:width .3s"></div>
      </div>
    </div>`;
  }).join('');
}
function presPreviewBar(i){
  const b=parseFloat(document.getElementById(`pres-cat-b-${i}`)?.value)||0;
  const e=parseFloat(document.getElementById(`pres-cat-e-${i}`)?.value)||0;
  const pct=b>0?Math.min(100,Math.round(e/b*100)):0;
  const barEl=document.getElementById(`pres-bar-${i}`);
  if(barEl){const inner=barEl.firstElementChild;if(inner)inner.style.width=pct+'%';}
}
function presGuardar(){
  const anio=parseInt(document.getElementById('pres-anio')?.value||new Date().getFullYear());
  const mes=parseInt(document.getElementById('pres-mes')?.value||new Date().getMonth()+1);
  const key=presKey(anio,mes);
  const data=presGetData();
  const cats=PRES_CATS_DEFAULT.map((c,i)=>({...c,budget:parseFloat(document.getElementById(`pres-cat-b-${i}`)?.value)||0,ejecutado:parseFloat(document.getElementById(`pres-cat-e-${i}`)?.value)||0}));
  data[key]={cats};presSetData(data);
  renderPresupuesto();toast('✓ Presupuesto guardado','success');
}
function presAddCategoria(){
  toast('Edita las categorías directamente en los campos — próximamente categorías custom','info');
}
function presExportCSV(){
  const anio=parseInt(document.getElementById('pres-anio')?.value||new Date().getFullYear());
  const mes=parseInt(document.getElementById('pres-mes')?.value||new Date().getMonth()+1);
  const key=presKey(anio,mes);const data=presGetData();const periodoData=data[key]||{};
  const cats=periodoData.cats||PRES_CATS_DEFAULT.map(c=>({...c,budget:0,ejecutado:0}));
  const rows=[['Categoría','Presupuesto','Ejecutado','Disponible','% Ejecución'],...cats.map(c=>[c.label,c.budget,c.ejecutado,c.budget-c.ejecutado,c.budget>0?Math.round(c.ejecutado/c.budget*100)+'%':'—'])];
  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,﻿'+encodeURIComponent(csv);a.download=`presupuesto_${key}.csv`;a.click();
}

// ── PORTAL DE CLIENTE ─────────────────────────────────────────────────
function checkClientePortal(){
  const params=new URLSearchParams(window.location.search);
  const portalToken=params.get('portal');
  if(!portalToken) return;
  let clienteId;
  try{clienteId=atob(portalToken);}catch(e){return;}
  if(!clienteId.startsWith('rec')) return;
  document.body.style.overflow='hidden';
  const overlay=document.createElement('div');
  overlay.id='clientePortalOverlay';
  overlay.style.cssText='position:fixed;inset:0;background:var(--black);z-index:9999;display:flex;flex-direction:column;overflow:hidden';
  overlay.innerHTML=`<div style="padding:16px 20px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px">
    <img loading="lazy" decoding="async" src="https://dashboard.thelab.solutions/logo-thelab.png" style="height:28px;object-fit:contain" onerror="this.style.display='none'">
    <div><div style="font-size:14px;font-weight:700;color:var(--text)">The Lab Solutions</div><div style="font-size:11px;color:var(--text3)">Portal de seguimiento de pedidos</div></div>
  </div>
  <div style="flex:1;overflow-y:auto;padding:20px;max-width:800px;margin:0 auto;width:100%">
    <div id="portalContent"><div class="loading-state"><div class="spinner"></div> Cargando...</div></div>
  </div>`;
  document.body.appendChild(overlay);
  function renderPortal(){
    const cliente=state.clientes.find(c=>c.id===clienteId);
    if(!cliente){document.getElementById('portalContent').innerHTML='<div class="empty-state"><div class="empty-icon"><svg class="dashboard-icon" width="28" height="28" stroke-width="1.5"><use href="#icon-equipo"/></svg></div>Cliente no encontrado</div>';return;}
    const f=cliente.fields;
    const nombre=f['Empresa']||f['Contacto']||'Cliente';
    const pedidos=state.pedidos.filter(p=>{const cli=p.fields['Cliente'];return Array.isArray(cli)?cli.includes(clienteId):cli===clienteId;});
    const cots=state.cotizaciones.filter(c=>{const cli=c.fields['Cliente'];return Array.isArray(cli)?cli.includes(clienteId):cli===clienteId;}).slice(0,10);
    const stageColors={'Confirmado':'var(--accent)','En producción':'var(--accent2)','Listo para despacho':'var(--accent3)','Despachado':'var(--accent4)'};
    const stages=['Confirmado','En producción','Listo para despacho','Despachado'];
    // Stepper visual del avance del pedido (mismo lenguaje que el pipeline interno)
    const stepper=est=>{const idx=stages.indexOf(est);
      return `<div style="display:flex;align-items:center;gap:3px;margin:10px 0 4px">${stages.map((s,i)=>
        `<div style="display:flex;align-items:center;gap:3px;${i<stages.length-1?'flex:1':''}" title="${s}">
          <div style="width:20px;height:20px;border-radius:50%;border:2px solid ${i<=idx?(stageColors[s]||'var(--accent)'):'var(--border2)'};background:${i<idx?(stageColors[s]||'var(--accent)'):(i===idx?'rgba(0,212,204,0.15)':'var(--surface3)')};display:flex;align-items:center;justify-content:center;font-size:9px;flex-shrink:0;color:${i<idx?'#0a0a0a':'var(--text3)'}">${i<idx?'✓':(i===idx?'●':'○')}</div>
          ${i<stages.length-1?`<div style="height:2px;flex:1;background:${i<idx?(stageColors[s]||'var(--accent)'):'var(--border2)'}"></div>`:''}
        </div>`).join('')}</div>
      <div style="display:flex;justify-content:space-between;font-size:8.5px;color:var(--text3);margin-bottom:6px"><span>Confirmado</span><span>Producción</span><span>Listo</span><span>Despachado</span></div>`;};
    const pedHTML=pedidos.length?pedidos.sort((a,b)=>(b.createdTime||'').localeCompare(a.createdTime||'')).map(p=>{
      const pf=p.fields,est=pf['Estado pedido']||'Confirmado',atras=pf['Fecha entrega']&&new Date(pf['Fecha entrega']+'T00:00:00')<new Date();
      const prod=String(pf['Detalle productos']||pf['Solicitud cliente (texto libre)']||'').trim().slice(0,110);
      return`<div style="background:var(--surface2);border:1px solid var(--border2);border-radius:10px;padding:14px 16px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <div style="font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:${stageColors[est]||'var(--text)'}">${escapeHtml(pf['N° Pedido']||'—')}</div>
          <span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:5px;background:${stageColors[est]||'var(--surface3)'}22;color:${stageColors[est]||'var(--text3)'};">${est==='Despachado'?'✓ Despachado':est}</span>
        </div>
        ${prod?`<div style="font-size:11px;color:var(--text2);margin-bottom:2px">${escapeHtml(prod)}</div>`:''}
        ${est==='Cancelado'?'':stepper(est)}
        ${pf['Fecha entrega']?`<div style="font-size:11px;color:${atras&&est!=='Despachado'?'var(--warn)':'var(--text3)'}">📅 ${est==='Despachado'?'Entregado':'Entrega estimada'}: ${pf['Fecha despacho']&&est==='Despachado'?pf['Fecha despacho']:pf['Fecha entrega']}${atras&&est!=='Despachado'?' · en proceso de despacho':''}</div>`:''}
        ${pf['Notas']?`<div style="font-size:11px;color:var(--text2);border-left:2px solid var(--border2);padding-left:8px;margin-top:6px">${formatRichText(pf['Notas']||'')}</div>`:''}
      </div>`;
    }).join(''):'<div style="text-align:center;padding:20px;color:var(--text3);font-size:12px">Sin pedidos registrados</div>';
    // Cotizaciones abiertas (a la espera de respuesta del cliente)
    const cotsAbiertas=cots.filter(c=>['Enviada','Solicitada'].includes(c.fields['Estado cotización']||''));
    const cotHTML=cotsAbiertas.length?cotsAbiertas.map(c=>{const cf=c.fields;
      const total=cf['Total final (CLP)']?formatCLP(cf['Total final (CLP)']):'';
      const vto=cf['Fecha vencimiento']||'';
      return`<div style="background:var(--surface2);border:1px solid var(--border2);border-radius:10px;padding:11px 16px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div><span style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;color:var(--accent)">${escapeHtml(cf['N° Cotización']||'—')}</span>
        ${total?`<span style="font-size:12px;color:var(--text);font-weight:700;margin-left:10px">${total} <span style="font-size:9px;color:var(--text3)">IVA incl.</span></span>`:''}</div>
        <div style="font-size:10px;color:var(--text3)">${vto?'Válida hasta '+vto+' · ':''}¿Dudas? Escríbenos 💬</div>
      </div>`;
    }).join(''):'';
    document.getElementById('portalContent').innerHTML=`
      <h2 style="font-size:18px;font-weight:700;margin-bottom:4px">${escapeHtml(nombre)}</h2>
      <div style="font-size:12px;color:var(--text3);margin-bottom:20px">${pedidos.length} pedido${pedidos.length!==1?'s':''} · ${cots.length} cotización${cots.length!==1?'es':''}</div>
      ${cotHTML?`<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--text3);margin-bottom:10px">Cotizaciones abiertas</div>${cotHTML}<div style="height:10px"></div>`:''}
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--text3);margin-bottom:10px">Pedidos</div>
      ${pedHTML}
      <div style="margin-top:16px;font-size:10px;color:var(--text3);text-align:center">The Lab Solutions — Portal de clientes · <a href="https://thelab.solutions" style="color:var(--accent)">thelab.solutions</a></div>`;
  }
  if(state.loaded){renderPortal();}
  else{const orig=window.renderOverview||function(){};const intv=setInterval(()=>{if(state.loaded){clearInterval(intv);renderPortal();}},500);}
}

// ── CALCULADORAS LÁSER / NEÓN (inline en Nueva/Editar Cotización) ──────
// Paneles únicos generados por JS; se mueven al host del contexto activo
// ('n' = nueva cotización, 'e' = modal editar) igual que la Calculadora 3D.
let _lsrExtras=[],_neoExtras=[];
const _qcalcTarget={lsr:'n',neo:'n'};

// Inserta una fila de ítem en el formulario del contexto indicado
function qcalcInsertRow(ctx,{desc,und,costoUnit,ventaUnit}){
  if(ctx==='e'){
    addEditItemRow({desc,und,costoUnit,ventaUnit});
    return;
  }
  const container=document.getElementById('itemsContainer');
  if(!container){toast('Formulario de cotización no encontrado','error');return;}
  addItemRow();
  const rows=container.querySelectorAll('.item-row');
  const last=rows[rows.length-1];
  if(last){
    last.querySelector('.item-desc').value=desc;
    last.querySelector('.item-und').value=und;
    last.querySelector('.item-costo').value=costoUnit;
    last.querySelector('.item-venta').value=ventaUnit;
  }
  updateItemTotal();
}

const _QCALC={
  lsr:{color:'#f59e0b',rgba:'245,158,11',title:'🔆 Calculadora Corte Láser',defMargen:60},
  neo:{color:'#f97316',rgba:'249,115,22',title:'💡 Calculadora Neón / LED',defMargen:65}
};

function qcalcPanelHtml(kind){
  const q=_QCALC[kind];
  const hdr=`<div style="background:rgba(${q.rgba},0.08);padding:10px 14px;border-bottom:1px solid rgba(${q.rgba},0.2);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
    <span style="font-weight:700;font-size:13px;color:${q.color}">${q.title}</span>
    <div style="display:flex;align-items:center;gap:10px">
      <label style="font-size:11px;color:var(--text3);margin:0">Margen</label>
      <span id="${kind}-margen-lbl" style="font-size:13px;font-weight:700;font-family:'JetBrains Mono',monospace;color:${q.color};min-width:38px;text-align:right">${q.defMargen}%</span>
      <input type="range" id="${kind}-margen" min="10" max="90" value="${q.defMargen}" oninput="qcalcUpdate('${kind}')" style="width:130px;accent-color:${q.color};cursor:pointer">
    </div>
  </div>`;
  const fields=kind==='lsr'
    ?`<div class="field-group" style="grid-column:1/-1"><label class="field-label">Descripción</label><input class="field-input" id="lsr-desc" placeholder="ej. Corte logo acrílico 3mm"></div>
      <div class="field-group"><label class="field-label">Material</label>
        <select class="field-select" id="lsr-mat" onchange="qcalcUpdate('lsr')">
          <option value="2800">Acrílico 3mm — $2.800/cm²</option>
          <option value="3500">Acrílico 5mm — $3.500/cm²</option>
          <option value="480">MDF 3mm — $480/cm²</option>
          <option value="750">MDF 6mm — $750/cm²</option>
          <option value="120">Cartón corrugado — $120/cm²</option>
          <option value="1200">Cuero / Simil — $1.200/cm²</option>
          <option value="350">Tela / Fieltro — $350/cm²</option>
        </select></div>
      <div class="field-group"><label class="field-label">Área corte (cm²)</label><input class="field-input" id="lsr-area" type="number" min="0" value="0" oninput="qcalcUpdate('lsr')"></div>
      <div class="field-group"><label class="field-label">% Desperdicio</label><input class="field-input" id="lsr-desp" type="number" min="0" max="60" value="15" oninput="qcalcUpdate('lsr')"></div>
      <div class="field-group"><label class="field-label">Cantidad copias</label><input class="field-input" id="lsr-qty" type="number" min="1" value="1" oninput="qcalcUpdate('lsr')"></div>
      <div class="field-group"><label class="field-label">T. corte (min)</label><input class="field-input" id="lsr-t-corte" type="number" min="0" value="0" oninput="qcalcUpdate('lsr')"></div>
      <div class="field-group"><label class="field-label">T. grabado (min)</label><input class="field-input" id="lsr-t-grab" type="number" min="0" value="0" oninput="qcalcUpdate('lsr')"></div>
      <div class="field-group"><label class="field-label">Tarifa máquina ($/hr)</label><input class="field-input" id="lsr-tarifa" type="number" min="0" value="8000" oninput="qcalcUpdate('lsr')"></div>
      <div class="field-group"><label class="field-label">Mano de obra (min)</label><input class="field-input" id="lsr-mdo" type="number" min="0" value="0" oninput="qcalcUpdate('lsr')"></div>`
    :`<div class="field-group" style="grid-column:1/-1"><label class="field-label">Descripción</label><input class="field-input" id="neo-desc" placeholder="ej. Letrero Neon 'The Lab' rosa 80cm"></div>
      <div class="field-group"><label class="field-label">Tecnología</label>
        <select class="field-select" id="neo-tipo" onchange="qcalcUpdate('neo')">
          <option value="4200">LED Flex Silicona — $4.200/m</option>
          <option value="3100">LED Cuerda neon — $3.100/m</option>
          <option value="12000">Neon gas (vidrio) — $12.000/m</option>
        </select></div>
      <div class="field-group"><label class="field-label">Longitud tubo (m)</label><input class="field-input" id="neo-largo" type="number" min="0" step="0.1" value="0" oninput="qcalcUpdate('neo')"></div>
      <div class="field-group"><label class="field-label">N° colores / cortes</label><input class="field-input" id="neo-colores" type="number" min="1" max="8" value="1" oninput="qcalcUpdate('neo')"></div>
      <div class="field-group"><label class="field-label">Cantidad</label><input class="field-input" id="neo-qty" type="number" min="1" value="1" oninput="qcalcUpdate('neo')"></div>
      <div class="field-group"><label class="field-label">Soporte / backing</label>
        <select class="field-select" id="neo-soporte" onchange="qcalcUpdate('neo')">
          <option value="0">Sin soporte</option>
          <option value="15000">Acrílico transparente — $15.000</option>
          <option value="22000">Acrílico negro — $22.000</option>
          <option value="35000">MDF pintado — $35.000</option>
          <option value="55000">Estructura metálica — $55.000</option>
        </select></div>
      <div class="field-group"><label class="field-label">Transformador</label>
        <select class="field-select" id="neo-trans" onchange="qcalcUpdate('neo')">
          <option value="8500">Estándar 12V — $8.500</option>
          <option value="15000">Potenciado 12V/24V — $15.000</option>
          <option value="0">Sin transformador</option>
        </select></div>
      <div class="field-group"><label class="field-label">Control dimmer/remoto</label>
        <select class="field-select" id="neo-dimmer" onchange="qcalcUpdate('neo')">
          <option value="0">Sin control</option>
          <option value="7500">Dimmer manual — $7.500</option>
          <option value="14000">Control remoto RF — $14.000</option>
          <option value="22000">App Bluetooth — $22.000</option>
        </select></div>`;
  return `${hdr}
  <div style="padding:10px 14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">${fields}</div>
  <div style="padding:0 14px 10px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--text3)">Extras / Insumos</span><button type="button" class="btn-mini btn-mini-yellow" onclick="qcalcAddExtra('${kind}')">+ Extra</button></div>
    <div id="${kind}-extras" style="display:flex;flex-direction:column;gap:6px"></div>
  </div>
  <div id="${kind}-desglose" style="padding:6px 14px;border-top:1px solid rgba(${q.rgba},0.15);font-size:10px;color:var(--text3);font-family:'JetBrains Mono',monospace"></div>
  <div style="padding:10px 14px;border-top:1px solid rgba(${q.rgba},0.15);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
    <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;align-items:center">
      <span style="color:var(--text3)">Costo <strong id="${kind}-r-costo" style="font-family:'JetBrains Mono',monospace;color:var(--text2)">$0</strong></span>
      <span style="color:var(--text3)">Neto <strong id="${kind}-r-neto" style="font-family:'JetBrains Mono',monospace;color:var(--text)">$0</strong></span>
      <span style="color:var(--text3)">c/IVA <strong id="${kind}-r-total" style="font-family:'JetBrains Mono',monospace;color:${q.color};font-size:13px">$0</strong></span>
      <span style="color:var(--text3)">por unidad <strong id="${kind}-r-pieza" style="font-family:'JetBrains Mono',monospace;color:var(--accent)">$0</strong></span>
    </div>
    <div style="display:flex;gap:6px">
      <button type="button" class="btn btn-ghost btn-sm" onclick="qcalcClear('${kind}')" title="Limpiar">↺</button>
      <button type="button" class="btn btn-primary btn-sm" onclick="qcalcApply('${kind}')">✓ Agregar a cotización</button>
    </div>
  </div>`;
}

function qcalcEnsure(kind){
  let panel=document.getElementById(kind+'-inline-panel');
  if(panel) return panel;
  const q=_QCALC[kind];
  panel=document.createElement('div');
  panel.id=kind+'-inline-panel';
  panel.style.cssText=`display:none;margin-top:10px;border:1px solid rgba(${q.rgba},0.35);border-radius:10px;overflow:hidden;background:var(--surface2)`;
  panel.innerHTML=qcalcPanelHtml(kind);
  return panel;
}

function _qcalcBtns(kind){return{n:document.getElementById(kind+'-btn-n'),e:document.getElementById(kind+'-btn-e')};}

function qcalcToggle(kind,ctx){
  const panel=qcalcEnsure(kind);
  const btns=_qcalcBtns(kind);
  const q=_QCALC[kind];
  const isOpen=panel.style.display!=='none';
  if(isOpen&&_qcalcTarget[kind]===ctx){
    panel.style.display='none';
    Object.values(btns).forEach(b=>{if(b)b.style.background='';});
    return;
  }
  _qcalcTarget[kind]=ctx;
  const host=document.getElementById('calc-host-'+ctx);
  if(host) host.appendChild(panel);
  panel.style.display='block';
  Object.entries(btns).forEach(([k,b])=>{if(b)b.style.background=k===ctx?`rgba(${q.rgba},0.15)`:'';});
  qcalcUpdate(kind);
}

function qcalcAddExtra(kind){
  (kind==='lsr'?_lsrExtras:_neoExtras).push({desc:'',valor:0});
  qcalcExtrasRender(kind);
}
function qcalcExtrasRender(kind){
  const arr=kind==='lsr'?_lsrExtras:_neoExtras;
  const el=document.getElementById(kind+'-extras');if(!el)return;
  const ref=kind==='lsr'?'_lsrExtras':'_neoExtras';
  el.innerHTML=arr.map((x,i)=>`<div style="display:flex;gap:8px;align-items:center">
    <input class="field-input" style="flex:1" placeholder="Descripción extra" value="${escapeHtml(x.desc)}" oninput="${ref}[${i}].desc=this.value">
    <input class="field-input" style="width:120px" type="number" min="0" placeholder="Valor CLP" value="${x.valor||''}" oninput="${ref}[${i}].valor=parseInt(this.value)||0;qcalcUpdate('${kind}')">
    <button type="button" class="btn-mini btn-mini-red" onclick="${ref}.splice(${i},1);qcalcExtrasRender('${kind}');qcalcUpdate('${kind}')">✕</button>
  </div>`).join('');
}

// Cálculo de costos — devuelve costo/neto por unidad y desglose
function qcalcCompute(kind){
  const v=id=>parseFloat(document.getElementById(id)?.value)||0;
  if(kind==='lsr'){
    const qty=Math.max(1,parseInt(document.getElementById('lsr-qty')?.value)||1);
    const desp=v('lsr-desp')/100;
    const tarifa=v('lsr-tarifa');
    const costoMat=Math.round(v('lsr-area')*v('lsr-mat')*(1+desp));
    const costoMaq=Math.round((v('lsr-t-corte')+v('lsr-t-grab'))/60*tarifa);
    const costoMdo=Math.round(v('lsr-mdo')/60*(tarifa*0.4));
    const extras=_lsrExtras.reduce((s,x)=>s+(x.valor||0),0);
    const margen=Math.min(90,Math.max(10,parseInt(document.getElementById('lsr-margen')?.value)||60))/100;
    const costoUnit=costoMat+costoMaq+costoMdo+extras;
    const netoUnit=Math.round(costoUnit/(1-margen));
    return{qty,margen,costoUnit,netoUnit,desglose:`Mat $${costoMat.toLocaleString('es-CL')} · Máq $${costoMaq.toLocaleString('es-CL')} · MDO $${costoMdo.toLocaleString('es-CL')} · Extras $${extras.toLocaleString('es-CL')} (por unidad)`,
      desc:(document.getElementById('lsr-desc')?.value||'').trim()||'Trabajo corte láser'};
  }
  const qty=Math.max(1,parseInt(document.getElementById('neo-qty')?.value)||1);
  const colores=Math.max(1,parseInt(document.getElementById('neo-colores')?.value)||1);
  const costoTubo=Math.round(v('neo-largo')*v('neo-tipo')*colores);
  const soporte=v('neo-soporte'),trans=v('neo-trans'),dimmer=v('neo-dimmer');
  const extras=_neoExtras.reduce((s,x)=>s+(x.valor||0),0);
  const margen=Math.min(90,Math.max(10,parseInt(document.getElementById('neo-margen')?.value)||65))/100;
  const costoUnit=costoTubo+soporte+trans+dimmer+extras;
  const netoUnit=Math.round(costoUnit/(1-margen));
  return{qty,margen,costoUnit,netoUnit,desglose:`Tubo $${costoTubo.toLocaleString('es-CL')} · Sop $${soporte.toLocaleString('es-CL')} · Trafo $${trans.toLocaleString('es-CL')} · Ctrl $${dimmer.toLocaleString('es-CL')} · Extras $${extras.toLocaleString('es-CL')} (por unidad)`,
    desc:(document.getElementById('neo-desc')?.value||'').trim()||'Letrero Neón/LED'};
}

function qcalcUpdate(kind){
  const panel=document.getElementById(kind+'-inline-panel');
  if(!panel||panel.style.display==='none') return;
  const r=qcalcCompute(kind);
  const lbl=document.getElementById(kind+'-margen-lbl');if(lbl)lbl.textContent=Math.round(r.margen*100)+'%';
  const netoTotal=r.netoUnit*r.qty;
  const totalIva=Math.round(netoTotal*1.19);
  const s=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=formatCLP(val);};
  s(kind+'-r-costo',r.costoUnit*r.qty);
  s(kind+'-r-neto',netoTotal);
  s(kind+'-r-total',totalIva);
  s(kind+'-r-pieza',r.qty>0?Math.round(totalIva/r.qty):0);
  const dg=document.getElementById(kind+'-desglose');if(dg)dg.textContent=r.desglose;
}

function qcalcApply(kind){
  const r=qcalcCompute(kind);
  if(r.costoUnit<=0){toast('Ingresa los datos del trabajo primero','error');return;}
  qcalcInsertRow(_qcalcTarget[kind],{desc:r.desc,und:r.qty,costoUnit:r.costoUnit,ventaUnit:r.netoUnit});
  qcalcClear(kind);
  const panel=document.getElementById(kind+'-inline-panel');if(panel)panel.style.display='none';
  Object.values(_qcalcBtns(kind)).forEach(b=>{if(b)b.style.background='';});
  toast('Ítem agregado a la cotización ✓','success');
}

function qcalcClear(kind){
  const q=_QCALC[kind];
  const defaults=kind==='lsr'
    ?{'lsr-desc':'','lsr-qty':'1','lsr-area':'0','lsr-desp':'15','lsr-t-corte':'0','lsr-t-grab':'0','lsr-tarifa':'8000','lsr-mdo':'0'}
    :{'neo-desc':'','neo-qty':'1','neo-largo':'0','neo-colores':'1'};
  Object.entries(defaults).forEach(([id,val])=>{const el=document.getElementById(id);if(el)el.value=val;});
  const sel=kind==='lsr'?['lsr-mat']:['neo-tipo','neo-soporte','neo-trans','neo-dimmer'];
  sel.forEach(id=>{const el=document.getElementById(id);if(el)el.selectedIndex=0;});
  const m=document.getElementById(kind+'-margen');if(m)m.value=q.defMargen;
  if(kind==='lsr')_lsrExtras=[];else _neoExtras=[];
  qcalcExtrasRender(kind);
  qcalcUpdate(kind);
}
