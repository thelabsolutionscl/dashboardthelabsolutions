/* js/proveedores.js — módulo extraído de index.html (carga en el mismo punto). */
// ── PROVEEDORES ───────────────────────────────────────────────
function repStars(n){const v=parseInt(n)||0;return'★'.repeat(Math.min(v,5))+'☆'.repeat(Math.max(0,5-v));}
function repBadge(n){const v=parseInt(n)||0;const cls=v>=4?'badge-green':v>=3?'badge-yellow':'badge-orange';return v?`<span class="badge ${cls}" title="${v}/5">${repStars(v)}</span>`:'—';}
function estadoPvBadge(e){const map={'Activo':'badge-green','En evaluación':'badge-yellow','Inactivo':'badge-gray','Bloqueado':'badge-red'};return`<span class="badge ${map[e]||'badge-gray'}">${e||'—'}</span>`;}

// Categoría en Airtable es multipleSelects → llega como [{id,name,color}] o string
function pvCat(f){const c=f['Categoría'];if(!c) return '';if(Array.isArray(c)) return c.map(x=>x.name||x).join(', ');return String(c);}
const PV_CAT_COLORS={
  'Filamentos 3D':           ['#00d4cc','rgba(0,212,204,0.13)','rgba(0,212,204,0.32)'],
  'Resinas y materiales':    ['#ff6b35','rgba(255,107,53,0.13)','rgba(255,107,53,0.32)'],
  'Componentes LED / Neones':['#ffaa00','rgba(255,170,0,0.13)','rgba(255,170,0,0.32)'],
  'Trofeos y medallas':      ['#f59e0b','rgba(245,158,11,0.13)','rgba(245,158,11,0.32)'],
  'Packaging / Embalaje':    ['#60a5fa','rgba(96,165,250,0.13)','rgba(96,165,250,0.32)'],
  'Electrónica y cables':    ['#a78bfa','rgba(167,139,250,0.13)','rgba(167,139,250,0.32)'],
  'Logística y despacho':    ['#00d4aa','rgba(0,212,170,0.13)','rgba(0,212,170,0.32)'],
  'Diseño / Gráfica':        ['#f472b6','rgba(244,114,182,0.13)','rgba(244,114,182,0.32)'],
  'Servicios varios':        ['#94a3b8','rgba(148,163,184,0.13)','rgba(148,163,184,0.32)'],
  'Otro':                    ['#888','rgba(136,136,136,0.12)','rgba(136,136,136,0.28)'],
};
// Paleta extra para categorías nuevas (cicla automáticamente)
const PV_CAT_EXTRA_PALETTE=[
  ['#f43f5e','rgba(244,63,94,0.13)','rgba(244,63,94,0.32)'],
  ['#8b5cf6','rgba(139,92,246,0.13)','rgba(139,92,246,0.32)'],
  ['#06b6d4','rgba(6,182,212,0.13)','rgba(6,182,212,0.32)'],
  ['#84cc16','rgba(132,204,22,0.13)','rgba(132,204,22,0.32)'],
  ['#ec4899','rgba(236,72,153,0.13)','rgba(236,72,153,0.32)'],
  ['#14b8a6','rgba(20,184,166,0.13)','rgba(20,184,166,0.32)'],
  ['#f97316','rgba(249,115,22,0.13)','rgba(249,115,22,0.32)'],
  ['#6366f1','rgba(99,102,241,0.13)','rgba(99,102,241,0.32)'],
];
const PV_CATS_DEFAULT=['Filamentos 3D','Resinas y materiales','Componentes LED / Neones','Trofeos y medallas','Packaging / Embalaje','Electrónica y cables','Logística y despacho','Diseño / Gráfica','Servicios varios','Otro'];
function getPvCats(){try{const s=localStorage.getItem('pv_categorias');return s?JSON.parse(s):[...PV_CATS_DEFAULT];}catch{return[...PV_CATS_DEFAULT];}}
function setPvCats(arr){localStorage.setItem('pv_categorias',JSON.stringify(arr));}
function getPvCatColorMap(){try{const s=localStorage.getItem('pv_cat_colors');return s?JSON.parse(s):{};} catch{return {};}}
function setPvCatColorMap(obj){localStorage.setItem('pv_cat_colors',JSON.stringify(obj));}
function getPvCatColor(cat){
  if(PV_CAT_COLORS[cat]) return PV_CAT_COLORS[cat];
  const custom=getPvCatColorMap();
  if(custom[cat]) return custom[cat];
  // auto-asignar desde paleta extra y persistir
  const cats=getPvCats();
  const idx=Math.max(0,cats.indexOf(cat)-Object.keys(PV_CAT_COLORS).length);
  const color=PV_CAT_EXTRA_PALETTE[idx%PV_CAT_EXTRA_PALETTE.length];
  const cm=getPvCatColorMap();cm[cat]=color;setPvCatColorMap(cm);
  return color||['#888','rgba(136,136,136,0.12)','rgba(136,136,136,0.28)'];
}
function fillCatSelects(){
  const configured=getPvCats();
  // Merge with categories actually present in loaded data (preserving configured order, appending extras)
  const fromData=[];
  (state?.proveedores||[]).forEach(p=>{
    const c=p.fields['Categoría'];
    const names=Array.isArray(c)?c.map(x=>x.name||x):[c].filter(Boolean);
    names.forEach(n=>{if(n&&!configured.includes(n)&&!fromData.includes(n)) fromData.push(n);});
  });
  const cats=[...configured,...fromData];
  const configs=[
    {id:'proveedorCatFilter', first:'<option value="">Todas las categorías</option>'},
    {id:'ss-categoria',       first:'<option value="">— cualquiera —</option>'},
    {id:'pvss-categoria',     first:'<option value="">— cualquiera —</option>'},
  ];
  const optsHtml=cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  configs.forEach(({id,first})=>{
    const el=document.getElementById(id);if(!el) return;
    const curr=el.value;
    el.innerHTML=first+optsHtml;
    if(curr) el.value=curr;
  });
  renderPvCatChips('np');
  renderPvCatChips('ep');
}
// ── MULTI-SELECT CATEGORÍAS ───────────────────────────────────
const _pvCatSel={np:[],ep:[]};
function renderPvCatChips(prefix){
  const box=document.getElementById(`${prefix}-catbox`);if(!box) return;
  const cats=getPvCats();const sel=_pvCatSel[prefix]||[];
  if(!cats.length){box.innerHTML='<span style="font-size:11px;color:var(--text3)">Sin categorías — crea una con ⚙ Categorías</span>';return;}
  box.innerHTML=cats.map(cat=>{
    const isSelected=sel.includes(cat);
    const[color,bg,border]=getPvCatColor(cat);
    return`<span onclick="togglePvCatChip('${prefix}','${cat.replace(/'/g,"\\'")}')"`+
      ` style="cursor:pointer;font-size:10px;font-weight:700;padding:4px 10px;border-radius:5px;letter-spacing:.3px;`+
      `border:1px solid ${isSelected?border:'var(--border2)'};`+
      `color:${isSelected?color:'var(--text3)'};`+
      `background:${isSelected?bg:'transparent'};`+
      `transition:all .12s;user-select:none;white-space:nowrap">`+
      `${escapeHtml(cat)}${isSelected?' ✓':''}</span>`;
  }).join('');
}
function togglePvCatChip(prefix,cat){
  const sel=_pvCatSel[prefix];const idx=sel.indexOf(cat);
  if(idx>=0) sel.splice(idx,1);else sel.push(cat);
  renderPvCatChips(prefix);
}
function getPvSelectedCats(prefix){return _pvCatSel[prefix]||[];}
function setPvSelectedCats(prefix,arr){_pvCatSel[prefix]=[...arr];renderPvCatChips(prefix);}

