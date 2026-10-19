/* Repositorio compartido de catálogos TLS.
 * R2 es privado: todos los accesos pasan por Cloudflare Access y este Worker.
 * No se generan enlaces públicos ni URLs firmadas permanentes.
 */
const PREFIX='catalogos/';
const MAX_PDF_BYTES=25*1024*1024;
const MAX_REQUEST_BYTES=MAX_PDF_BYTES+128*1024;
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES=new Set(['General','Merchandising','Impresión 3D','POP y exhibidores','Señalética','Premiación','Papelería','Otros']);
const READ_ROLES=new Set(['viewer','sales','operator','finance','admin']);
const UPLOAD_ROLES=new Set(['sales','operator','finance','admin']);

function reply(body,status,headers){
  return new Response(JSON.stringify(body),{status,headers:{
    ...headers,'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff'}});
}
function visibleFile(o){
  const m=o.customMetadata||{};
  return {id:o.key.slice(PREFIX.length).replace(/\.pdf$/,''),name:m.name||'Catálogo.pdf',
    category:CATEGORIES.has(m.category)?m.category:'General',size:o.size||0,
    uploadedAt:m.uploadedAt||o.uploaded?.toISOString?.()||'',
    uploadedBy:m.uploadedBy||''};
}
function cleanName(raw){
  return String(raw||'').replace(/[\u0000-\u001f\u007f<>:"\\/|?*]/g,' ').replace(/\s+/g,' ').trim().slice(0,140);
}
function safeKey(pathname){
  const match=/^\/catalogos\/([0-9a-f-]{36})$/.exec(pathname.toLowerCase());
  return match&&ID.test(match[1])?PREFIX+match[1]+'.pdf':null;
}
export function catalogosRoute(path){
  return path==='/catalogos'||path.startsWith('/catalogos/');
}
export async function handleCatalogos(request,url,env,identity,cors){
  const headers={...cors,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
  if(!identity||!READ_ROLES.has(identity.role))
    return reply({error:'Se requiere sesión Cloudflare Access válida'},401,headers);
  if(!env.CATALOGOS_BUCKET)
    return reply({error:'Almacenamiento de catálogos sin configurar. Vincula el bucket R2 CATALOGOS_BUCKET.'},503,headers);
  const isIndex=url.pathname==='/catalogos',key=isIndex?null:safeKey(url.pathname);
  if(!isIndex&&!key)return reply({error:'Catálogo inexistente'},404,headers);

  if(isIndex&&request.method==='GET'){
    const params=[...url.searchParams.keys()];
    if(params.some(p=>p!=='cursor')||params.length>1)return reply({error:'Parámetros no permitidos'},400,headers);
    const cursor=url.searchParams.get('cursor')||'';
    if(cursor.length>500)return reply({error:'Cursor inválido'},400,headers);
    try{
      const opts={prefix:PREFIX,limit:200,include:['customMetadata']};
      if(cursor)opts.cursor=cursor;
      const page=await env.CATALOGOS_BUCKET.list(opts);
      return reply({items:page.objects.filter(x=>safeKey('/catalogos/'+x.key.slice(PREFIX.length).replace(/\.pdf$/,'')))
        .map(visibleFile).sort((a,b)=>b.uploadedAt.localeCompare(a.uploadedAt)),
        cursor:page.truncated?page.cursor||null:null},200,headers);
    }catch(_){return reply({error:'No fue posible cargar los catálogos'},503,headers);}
  }

  if(isIndex&&request.method==='POST'){
    if(!UPLOAD_ROLES.has(identity.role))return reply({error:'Tu rol no puede subir catálogos'},403,headers);
    if(url.search)return reply({error:'Parámetros no permitidos'},400,headers);
    const len=Number(request.headers.get('Content-Length')||0);
    if(len>MAX_REQUEST_BYTES)return reply({error:'El PDF supera 25 MB'},413,headers);
    if(!String(request.headers.get('Content-Type')||'').toLowerCase().startsWith('multipart/form-data;'))
      return reply({error:'Se requiere formulario con PDF'},415,headers);
    let form;
    try{form=await request.formData();}catch(_){return reply({error:'Formulario de carga inválido'},400,headers);}
    const file=form.get('file'),title=cleanName(form.get('name')),category=String(form.get('category')||'General');
    if(!(file instanceof File)||!file.size||file.size>MAX_PDF_BYTES)
      return reply({error:'Selecciona un PDF válido de hasta 25 MB'},413,headers);
    const bytes=new Uint8Array(await file.slice(0,5).arrayBuffer());
    if(String.fromCharCode(...bytes)!=='%PDF-'||!String(file.name||'').toLowerCase().endsWith('.pdf'))
      return reply({error:'El archivo no parece un PDF válido'},415,headers);
    if(file.type&&file.type!=='application/pdf'&&file.type!=='application/octet-stream')
      return reply({error:'Tipo de archivo no permitido'},415,headers);
    if(!CATEGORIES.has(category)||!title)return reply({error:'Nombre o categoría inválidos'},422,headers);
    const name=title.toLowerCase().endsWith('.pdf')?title:title+'.pdf';
    const id=crypto.randomUUID(),uploadedAt=new Date().toISOString();
    const metadata={name,category,uploadedAt,uploadedBy:identity.email};
    try{
      await env.CATALOGOS_BUCKET.put(PREFIX+id+'.pdf',file.stream(),{
        httpMetadata:{contentType:'application/pdf',contentDisposition:'inline; filename="catalogo.pdf"'},
        customMetadata:metadata});
      return reply({ok:true,item:{id,name,category,size:file.size,uploadedAt,uploadedBy:identity.email}},201,headers);
    }catch(_){return reply({error:'No se pudo guardar el PDF'},503,headers);}
  }

  if(!isIndex&&request.method==='GET'){
    if(url.search)return reply({error:'Parámetros no permitidos'},400,headers);
    const obj=await env.CATALOGOS_BUCKET.get(key);
    if(!obj)return reply({error:'Catálogo no encontrado'},404,headers);
    return new Response(obj.body,{status:200,headers:{...headers,
      'Content-Type':'application/pdf','Content-Disposition':'inline; filename="catalogo.pdf"',
      'Content-Length':String(obj.size),'X-Content-Type-Options':'nosniff'}});
  }

  if(!isIndex&&request.method==='DELETE'){
    if(identity.role!=='admin')return reply({error:'Solo administración puede eliminar catálogos'},403,headers);
    if(url.search)return reply({error:'Parámetros no permitidos'},400,headers);
    const obj=await env.CATALOGOS_BUCKET.head(key);
    if(!obj)return reply({error:'Catálogo no encontrado'},404,headers);
    await env.CATALOGOS_BUCKET.delete(key);
    return reply({ok:true},200,headers);
  }
  return reply({error:'Método no permitido'},405,{...headers,Allow:isIndex?'GET, POST':'GET, DELETE'});
}