// ── GESTIÓN DE CATEGORÍAS ─────────────────────────────────────
function openCatManager(){renderCatManager();document.getElementById('catManagerModal').style.display='flex';}
function closeCatManager(){document.getElementById('catManagerModal').style.display='none';}
let _catDragIdx=null;
function catDragStart(e,idx){_catDragIdx=idx;e.dataTransfer.effectAllowed='move';e.target.closest('[data-cidx]').style.opacity='.4';}
function catDragOver(e,el){e.preventDefault();e.dataTransfer.dropEffect='move';document.querySelectorAll('#catManagerList [data-cidx]').forEach(x=>x.style.borderColor='var(--border)');el.style.borderColor='var(--accent)';}
function catDrop(e,targetIdx){
  e.preventDefault();
  if(_catDragIdx===null||_catDragIdx===targetIdx) return;
  const cats=getPvCats();const[item]=cats.splice(_catDragIdx,1);cats.splice(targetIdx,0,item);
  setPvCats(cats);fillCatSelects();renderCatManager();
}
function catDragEnd(){_catDragIdx=null;document.querySelectorAll('#catManagerList [data-cidx]').forEach(x=>{x.style.opacity='1';x.style.borderColor='var(--border)';});}
// Reordenar con botones ↑/↓ (el drag HTML5 no funciona en táctil)
function catMove(idx,dir){const cats=getPvCats();const j=idx+dir;if(j<0||j>=cats.length)return;const t=cats[idx];cats[idx]=cats[j];cats[j]=t;setPvCats(cats);fillCatSelects();renderCatManager();}
function renderCatManager(){
  const cats=getPvCats();
  const inUseCount={};
  state.proveedores.forEach(p=>{
    pvCat(p.fields).split(', ').forEach(c=>{const t=c.trim();if(t) inUseCount[t]=(inUseCount[t]||0)+1;});
  });
  document.getElementById('catManagerList').innerHTML=cats.length?cats.map((cat,i)=>{
    const[color]=getPvCatColor(cat);const n=inUseCount[cat]||0;
    return`<div draggable="true" data-cidx="${i}"
      ondragstart="catDragStart(event,${i})" ondragover="catDragOver(event,this)" ondrop="catDrop(event,${i})" ondragend="catDragEnd()"
      style="display:flex;align-items:center;gap:9px;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:7px;transition:border-color .15s">
      <span style="cursor:grab;color:var(--text3);font-size:13px;flex-shrink:0;line-height:1;padding:0 2px" title="Arrastrar para reordenar">⠿</span>
      <span style="width:10px;height:10px;border-radius:50%;flex-shrink:0;background:${color};box-shadow:0 0 6px ${color}88"></span>
      <span style="flex:1;font-size:12px;color:var(--text)">${escapeHtml(cat)}</span>
      ${n?`<span style="font-size:9px;color:var(--text3);font-family:'JetBrains Mono',monospace">${n} uso${n!==1?'s':''}</span>`:''}
      <button onclick="catMove(${i},-1)" ${i===0?'disabled':''} title="Subir" style="background:var(--surface3);border:1px solid var(--border);color:var(--text2);border-radius:4px;padding:2px 7px;font-size:11px;line-height:1;cursor:pointer;opacity:${i===0?'.3':'1'}">↑</button>
      <button onclick="catMove(${i},1)" ${i===cats.length-1?'disabled':''} title="Bajar" style="background:var(--surface3);border:1px solid var(--border);color:var(--text2);border-radius:4px;padding:2px 7px;font-size:11px;line-height:1;cursor:pointer;opacity:${i===cats.length-1?'.3':'1'}">↓</button>
      <button onclick="deletePvCat(${i})" title="${n?'Hay proveedores en esta categoría':''}" style="background:rgba(255,68,68,0.1);border:1px solid rgba(255,68,68,0.25);color:var(--danger);border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif">✕</button>
    </div>`;
  }).join(''):`<div class="empty-state" style="padding:20px;font-size:12px">Sin categorías — agrega una abajo</div>`;
}
function addPvCat(){
  const inp=document.getElementById('catManagerInput');
  const name=(inp?.value||'').trim();
  if(!name){toast('Ingresa el nombre de la categoría','error');inp?.focus();return;}
  const cats=getPvCats();
  if(cats.some(c=>c.toLowerCase()===name.toLowerCase())){toast('Esa categoría ya existe','error');return;}
  cats.push(name);
  setPvCats(cats);
  fillCatSelects();
  renderCatManager();
  inp.value='';
  inp.focus();
  toast(`✓ Categoría "${name}" agregada`,'success');
}
function deletePvCat(idx){
  const cats=getPvCats();
  const name=cats[idx];if(!name) return;
  const inUse=state.proveedores.some(p=>pvCat(p.fields).split(', ').map(s=>s.trim()).includes(name));
  if(inUse&&!confirm(`"${name}" está siendo usada por algunos proveedores.\n¿Eliminar igualmente?`)) return;
  cats.splice(idx,1);
  setPvCats(cats);
  const cm=getPvCatColorMap();delete cm[name];setPvCatColorMap(cm);
  fillCatSelects();
  renderCatManager();
  toast(`Categoría "${name}" eliminada`,'info');
}
function resetPvCats(){
  if(!confirm('¿Restaurar las 10 categorías predeterminadas?\nSe eliminarán las categorías personalizadas.')) return;
  localStorage.removeItem('pv_categorias');
  localStorage.removeItem('pv_cat_colors');
  fillCatSelects();
  renderCatManager();
  toast('Categorías restauradas','success');
}
function pvCatBadge(cat){
  if(!cat||cat==='—') return '<span class="badge badge-gray">—</span>';
  return cat.split(', ').map(c=>{
    const s=c.trim();
    const[color,bg,border]=getPvCatColor(s);
    return `<span style="display:inline-block;font-size:9px;font-weight:600;letter-spacing:0.5px;padding:2px 7px;border-radius:4px;text-transform:uppercase;white-space:nowrap;color:${color};background:${bg};border:1px solid ${border}">${escapeHtml(s)}</span>`;
  }).join(' ');
}
function sortProveedores(key){
  if(proveedoresSort.key===key) proveedoresSort.dir*=-1;
  else{proveedoresSort.key=key;proveedoresSort.dir=1;}
  renderProveedores();_saveUIState();
}
function getSortedProveedores(list){
  if(!proveedoresSort.key) return list;
  const k=proveedoresSort.key,d=proveedoresSort.dir;
  return [...list].sort((a,b)=>{
    const fa=a.fields,fb=b.fields;
    let va,vb;
    if(k==='nombre'){va=(fa['Nombre']||'').toLowerCase();vb=(fb['Nombre']||'').toLowerCase();}
    else if(k==='categoria'){va=pvCat(fa).toLowerCase();vb=pvCat(fb).toLowerCase();}
    else if(k==='contacto'){va=(fa['Contacto']||'').toLowerCase();vb=(fb['Contacto']||'').toLowerCase();}
    else if(k==='comuna'){va=(fa['Comuna']||'').toLowerCase();vb=(fb['Comuna']||'').toLowerCase();}
    else if(k==='rep'){va=parseInt(fa['Reputación'])||0;vb=parseInt(fb['Reputación'])||0;}
    else if(k==='estado'){va=(fa['Estado']||'').toLowerCase();vb=(fb['Estado']||'').toLowerCase();}
    else if(k==='plazo'){va=parseInt(fa['Plazo de entrega (días)'])||0;vb=parseInt(fb['Plazo de entrega (días)'])||0;}
    else{va='';vb='';}
    if(va<vb) return -d;if(va>vb) return d;return 0;
  });
}
function filterProveedores(){renderProveedores(true);}
function renderProveedores(skipAnalytics){
  const search=(document.getElementById('proveedorSearch')?.value||'').toLowerCase();
  const cat=document.getElementById('proveedorCatFilter')?.value||'';
  let list=state.proveedores.filter(p=>{
    const f=p.fields;
    const matchSearch=!search||(f['Nombre']||'').toLowerCase().includes(search)||(f['Contacto']||'').toLowerCase().includes(search)||(f['Email']||'').toLowerCase().includes(search)||(f['Comuna']||'').toLowerCase().includes(search)||(f['Productos']||'').toLowerCase().includes(search)||pvCat(f).toLowerCase().includes(search);
    const matchCat=!cat||pvCat(f).includes(cat);
    return matchSearch&&matchCat;
  });
  const sorted=getSortedProveedores(list);
  const count=document.getElementById('proveedoresCount');if(count) count.textContent=`${sorted.length} proveedor${sorted.length!==1?'es':''}`;
  const tbody=document.getElementById('proveedoresTableBody');if(!tbody) return;
  if(!sorted.length){tbody.innerHTML=`<tr><td colspan="11" style="text-align:center;padding:24px;color:var(--text3)">${state.proveedores.length?'Sin resultados para esta búsqueda':'Sin proveedores aún — agrega el primero ↗'}</td></tr>`;return;}
  tbody.innerHTML=sorted.map(p=>buildProveedorRow(p)).join('');
  if(!skipAnalytics) renderProveedoresAnalytics();
  try{renderMejorPrecio();}catch(e){}
  try{renderOCList();}catch(e){}
  _applySortIndicators();
}
function buildProveedorRow(p){
  const f=p.fields,id=p.id;
  const tel=(f['Teléfono']||'').replace(/\s/g,'');
  const email=f['Email']||'';
  const web=f['Sitio Web']||'';
  const telCell=tel?`<a href="tel:${tel}" onclick="event.stopPropagation()" style="font-size:13px;font-weight:600;color:#fff;text-decoration:none" title="Llamar">📞 ${escapeHtml(f['Teléfono']||'')}</a>`:'<span style="color:var(--text3)">—</span>';
  const emailCell=email?`<a href="mailto:${email}" onclick="event.stopPropagation()" style="font-size:13px;font-weight:600;color:#fff;text-decoration:none" title="Enviar correo">✉ ${escapeHtml(email)}</a>`:'<span style="color:var(--text3)">—</span>';
  const plazo=f['Plazo de entrega (días)']?`${f['Plazo de entrega (días)']} días`:'—';
  const rep=parseInt(f['Reputación'])||0;
  const starsHtml=[1,2,3,4,5].map(n=>`<span onclick="event.stopPropagation();updateRepProveedor('${id}',${n})" style="cursor:pointer;font-size:14px;color:${n<=rep?'#facc15':'var(--text3)'};line-height:1" title="${n} estrella${n>1?'s':''}" onmouseenter="highlightStars(this,${n})" onmouseleave="resetStars(this.parentElement,${rep})">★</span>`).join('');
  const starsCell=`<div style="display:flex;gap:1px;align-items:center" id="stars-${id}">${starsHtml}</div>`;
  const nombre=f['Nombre']||'';
  const pedidosActivos=state.pedidos.filter(x=>!['Despachado','Cancelado'].includes(x.fields['Estado pedido']||'')&&(x.fields['Proveedor']||'').toLowerCase()===nombre.toLowerCase());
  const pedidosTodos=state.pedidos.filter(x=>(x.fields['Proveedor']||'').toLowerCase()===nombre.toLowerCase());
  const pedCount=pedidosActivos.length;
  const pvTotalValor=pedidosTodos.reduce((s,x)=>s+(x.fields['Monto total (CLP)']||0),0);
  const pvLastOrder=pedidosTodos.map(x=>x.fields['Fecha entrega']||x.fields['Fecha ingreso']||'').filter(Boolean).sort().reverse()[0]||null;
  const estado=f['Estado']||'Activo';
  const estadoPost=f['Estado postulación']||'';
  const rowBorderStyle=estado==='Bloqueado'?';border-left:3px solid var(--danger)':estado==='Inactivo'?';border-left:3px solid rgba(255,255,255,0.1)':estadoPost==='ENTREVISTAR'?';border-left:3px solid #ffaa00':'';
  return`<tr data-id="${id}" onclick="toggleProveedorFicha('${id}')" style="cursor:pointer${rowBorderStyle}" class="${selectedProveedores.has(id)?'row-selected':''}${_flashCls(id)}">
    <td style="text-align:center" onclick="event.stopPropagation()"><input type="checkbox" class="row-chk" data-id="${id}" ${selectedProveedores.has(id)?'checked':''} onchange="toggleProveedorRow(this)" style="cursor:pointer;accent-color:var(--accent)"></td>
    <td class="pv-nombre"><div style="font-weight:600;font-size:12px">${escapeHtml(f['Nombre']||'—')}</div>${f['RUT']?`<div style="font-size:10px;color:var(--text3)">${escapeHtml(f['RUT'])}</div>`:''}${estadoPost?estadoPostPill(estadoPost):''}</td>
    <td class="pv-cat">${pvCatBadge(pvCat(f)||'—')}</td>
    <td class="pv-contacto"><div style="font-size:12px">${escapeHtml(f['Contacto']||'—')}</div>${f['Cargo']?`<div style="font-size:10px;color:var(--text3)">${escapeHtml(f['Cargo'])}</div>`:''}</td>
    <td class="pv-tel">${telCell}</td>
    <td class="pv-email">${emailCell}</td>
    <td class="pv-comuna" style="font-size:11px">${escapeHtml(f['Comuna']||'—')}</td>
    <td class="pv-rep">${starsCell}</td>
    <td class="pv-estado">${estadoPvBadge(estado)}</td>
    <td class="pv-plazo" style="font-family:'JetBrains Mono',monospace;font-size:11px">${plazo}</td>
    <td class="pv-acc" onclick="event.stopPropagation()"><button class="btn btn-ghost btn-sm" onclick="startEditProveedorFlow('${id}')" title="Editar guiado">🪄</button><button class="btn btn-ghost btn-sm" onclick="openEditProveedor('${id}')" title="Editar ficha completa"><svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#icon-edit"/></svg></button></td>
  </tr>
  <tr id="pv-ficha-${id}" style="display:none">
    <td colspan="11" style="padding:0;background:var(--surface2)">
      <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px;border-top:1px solid var(--border2);border-bottom:2px solid var(--border)">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          ${(()=>{const wa=(f['WhatsApp']||'').replace(/\s/g,'')||tel;return wa?`<a href="https://wa.me/${wa.replace(/^\+/,'').replace(/^56/,'56')}" target="_blank" onclick="event.stopPropagation()" class="btn btn-ghost btn-sm" style="color:#25d366;border-color:rgba(37,211,102,0.3);font-size:11px">💬 WhatsApp</a>`:'';})()}
          ${email?`<a href="mailto:${escapeHtml(email)}" onclick="event.stopPropagation()" class="btn btn-ghost btn-sm" style="font-size:11px">✉ Email</a>`:''}
          ${web?`<a href="${escapeHtml(web.startsWith('http')?web:'https://'+web)}" target="_blank" onclick="event.stopPropagation()" class="btn btn-ghost btn-sm" style="font-size:11px"><svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#icon-web"/></svg> Sitio web</a>`:''}
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openEditProveedor('${id}')" style="font-size:11px;margin-left:auto"><svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#icon-edit"/></svg> Editar ficha completa</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">
          ${f['Región']?`<div style="font-size:11px"><span style="color:var(--text3)">Región:</span> ${escapeHtml(f['Región'])}</div>`:''}
          ${f['Condiciones de pago']?`<div style="font-size:11px"><span style="color:var(--text3)">Pago:</span> ${escapeHtml(f['Condiciones de pago'])}</div>`:''}
          ${pvTotalValor>0?`<div style="font-size:11px"><span style="color:var(--text3)">Total pedidos:</span> <strong>${formatCLP(pvTotalValor)}</strong> (${pedidosTodos.length} orden${pedidosTodos.length!==1?'es':''})</div>`:''}
          ${pvLastOrder?`<div style="font-size:11px"><span style="color:var(--text3)">Último pedido:</span> ${escapeHtml(pvLastOrder)}</div>`:''}
          ${f['Productos']?`<div style="font-size:11px;grid-column:1/-1"><span style="color:var(--text3)">Productos:</span> ${escapeHtml(f['Productos'])}</div>`:''}
          ${f['Notas']?`<div style="font-size:11px;grid-column:1/-1;color:var(--text2);border-left:2px solid var(--border2);padding-left:8px">${formatRichText(f['Notas'])}</div>`:''}
        </div>
        <div style="border-top:1px solid var(--border2);padding-top:12px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:8px">Postulación / evaluación de proveedor</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
            <span style="font-size:11px;color:var(--text3)">Estado:</span>
            <span id="pvpostbtns-${id}" style="display:inline-flex;gap:6px;flex-wrap:wrap">${_pvPostBtns(id,estadoPost)}</span>
          </div>
          <textarea id="pvmotivo-${id}" onclick="event.stopPropagation()" placeholder="Motivo de la evaluación (por qué se aprobó o rechazó tras la entrevista)..." style="width:100%;min-height:54px;font-size:11px;background:var(--surface3);border:1px solid var(--border2);border-radius:6px;padding:8px;color:var(--text);font-family:inherit;resize:vertical">${escapeHtml(f['Motivo evaluación']||'')}</textarea>
          <div style="display:flex;justify-content:flex-end;margin-top:6px"><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();saveProvMotivo('${id}')" style="font-size:11px">Guardar motivo</button></div>
        </div>
        ${pedCount>0?`<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:6px">Pedidos activos vinculados</div><div style="display:flex;flex-direction:column;gap:4px">${pedidosActivos.map(x=>`<div style="display:flex;align-items:center;gap:8px;font-size:11px;background:var(--surface3);border-radius:5px;padding:5px 10px"><span class="mono" style="color:var(--accent)">${escapeHtml(x.fields['N° Pedido']||'—')}</span><span style="color:var(--text2)">${escapeHtml(resolveClienteName(x.fields['Cliente']))}</span><span style="color:var(--text3)">${x.fields['Estado pedido']||'—'}</span>${x.fields['Fecha entrega']?`<span style="color:var(--text3);margin-left:auto">📅 ${x.fields['Fecha entrega']}</span>`:''}</div>`).join('')}</div></div>`:''}
        <div style="border-top:1px solid var(--border2);padding-top:12px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:8px">🏷️ Historial de precios</div>
          <div id="preciosProv-${id}" onclick="event.stopPropagation()">${_preciosProvFichaHtml(nombre)}</div>
        </div>
      </div>
    </td>
  </tr>`;
}
function toggleProveedorFicha(id){
  const row=document.getElementById('pv-ficha-'+id);if(!row) return;
  const isOpen=row.style.display!=='none';
  // close all
  document.querySelectorAll('[id^="pv-ficha-"]').forEach(r=>{r.style.display='none';});
  if(!isOpen) row.style.display='';
}
function highlightStars(el,n){const wrap=el.parentElement;wrap.querySelectorAll('span').forEach((s,i)=>{s.style.color=i<n?'#facc15':'var(--text3)';});}
function resetStars(wrap,rep){wrap.querySelectorAll('span').forEach((s,i)=>{s.style.color=i<rep?'#facc15':'var(--text3)';});}
async function updateRepProveedor(id,rep){
  const p=state.proveedores.find(x=>x.id===id);if(!p) return;
  const old=p.fields['Reputación'];
  p.fields['Reputación']=rep;
  const wrap=document.getElementById('stars-'+id);
  if(wrap) resetStars(wrap,rep);
  try{
    await airtableWrite('Proveedores','PATCH',id,{'Reputación':rep});
    toast(`★ ${rep}/5 guardado`,'success');
  }catch(e){
    if(p) p.fields['Reputación']=old;
    toast('Error: '+e.message,'error');
  }
}
// ── Postulación de proveedor (Estado postulación + Motivo evaluación) ──────
function _pvPostColor(s){return s==='APROBADO'?'#00d4aa':s==='RECHAZADO'?'#ff4444':s==='ENTREVISTAR'?'#ffaa00':'#888888';}
function estadoPostPill(s){if(!s)return '';const c=_pvPostColor(s);return `<span style="display:inline-block;margin-top:3px;font-size:9px;font-weight:700;letter-spacing:0.5px;color:${c};border:1px solid ${c}55;background:${c}1a;border-radius:4px;padding:1px 6px">${s}</span>`;}
function _pvPostBtns(id,current){
  return [['ENTREVISTAR','#ffaa00'],['APROBADO','#00d4aa'],['RECHAZADO','#ff4444']].map(([s,col])=>{
    const on=current===s;
    return `<button class="btn btn-sm" onclick="event.stopPropagation();setProvEstadoPost('${id}','${s}')" style="font-size:10px;font-weight:700;letter-spacing:0.3px;border:1px solid ${on?col:'var(--border2)'};color:${on?'#0a0a0a':col};background:${on?col:'transparent'};border-radius:6px;padding:4px 10px;cursor:pointer">${s}</button>`;
  }).join('');
}
async function setProvEstadoPost(id,estado){
  const p=state.proveedores.find(x=>x.id===id);if(!p)return;
  const old=p.fields['Estado postulación']||'';
  p.fields['Estado postulación']=estado;
  const cont=document.getElementById('pvpostbtns-'+id);if(cont)cont.innerHTML=_pvPostBtns(id,estado);
  try{
    await airtableWrite('Proveedores','PATCH',id,{'Estado postulación':estado});
    toast('Postulación → '+estado,'success');
  }catch(e){
    p.fields['Estado postulación']=old;
    const c2=document.getElementById('pvpostbtns-'+id);if(c2)c2.innerHTML=_pvPostBtns(id,old);
    toast('Error: '+e.message,'error');
  }
}
async function saveProvMotivo(id){
  const p=state.proveedores.find(x=>x.id===id);if(!p)return;
  const el=document.getElementById('pvmotivo-'+id);if(!el)return;
  const val=el.value.trim();const old=p.fields['Motivo evaluación']||'';
  if(val===old){toast('Sin cambios','info');return;}
  p.fields['Motivo evaluación']=val;
  try{
    await airtableWrite('Proveedores','PATCH',id,{'Motivo evaluación':val});
    toast('Motivo guardado','success');
  }catch(e){
    p.fields['Motivo evaluación']=old;
    toast('Error: '+e.message,'error');
  }
}
async function createProveedor(){
  const nombre=(document.getElementById('np-nombre')?.value||'').trim();
  const categorias=getPvSelectedCats('np');
  if(!nombre){toast('Nombre requerido','error');return;}
  if(!categorias.length){toast('Selecciona al menos una categoría','error');return;}
  const pvEmail=(document.getElementById('np-email')?.value||'').trim();
  const pvTel=(document.getElementById('np-telefono')?.value||'').trim();
  const pvRutEl=document.getElementById('np-rut');const pvRut=(pvRutEl?.value||'').trim();
  if(pvEmail&&!validEmail(pvEmail)){toast('Email inválido','error');return;}
  if(pvTel&&!validPhone(pvTel)){toast('Teléfono inválido (8–12 dígitos)','error');return;}
  if(pvRut&&!validRUT(pvRut)){toast('RUT inválido — revisa el dígito verificador','error');return;}
  if(pvRut&&pvRutEl) pvRutEl.value=formatRUT(pvRut);
  const btn=document.getElementById('createProveedorBtn');btn.disabled=true;btn.textContent='Guardando...';
  const fields={
    'Nombre':nombre,
    'Categoría':categorias,
    'Contacto':document.getElementById('np-contacto')?.value||'',
    'Cargo':document.getElementById('np-cargo')?.value||'',
    'Teléfono':document.getElementById('np-telefono')?.value||'',
    'WhatsApp':document.getElementById('np-whatsapp')?.value||'',
    'Email':document.getElementById('np-email')?.value||'',
    'Sitio Web':document.getElementById('np-web')?.value||'',
    'RUT':document.getElementById('np-rut')?.value||'',
    'Comuna':document.getElementById('np-comuna')?.value||'',
    'Región':document.getElementById('np-region')?.value||'',
    'Reputación':parseInt(document.getElementById('np-rep')?.value)||null,
    'Estado':document.getElementById('np-estado')?.value||'Activo',
    'Condiciones de pago':document.getElementById('np-condpago')?.value||'',
    'Plazo de entrega (días)':parseInt(document.getElementById('np-plazo')?.value)||null,
    'Productos':document.getElementById('np-productos')?.value||'',
    'Notas':document.getElementById('np-notas')?.value||''
  };
  Object.keys(fields).forEach(k=>{if(fields[k]===null||fields[k]==='') delete fields[k];});
  const refresh=async()=>{const pvRes=await airtableFetch('Proveedores',500);state.proveedores=pvRes.records||[];renderProveedores();};
  try{
    await airtableWrite('Proveedores','POST',null,fields);
    toast(`✓ "${nombre}" creado`,'success');clearForm('proveedor');switchTab('proveedores');await refresh();
  }catch(e){
    // Retry with only safe fields to isolate if it's a field-name mismatch vs permissions
    const safeFields={'Nombre':fields['Nombre'],'Categoría':fields['Categoría']};
    if(fields['Contacto']) safeFields['Contacto']=fields['Contacto'];
    if(fields['Estado']) safeFields['Estado']=fields['Estado'];
    try{
      await airtableWrite('Proveedores','POST',null,safeFields);
      toast(`✓ "${nombre}" creado (algunos campos no existen aún en Airtable: ${Object.keys(fields).filter(k=>!safeFields[k]).join(', ')})`,'success');
      clearForm('proveedor');switchTab('proveedores');await refresh();
    }catch(e2){
      const isPermission=e2.message.includes('403')||e2.message.includes('permissions')||e2.message.includes('model not found');
      if(isPermission) toast(`🔑 Error escritura (${e2.message}) — abre el 🔑 modal → "Probar escritura" para diagnosticar`,'error');
      else toast(`Error: ${e2.message}`,'error');
    }
  }
  btn.disabled=false;btn.textContent='✚ Crear Proveedor';
}
function openEditProveedor(id){
  const p=state.proveedores.find(x=>x.id===id);if(!p) return;
  const f=p.fields;
  document.getElementById('epId').value=id;
  document.getElementById('epNombre').value=f['Nombre']||'';
  const existCats=Array.isArray(f['Categoría'])?f['Categoría'].map(x=>x.name||x):(f['Categoría']?[String(f['Categoría'])]:[]);
  setPvSelectedCats('ep',existCats);
  document.getElementById('epContacto').value=f['Contacto']||'';
  document.getElementById('epCargo').value=f['Cargo']||'';
  document.getElementById('epTelefono').value=f['Teléfono']||'';
  document.getElementById('epWhatsapp').value=f['WhatsApp']||'';
  document.getElementById('epEmail').value=f['Email']||'';
  document.getElementById('epWeb').value=f['Sitio Web']||'';
  document.getElementById('epRut').value=f['RUT']||'';
  document.getElementById('epComuna').value=f['Comuna']||'';
  document.getElementById('epRegion').value=f['Región']||'';
  document.getElementById('epRep').value=f['Reputación']||'';
  document.getElementById('epEstado').value=f['Estado']||'Activo';
  document.getElementById('epCondPago').value=f['Condiciones de pago']||'';
  document.getElementById('epPlazo').value=f['Plazo de entrega (días)']||'';
  document.getElementById('epProductos').value=f['Productos']||'';
  document.getElementById('epNotas').value=f['Notas']||'';
  document.getElementById('editProveedorModal').style.display='flex';
}
function closeEditProveedor(){document.getElementById('editProveedorModal').style.display='none';}
async function saveEditProveedor(){
  const id=document.getElementById('epId').value;if(!id) return;
  const nombre=(document.getElementById('epNombre').value||'').trim();
  if(!nombre){toast('Nombre requerido','error');return;}
  if(!getPvSelectedCats('ep').length){toast('Selecciona al menos una categoría','error');return;}
  const epEmail=(document.getElementById('epEmail').value||'').trim();
  const epTel=(document.getElementById('epTelefono').value||'').trim();
  const epRutEl=document.getElementById('epRut');const epRut=(epRutEl?.value||'').trim();
  if(epEmail&&!validEmail(epEmail)){toast('Email inválido','error');return;}
  if(epTel&&!validPhone(epTel)){toast('Teléfono inválido (8–12 dígitos)','error');return;}
  if(epRut&&!validRUT(epRut)){toast('RUT inválido — revisa el dígito verificador','error');return;}
  if(epRut&&epRutEl) epRutEl.value=formatRUT(epRut);
  const btn=document.getElementById('epGuardarBtn');btn.disabled=true;btn.textContent='Guardando...';
  const fields={
    'Nombre':nombre,
    'Categoría':getPvSelectedCats('ep'),
    'Contacto':document.getElementById('epContacto').value||'',
    'Cargo':document.getElementById('epCargo').value||'',
    'Teléfono':document.getElementById('epTelefono').value||'',
    'WhatsApp':document.getElementById('epWhatsapp').value||'',
    'Email':document.getElementById('epEmail').value||'',
    'Sitio Web':document.getElementById('epWeb').value||'',
    'RUT':document.getElementById('epRut').value||'',
    'Comuna':document.getElementById('epComuna').value||'',
    'Región':document.getElementById('epRegion').value||'',
    'Reputación':parseInt(document.getElementById('epRep').value)||null,
    'Estado':document.getElementById('epEstado').value||'Activo',
    'Condiciones de pago':document.getElementById('epCondPago').value||'',
    'Plazo de entrega (días)':parseInt(document.getElementById('epPlazo').value)||null,
    'Productos':document.getElementById('epProductos').value||'',
    'Notas':document.getElementById('epNotas').value||''
  };
  Object.keys(fields).forEach(k=>{if(fields[k]===null||fields[k]==='') delete fields[k];});
  try{
    await airtableWrite('Proveedores','PATCH',id,fields);
    const p=state.proveedores.find(x=>x.id===id);
    if(p) p.fields={...p.fields,...fields};
    toast('✓ Proveedor actualizado','success');
    closeEditProveedor();
    renderProveedores();
  }catch(e){
    const isPermission=e.message.includes('permissions')||e.message.includes('model not found')||e.message.includes('403');
    if(isPermission) toast('🔑 Token sin permiso de escritura — ve a Airtable → Developer Hub → Tokens y agrega "data:records:write"','error');
    else toast('Error: '+e.message,'error');
  }
  btn.disabled=false;btn.textContent='💾 Guardar cambios';
}
// ── PROVEEDORES MULTI-SELECT ──────────────────────────────────
function toggleProveedorRow(chk){const id=chk.dataset.id;if(chk.checked) selectedProveedores.add(id);else selectedProveedores.delete(id);chk.closest('tr')?.classList.toggle('row-selected',chk.checked);updateProveedoresBulkBar();}
function toggleSelectAllProveedores(chk){document.querySelectorAll('#proveedoresTableBody .row-chk').forEach(c=>{c.checked=chk.checked;if(chk.checked) selectedProveedores.add(c.dataset.id);else selectedProveedores.delete(c.dataset.id);c.closest('tr')?.classList.toggle('row-selected',chk.checked);});updateProveedoresBulkBar();}
function updateProveedoresBulkBar(){
  const n=selectedProveedores.size;
  const bar=document.getElementById('proveedoresBulkBar');if(bar) bar.style.display=n>0?'flex':'none';
  const cnt=document.getElementById('proveedoresBulkCount');if(cnt) cnt.textContent=`${n} seleccionado${n!==1?'s':''}`;
  const sa=document.getElementById('proveedoresSelectAll');if(sa){const all=document.querySelectorAll('#proveedoresTableBody .row-chk');sa.checked=all.length>0&&n===all.length;sa.indeterminate=n>0&&n<all.length;}
}
function clearProveedoresSelection(){selectedProveedores.clear();document.querySelectorAll('#proveedoresTableBody .row-chk').forEach(c=>{c.checked=false;c.closest('tr')?.classList.remove('row-selected');});const sa=document.getElementById('proveedoresSelectAll');if(sa){sa.checked=false;sa.indeterminate=false;}updateProveedoresBulkBar();}
async function bulkDeleteProveedores(){
  const ids=[...selectedProveedores];if(!ids.length) return;
  const nombres=ids.map(id=>state.proveedores.find(p=>p.id===id)?.fields['Nombre']||id).join(', ');
  if(!confirm(`¿Eliminar ${ids.length} proveedor${ids.length!==1?'es':''}?\n${nombres}`)) return;
  let ok=0,err=0;
  for(const id of ids){
    try{
      const rec=state.proveedores.find(x=>x.id===id);
      await airtableDelete('Proveedores',id);
      state.proveedores=state.proveedores.filter(x=>x.id!==id);
      selectedProveedores.delete(id);ok++;
    }catch(e){err++;}
  }
  err?toast(`${ok} eliminados, ${err} con error`,'info'):toast(`✓ ${ok} proveedor${ok!==1?'es':''} eliminados`,'success');
  clearProveedoresSelection();renderProveedores();
}
async function bulkEditProveedorEstado(){
  const estado=document.getElementById('proveedoresBulkEstado')?.value;if(!estado){toast('Selecciona un estado primero','error');return;}
  const ids=[...selectedProveedores];if(!ids.length) return;
  if(!confirm(`¿Cambiar estado a "${estado}" para ${ids.length} proveedor${ids.length!==1?'es':''}?`)) return;
  let ok=0,err=0;
  for(const id of ids){
    try{await airtableWrite('Proveedores','PATCH',id,{'Estado':estado});const p=state.proveedores.find(x=>x.id===id);if(p) p.fields['Estado']=estado;ok++;}
    catch(e){err++;}
  }
  document.getElementById('proveedoresBulkEstado').value='';
  err?toast(`${ok} actualizados, ${err} con error`,'info'):toast(`✓ ${ok} proveedor${ok!==1?'es':''} → "${estado}"`,'success');
  clearProveedoresSelection();renderProveedores();
}
async function deleteProveedor(id,nombre){
  if(!confirm(`¿Eliminar proveedor "${nombre}"?`)) return;
  const rec=state.proveedores.find(x=>x.id===id);
  const snapshot=rec?sanitizeForRestore(rec.fields):null;
  try{
    await airtableDelete('Proveedores',id);
    state.proveedores=state.proveedores.filter(x=>x.id!==id);
    closeEditProveedor();
    renderProveedores();
    toastUndo(`Proveedor "${nombre}" eliminado`,async()=>{
      try{const r=await airtableWrite('Proveedores','POST',null,snapshot);if(r&&r.id) state.proveedores.push(r);renderProveedores();toast(`✓ "${nombre}" restaurado`,'success');}
      catch(e){toast('No se pudo restaurar: '+e.message,'error');}
    });
  }catch(e){toast('Error: '+e.message,'error');}
}

// ── Móvil: convierte tablas en tarjetas auto-etiquetando cada celda ──
function applyTableLabels(table){
  const heads=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
  if(!heads.length) return;
  table.querySelectorAll('tbody > tr').forEach(tr=>{
    if(tr.children.length<=1) return;// filas de estado vacío / loading
    [...tr.children].forEach((td,i)=>{if(heads[i]&&!td.hasAttribute('data-label')) td.setAttribute('data-label',heads[i]);});
  });
}
function initMobileTableLabels(){
  document.querySelectorAll('.table-wrap table').forEach(t=>{
    applyTableLabels(t);
    const tb=t.querySelector('tbody');
    if(tb&&!tb._labeled){tb._labeled=true;new MutationObserver(()=>applyTableLabels(t)).observe(tb,{childList:true});}
  });
}
function addBusinessDays(date,days){const d=new Date(date);let added=0;while(added<days){d.setDate(d.getDate()+1);const day=d.getDay();if(day!==0&&day!==6) added++;}return d;}
function updateVtoPreview(){const fi=document.getElementById('cot-fecha');const prev=document.getElementById('cot-vto-preview');if(!fi||!prev) return;const base=fi.value?new Date(fi.value+'T00:00:00'):new Date();prev.value=addBusinessDays(base,10).toISOString().split('T')[0];}
function initDates(){
  const today=new Date().toISOString().split('T')[0];
  const fi=document.getElementById('cot-fecha'),cn=document.getElementById('cot-num');
  if(fi&&!fi.value) fi.value=today;
  updateVtoPreview();
  if(cn) cn.value=generarNumeroCotizacion();
  const container=document.getElementById('itemsContainer');if(container&&!container.children.length) initItemsContainer();
}
function exportToCSV(t){
  let rows=[],headers=[];
  if(t==='clientes'){headers=['Empresa','Contacto','Email','Teléfono','Etapa','Revenue','Estado','Fact.venc.'];let _cd=(typeof getSortedClientes==='function')?getSortedClientes():state.clientes;if(typeof _cliQuery!=='undefined'&&_cliQuery)_cd=_cd.filter(c=>_rowText(buildClienteRow(c)).includes(_cliQuery));rows=_cd.map(c=>{const f=c.fields;return[f['Empresa']||'',f['Contacto']||'',f['Email']||'',f['Teléfono']||'',f['Etapa venta']||'',f['Revenue total cliente (CLP)']||0,f['Estado cuenta']||'',f['Facturas vencidas']||0];});}
  else if(t==='cotizaciones'){headers=['N°','Cliente','Canal','Subtotal','Total','Urgente','Estado','Vto.'];rows=((typeof getSortedCotizaciones==='function')?getSortedCotizaciones():state.cotizaciones).map(c=>{const f=c.fields;return[f['N° Cotización']||'',resolveClienteName(f['Cliente']),f['Canal solicitud']||'',f['Subtotal (CLP)']||0,f['Total final (CLP)']||0,f['Urgencia (+25%)']?'Sí':'No',f['Estado cotización']||'',f['Fecha vencimiento']||''];});}
  else if(t==='pedidos'){headers=['N°','Cliente','Estado','Proveedor','Monto','Forma de Pago','Anticipo 50%','Saldo 50%','QA','Entrega'];rows=state.pedidos.map(p=>{const f=p.fields;return[f['N° Pedido']||'',resolveClienteName(f['Cliente']),f['Estado pedido']||'',f['Proveedor']||'',f['Monto total (CLP)']||0,f['Forma de pago']||'',f['Anticipo pagado (50%)']?'Sí':'No',f['Saldo pagado (50%)']?'Sí':'No',f['Resultado QA']||'',f['Fecha entrega']||''];});}
  else if(t==='proveedores'){headers=['Nombre','Categoría','Contacto','Teléfono','Email','Comuna','Reputación','Estado','Plazo (días)','Condiciones pago','Productos','Notas'];rows=state.proveedores.map(p=>{const f=p.fields;return[f['Nombre']||'',pvCat(f),f['Contacto']||'',f['Teléfono']||'',f['Email']||'',f['Comuna']||'',f['Reputación']||'',f['Estado']||'',f['Plazo de entrega (días)']||'',f['Condiciones de pago']||'',f['Productos']||'',f['Notas']||''];});}
  else{toast('Tipo desconocido','error');return;}
  if(!rows.length){toast('Sin datos','error');return;}
  const csv=[headers.join(','),...rows.map(r=>r.map(v=>{const s=String(v).replace(/"/g,'""');return/[",\n]/.test(s)?`"${s}"`:s;}).join(','))].join('\n');
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${t}-${new Date().toISOString().split('T')[0]}.csv`;a.click();URL.revokeObjectURL(url);toast(`✓ ${t}.csv descargado`,'success');
}

// ── HISTORIAL DE PRECIOS DE PROVEEDORES (N5) ──────────────────────────
// Registro compartido de cotizaciones/precios por proveedor e ítem, para
// comparar y elegir el mejor precio por ítem. localStorage + respaldo en
// Airtable (Monitor Sistema · PRECIOS_PROV) para sobrevivir a limpiar caché.
const _PRECIOS_PROV_KEY='thelab_precios_prov_v1';
function _preciosProv(){try{return JSON.parse(localStorage.getItem(_PRECIOS_PROV_KEY)||'[]');}catch(e){return[];}}
function _preciosProvSaveArr(arr){try{localStorage.setItem(_PRECIOS_PROV_KEY,JSON.stringify(arr||[]));}catch(e){}_preciosProvBackup();}
async function _preciosProvBackup(){
  try{
    const notes=localStorage.getItem(_PRECIOS_PROV_KEY)||'[]';
    if(state.preciosProvRecordId) await airtableWrite('Monitor Sistema','PATCH',state.preciosProvRecordId,{'Notes':notes});
    else{const r=await airtableWrite('Monitor Sistema','POST',null,{'Name':'PRECIOS_PROV','Notes':notes});if(r&&r.id)state.preciosProvRecordId=r.id;}
  }catch(e){}
}
// Normaliza el nombre de ítem para agrupar (minúsculas, sin tildes ni espacios extra)
function _normItem(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim();}
function _preciosDeProv(prov){
  const k=String(prov||'').toLowerCase();
  return _preciosProv().filter(p=>String(p.prov||'').toLowerCase()===k).sort((a,b)=>_normItem(a.item).localeCompare(_normItem(b.item))||String(b.fecha||'').localeCompare(String(a.fecha||'')));
}
function addPrecioProv(prov){
  const nombre=String(prov||'').trim();
  const item=(prompt('Ítem o material cotizado (ej: PLA 1kg negro, Impresión A3, Corte láser MDF 3mm):')||'').trim();
  if(!item)return;
  const precioRaw=prompt('Precio unitario cotizado (CLP, sin IVA):','');if(precioRaw==null)return;
  const precio=Math.round(parseFloat(String(precioRaw).replace(/[^\d.-]/g,''))||0);
  if(!(precio>0)){toast('Precio inválido','error');return;}
  const unidad=(prompt('Unidad (ej: kg, unidad, m², hora):','unidad')||'').trim()||'unidad';
  const hoyISO=new Date().toISOString().slice(0,10);
  const fecha=(prompt('Fecha de la cotización (AAAA-MM-DD):',hoyISO)||'').trim()||hoyISO;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(fecha)){toast('Fecha inválida (AAAA-MM-DD)','error');return;}
  const nota=(prompt('Nota opcional (condición, mínimo de compra, etc.):','')||'').trim();
  const p=(state.proveedores||[]).find(x=>String(x.fields['Nombre']||'').toLowerCase()===nombre.toLowerCase());
  const cat=p?pvCat(p.fields):'';
  const arr=_preciosProv();
  arr.push({id:'pp'+arr.length+'_'+item.length+'_'+precio,prov:nombre,cat,item,precio,unidad,fecha,nota});
  _preciosProvSaveArr(arr);
  toast('✓ Precio registrado','success');
  try{renderProveedores();}catch(e){}
  const box=document.getElementById('preciosProv-'+(p?p.id:''));
  if(p) try{const b=document.getElementById('preciosProv-'+p.id);if(b)b.innerHTML=_preciosProvFichaHtml(nombre);}catch(e){}
}
function delPrecioProv(id){
  const arr=_preciosProv();const rec=arr.find(x=>x.id===id);
  _preciosProvSaveArr(arr.filter(x=>x.id!==id));
  try{renderProveedores();}catch(e){}
  if(rec){const p=(state.proveedores||[]).find(x=>String(x.fields['Nombre']||'').toLowerCase()===String(rec.prov||'').toLowerCase());if(p){const b=document.getElementById('preciosProv-'+p.id);if(b)b.innerHTML=_preciosProvFichaHtml(rec.prov);}}
}
// HTML del historial de precios de un proveedor (con tendencia vs. registro anterior del mismo ítem)
function _preciosProvFichaHtml(prov){
  const list=_preciosDeProv(prov);
  const add=`<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();addPrecioProv('${escapeHtml(prov).replace(/'/g,"\\'")}')" style="font-size:11px">＋ Registrar precio</button>`;
  if(!list.length) return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-size:11px;color:var(--text3)">Sin precios registrados para este proveedor.</span>${add}</div>`;
  // mejor precio por ítem (global) para marcar cuándo este proveedor es el más barato
  const best=_mejorPrecioPorItem();
  const rows=list.map(p=>{
    // tendencia: precio anterior del MISMO ítem de este proveedor
    const mismos=list.filter(x=>_normItem(x.item)===_normItem(p.item)).sort((a,b)=>String(a.fecha||'').localeCompare(String(b.fecha||'')));
    const idx=mismos.findIndex(x=>x.id===p.id);const prev=idx>0?mismos[idx-1]:null;
    let trend='';
    if(prev){const d=p.precio-prev.precio;if(d>0)trend=`<span style="color:var(--danger);font-size:10px" title="Subió desde ${formatCLP(prev.precio)}">▲ ${formatCLP(Math.abs(d))}</span>`;else if(d<0)trend=`<span style="color:var(--accent3);font-size:10px" title="Bajó desde ${formatCLP(prev.precio)}">▼ ${formatCLP(Math.abs(d))}</span>`;else trend=`<span style="color:var(--text3);font-size:10px">=</span>`;}
    const b=best[_normItem(p.item)];
    const esMejor=b&&b.prov.toLowerCase()===String(prov).toLowerCase()&&b.precio===p.precio;
    return `<div style="display:flex;align-items:center;gap:8px;font-size:11px;background:var(--surface3);border-radius:5px;padding:6px 10px">
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.item)}${esMejor?' <span class="badge badge-green" style="font-size:8px" title="Mejor precio registrado para este ítem">mejor precio</span>':''}${p.nota?` <span style="color:var(--text3)" title="${escapeHtml(p.nota)}">🛈</span>`:''}</span>
      <span style="color:var(--text3);flex-shrink:0">${escapeHtml(p.fecha||'')}</span>
      ${trend}
      <span style="font-weight:700;color:var(--text1);flex-shrink:0">${formatCLP(p.precio)}<span style="color:var(--text3);font-weight:400;font-size:9px">/${escapeHtml(p.unidad||'u')}</span></span>
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0;padding:1px 7px" onclick="event.stopPropagation();delPrecioProv('${p.id}')" title="Eliminar">✕</button>
    </div>`;
  }).join('');
  return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px"><span style="font-size:10px;color:var(--text3)">${list.length} registro${list.length!==1?'s':''}</span>${add}</div><div style="display:flex;flex-direction:column;gap:4px">${rows}</div>`;
}
// Mejor precio por ítem entre TODOS los proveedores (mapa normItem → {prov,precio,unidad,fecha,item})
function _mejorPrecioPorItem(){
  const best={};
  _preciosProv().forEach(p=>{
    const k=_normItem(p.item);if(!k)return;
    if(!best[k]||p.precio<best[k].precio) best[k]={prov:p.prov,precio:p.precio,unidad:p.unidad,fecha:p.fecha,item:p.item};
  });
  return best;
}
// Panel comparativo: por cada ítem con 2+ proveedores, muestra el más barato y el ahorro vs. el más caro.
function renderMejorPrecio(){
  const el=document.getElementById('mejorPrecioProv');if(!el)return;
  const all=_preciosProv();
  if(!all.length){el.innerHTML='';return;}
  const byItem={};
  all.forEach(p=>{const k=_normItem(p.item);if(!k)return;(byItem[k]=byItem[k]||{item:p.item,ofertas:[]}).ofertas.push(p);});
  // último precio por proveedor por ítem (no acumular históricos del mismo proveedor)
  const filas=Object.values(byItem).map(g=>{
    const ultimoPorProv={};
    g.ofertas.forEach(o=>{const kp=String(o.prov||'').toLowerCase();if(!ultimoPorProv[kp]||String(o.fecha||'')>String(ultimoPorProv[kp].fecha||''))ultimoPorProv[kp]=o;});
    const ofs=Object.values(ultimoPorProv).sort((a,b)=>a.precio-b.precio);
    return {item:g.item,ofs};
  }).filter(f=>f.ofs.length>=2).sort((a,b)=>b.ofs.length-a.ofs.length);
  if(!filas.length){el.innerHTML='';return;}
  const rows=filas.map(f=>{
    const min=f.ofs[0],max=f.ofs[f.ofs.length-1];
    const ahorro=max.precio-min.precio;const pct=max.precio?Math.round(ahorro/max.precio*100):0;
    const chips=f.ofs.map((o,i)=>`<span class="badge ${i===0?'badge-green':'badge-gray'}" style="font-size:9px" title="${escapeHtml(o.fecha||'')}">${escapeHtml(o.prov||'—')}: ${formatCLP(o.precio)}</span>`).join(' ');
    return `<div style="padding:9px 14px;border-top:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="flex:1;min-width:0;font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.item)}</span>
        ${ahorro>0?`<span style="font-size:10.5px;color:var(--accent3)" title="Ahorro del más barato frente al más caro">ahorro hasta ${formatCLP(ahorro)} (${pct}%)</span>`:''}
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap">${chips}</div>
    </div>`;
  }).join('');
  el.innerHTML=`<div class="card" style="margin-top:16px"><div class="card-header"><span class="card-title">🏷️ Mejor precio por ítem</span><span style="margin-left:auto;font-size:10.5px;color:var(--text3)">${filas.length} ítem${filas.length!==1?'s':''} con 2+ proveedores</span></div><div style="padding:2px 0 8px">${rows}</div></div>`;
}

// ── ÓRDENES DE COMPRA A PROVEEDORES (Q6) ───────────────────────────────
// Genera órdenes de compra formales a un proveedor con ítems, totales (IVA),
// PDF imprimible y envío. Reutiliza los precios registrados (N5) como ayuda.
const _OC_KEY='thelab_oc_v1';
function _ocAll(){try{return JSON.parse(localStorage.getItem(_OC_KEY)||'[]');}catch(e){return[];}}
function _ocSaveArr(arr){try{localStorage.setItem(_OC_KEY,JSON.stringify(arr||[]));}catch(e){}_ocBackup();}
async function _ocBackup(){
  try{const notes=localStorage.getItem(_OC_KEY)||'[]';
    if(state.ocRecordId) await airtableWrite('Monitor Sistema','PATCH',state.ocRecordId,{'Notes':notes});
    else{const r=await airtableWrite('Monitor Sistema','POST',null,{'Name':'ORDENES_COMPRA','Notes':notes});if(r&&r.id)state.ocRecordId=r.id;}
  }catch(e){}
}
function _ocNextNum(){const y=new Date().getFullYear();let mx=0;_ocAll().forEach(o=>{const m=String(o.numero||'').match(new RegExp('OC-'+y+'-(\\d+)'));if(m)mx=Math.max(mx,parseInt(m[1]));});return `OC-${y}-${String(mx+1).padStart(3,'0')}`;}
function openOCModal(provNombre,ocId){
  const sel=document.getElementById('ocProveedor');
  const provs=(state.proveedores||[]).slice().sort((a,b)=>String(a.fields['Nombre']||'').localeCompare(String(b.fields['Nombre']||'')));
  sel.innerHTML='<option value="">— Selecciona proveedor —</option>'+provs.map(p=>`<option value="${escapeHtml(p.fields['Nombre']||'')}">${escapeHtml(p.fields['Nombre']||'')}</option>`).join('');
  document.getElementById('ocRows').innerHTML='';
  document.getElementById('ocId').value=ocId||'';
  const oc=ocId?_ocAll().find(x=>x.id===ocId):null;
  if(oc){sel.value=oc.proveedor||'';document.getElementById('ocFecha').value=oc.fecha||new Date().toISOString().slice(0,10);document.getElementById('ocNotas').value=oc.notas||'';(oc.items||[]).forEach(it=>ocAddRow(it));}
  else{sel.value=provNombre||'';document.getElementById('ocFecha').value=new Date().toISOString().slice(0,10);document.getElementById('ocNotas').value='';ocAddRow();}
  ocProveedorChanged();ocCalc();
  document.getElementById('ocModal').style.display='flex';
}
function closeOCModal(){document.getElementById('ocModal').style.display='none';}
function ocProveedorChanged(){
  const prov=document.getElementById('ocProveedor').value;
  const hint=document.getElementById('ocPreciosHint');if(!hint)return;
  let n=0;try{n=(typeof _preciosDeProv==='function'&&prov)?_preciosDeProv(prov).length:0;}catch(e){}
  hint.textContent=n?`· ${n} precio(s) registrados de este proveedor`:'';
}
function ocAddRow(data){
  const cont=document.getElementById('ocRows');const row=document.createElement('div');row.className='oc-row';
  row.style.cssText='display:grid;grid-template-columns:1fr 70px 110px 90px 30px;gap:6px;align-items:center';
  const inp='background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px;padding:6px 8px;width:100%;box-sizing:border-box;font-family:inherit';
  row.innerHTML=`<input class="oc-item" placeholder="Material / ítem" value="${escapeHtml(data?.item||'')}" style="${inp}" oninput="ocCalc()">
    <input class="oc-cant" type="number" min="0" step="0.5" placeholder="Cant." value="${data?.cantidad||''}" style="${inp};text-align:center" oninput="ocCalc()">
    <input class="oc-precio" type="number" min="0" placeholder="Precio unit." value="${data?.precio||''}" style="${inp};text-align:right" oninput="ocCalc()">
    <span class="oc-sub" style="font-size:11px;font-family:'JetBrains Mono',monospace;text-align:right;color:var(--text2)">$0</span>
    <button class="btn btn-ghost btn-sm" style="padding:2px 6px;color:var(--danger)" onclick="this.closest('.oc-row').remove();ocCalc()">✕</button>`;
  cont.appendChild(row);
  // Autocompletar precio desde N5 al escribir el ítem (si coincide y el precio está vacío)
  const itemInp=row.querySelector('.oc-item'),precioInp=row.querySelector('.oc-precio');
  itemInp.addEventListener('change',()=>{
    if(precioInp.value)return;const prov=document.getElementById('ocProveedor').value;if(!prov||typeof _preciosDeProv!=='function')return;
    try{const q=_normItem(itemInp.value);const hit=_preciosDeProv(prov).find(p=>_normItem(p.item)===q||_normItem(p.item).includes(q)||q.includes(_normItem(p.item)));if(hit){precioInp.value=hit.precio;ocCalc();}}catch(e){}
  });
  ocCalc();
}
function _ocRows(){return [...document.querySelectorAll('#ocRows .oc-row')].map(r=>({item:(r.querySelector('.oc-item').value||'').trim(),cantidad:parseFloat(r.querySelector('.oc-cant').value)||0,precio:Math.round(parseFloat(r.querySelector('.oc-precio').value)||0),_el:r})).filter(x=>x.item||x.cantidad||x.precio);}
function ocCalc(){
  let neto=0;
  document.querySelectorAll('#ocRows .oc-row').forEach(r=>{const c=parseFloat(r.querySelector('.oc-cant').value)||0,p=parseFloat(r.querySelector('.oc-precio').value)||0;const sub=Math.round(c*p);neto+=sub;const s=r.querySelector('.oc-sub');if(s)s.textContent=formatCLP(sub);});
  const iva=Math.round(neto*0.19);
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=formatCLP(v);};
  set('ocNeto',neto);set('ocIva',iva);set('ocTotal',neto+iva);
  return {neto,iva,total:neto+iva};
}
function guardarOC(conPDF){
  const proveedor=document.getElementById('ocProveedor').value;
  if(!proveedor){toast('Selecciona un proveedor','error');return;}
  const items=_ocRows().filter(x=>x.item&&x.cantidad>0).map(x=>({item:x.item,cantidad:x.cantidad,precio:x.precio}));
  if(!items.length){toast('Agrega al menos un ítem con cantidad','error');return;}
  const t=ocCalc();
  const arr=_ocAll();const id=document.getElementById('ocId').value;
  let oc;
  const base={proveedor,fecha:document.getElementById('ocFecha').value||new Date().toISOString().slice(0,10),notas:(document.getElementById('ocNotas').value||'').trim(),items,neto:t.neto,total:t.total,estado:'Emitida'};
  if(id){oc=arr.find(x=>x.id===id);if(oc)Object.assign(oc,base);}
  else{oc={id:'oc'+Date.now()+'_'+arr.length,numero:_ocNextNum(),ts:Date.now(),...base};arr.push(oc);}
  _ocSaveArr(arr);closeOCModal();toast(`✓ Orden de compra ${oc.numero} guardada`,'success');
  try{renderOCList();}catch(e){}
  if(conPDF) try{generarOCPDF(oc.id);}catch(e){}
}
function delOC(id){if(!confirm('¿Eliminar esta orden de compra?'))return;_ocSaveArr(_ocAll().filter(x=>x.id!==id));renderOCList();}
function generarOCPDF(id){
  const oc=_ocAll().find(x=>x.id===id);if(!oc){toast('OC no encontrada','error');return;}
  const esc=s=>escapeHtml(String(s==null?'':s));const clp=n=>formatCLP(Math.round(n||0));
  const pv=(state.proveedores||[]).find(p=>String(p.fields['Nombre']||'')===oc.proveedor);
  const rows=(oc.items||[]).map(it=>`<tr><td style="padding:7px 10px;border-bottom:1px solid #f0f0f3">${esc(it.item)}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f3;text-align:center">${it.cantidad}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f3;text-align:right">${clp(it.precio)}</td><td style="padding:7px 10px;border-bottom:1px solid #f0f0f3;text-align:right">${clp(it.cantidad*it.precio)}</td></tr>`).join('');
  const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(oc.numero)} — ${esc(oc.proveedor)}</title>
<style>@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font-family:-apple-system,system-ui,'Segoe UI',Arial,sans-serif;color:#111;margin:0}</style></head><body>
<div style="max-width:720px;margin:0 auto">
  <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #00b3a4;padding-bottom:12px;margin-bottom:18px">
    <div><div style="font-size:11px;letter-spacing:.2em;color:#8a8a92;text-transform:uppercase">The Lab Solutions</div><div style="font-size:24px;font-weight:800;margin-top:4px">Orden de compra</div></div>
    <div style="text-align:right"><div style="font-size:16px;font-weight:800;color:#00947f">${esc(oc.numero)}</div><div style="font-size:11px;color:#8a8a92">${esc(oc.fecha)}</div></div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-bottom:16px;font-size:13px">
    <div><div style="font-size:10px;color:#8a8a92;text-transform:uppercase">Proveedor</div><div style="font-weight:700;font-size:15px">${esc(oc.proveedor)}</div>${pv&&pv.fields['Email']?`<div style="color:#555">${esc(pv.fields['Email'])}</div>`:''}${pv&&pv.fields['Teléfono']?`<div style="color:#555">${esc(pv.fields['Teléfono'])}</div>`:''}</div>
    <div style="text-align:right"><div style="font-size:10px;color:#8a8a92;text-transform:uppercase">Comprador</div><div style="font-weight:700">The Lab Solutions</div><div style="color:#555">hola@thelab.solutions</div></div>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="color:#8a8a92;font-size:11px;text-transform:uppercase"><th style="text-align:left;padding:0 10px 6px">Ítem</th><th style="text-align:center;padding:0 10px 6px">Cant.</th><th style="text-align:right;padding:0 10px 6px">P. unit.</th><th style="text-align:right;padding:0 10px 6px">Subtotal</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="display:flex;justify-content:flex-end;margin-top:14px">
    <table style="font-size:13px"><tr><td style="padding:3px 14px;color:#8a8a92">Neto</td><td style="padding:3px 0;text-align:right;font-weight:700">${clp(oc.neto)}</td></tr>
    <tr><td style="padding:3px 14px;color:#8a8a92">IVA 19%</td><td style="padding:3px 0;text-align:right;font-weight:700">${clp(Math.round(oc.neto*0.19))}</td></tr>
    <tr style="border-top:2px solid #111"><td style="padding:6px 14px;font-weight:800">TOTAL</td><td style="padding:6px 0;text-align:right;font-weight:800;color:#00947f;font-size:16px">${clp(oc.total)}</td></tr></table>
  </div>
  ${oc.notas?`<div style="margin-top:16px;padding:12px 16px;background:#f6f8fa;border-radius:10px;font-size:12.5px;color:#444"><b>Notas:</b> ${esc(oc.notas)}</div>`:''}
  <div style="margin-top:22px;text-align:center;font-size:10.5px;color:#a0a0a8">The Lab Solutions · dashboard.thelab.solutions</div>
</div>
<script>window.onload=function(){window.focus();setTimeout(function(){window.print();},250);};<\/script></body></html>`;
  const w=window.open('','_blank');if(!w){toast('Permite las ventanas emergentes para el PDF','error');return;}
  w.document.open();w.document.write(html);w.document.close();
  toast('🧾 Orden de compra generada','success');
}
function renderOCList(){
  const el=document.getElementById('ocList');if(!el)return;
  const arr=_ocAll().slice().sort((a,b)=>(b.ts||0)-(a.ts||0));
  if(!arr.length){el.innerHTML='';return;}
  el.innerHTML=`<div class="card" style="margin-top:16px"><div class="card-header"><span class="card-title">🧾 Órdenes de compra</span><button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="openOCModal()">＋ Nueva OC</button></div>
    <div style="padding:2px 0 8px">${arr.slice(0,15).map(o=>`<div style="display:flex;align-items:center;gap:10px;padding:9px 16px;border-top:1px solid var(--border)">
      <span class="mono" style="color:var(--accent);flex-shrink:0">${escapeHtml(o.numero||'—')}</span>
      <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(o.proveedor||'—')}</div><div style="font-size:10.5px;color:var(--text3)">${escapeHtml(o.fecha||'')} · ${(o.items||[]).length} ítem(s) · ${escapeHtml(o.estado||'Emitida')}</div></div>
      <span style="font-family:'JetBrains Mono',monospace;font-weight:700;color:var(--accent3);flex-shrink:0">${formatCLP(o.total||0)}</span>
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0" title="PDF" data-id="${o.id}" onclick="generarOCPDF(this.dataset.id)">📄</button>
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0" title="Editar" data-id="${o.id}" onclick="openOCModal(null,this.dataset.id)">✎</button>
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0;color:var(--danger)" title="Eliminar" data-id="${o.id}" onclick="delOC(this.dataset.id)">✕</button>
    </div>`).join('')}</div></div>`;
}
