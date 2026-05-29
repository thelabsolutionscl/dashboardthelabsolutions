import { sha1b64, rsaSha1b64, certDerb64, rsaModulusb64, rsaExponentb64 } from './sii-crypto.js';

function x(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ts() {
  return new Date().toISOString().slice(0, 19);  // "2026-05-29T10:00:00"
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function cleanRut(rut) {
  return (rut || '').replace(/\./g, '');  // elimina puntos, conserva guión
}

// Extrae el bloque <CAF>...</CAF> del XML de autorización completo
function extractCafElement(cafXml) {
  const m = cafXml.match(/<CAF[\s\S]*?<\/CAF>/);
  return m ? m[0] : cafXml;
}

// Genera el TED (Timbre Electrónico) y lo firma con la clave privada de la empresa.
// El TED va embebido dentro del <Documento> antes de <TmstFirma>.
function generateTED(params, cafXml, privateKey) {
  const { tipoDTE, folio, rutEmisor, receptor, totales, detalle } = params;
  const cafElement = extractCafElement(cafXml);
  const stamp = ts();

  // DD incluye el CAF exactamente como lo entregó SII (sin modificaciones)
  const dd =
    `<DD>` +
    `<RE>${cleanRut(rutEmisor)}</RE>` +
    `<TD>${tipoDTE}</TD>` +
    `<F>${folio}</F>` +
    `<FE>${today()}</FE>` +
    `<RR>${cleanRut(receptor.rut)}</RR>` +
    `<RSR>${x(receptor.razon_social.substring(0, 40))}</RSR>` +
    `<MNT>${totales.total}</MNT>` +
    `<IT1>${x((detalle[0].nombre || '').substring(0, 40))}</IT1>` +
    cafElement +
    `<TSTED>${stamp}</TSTED>` +
    `</DD>`;

  const frmt = rsaSha1b64(dd, privateKey);

  return `<TED version="1.0">${dd}<FRMT algoritmo="SHA1withRSA">${frmt}</FRMT></TED>`;
}

// Construye el XML del bloque Signature para el Documento o el SetDTE.
// contentToDigest: el XML del elemento referenciado (para calcular el DigestValue).
// refUri: URI del Reference (ej: "#F33T1" o "#SetDoc").
function buildSignature(contentToDigest, refUri, privateKey, certificate) {
  const digest = sha1b64(contentToDigest);

  const signedInfo =
    `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">` +
    `<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>` +
    `<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>` +
    `<Reference URI="${refUri}">` +
    `<Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></Transforms>` +
    `<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>` +
    `<DigestValue>${digest}</DigestValue>` +
    `</Reference>` +
    `</SignedInfo>`;

  const sigValue = rsaSha1b64(signedInfo, privateKey);
  const certB64 = certDerb64(certificate);
  const mod = rsaModulusb64(certificate);
  const exp = rsaExponentb64(certificate);

  return (
    `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">` +
    signedInfo +
    `<SignatureValue>${sigValue}</SignatureValue>` +
    `<KeyInfo>` +
    `<KeyValue><RSAKeyValue><Modulus>${mod}</Modulus><Exponent>${exp}</Exponent></RSAKeyValue></KeyValue>` +
    `<X509Data><X509Certificate>${certB64}</X509Certificate></X509Data>` +
    `</KeyInfo>` +
    `</Signature>`
  );
}

// Genera el DTE completo firmado (listo para ir dentro del EnvioDTE).
export function generateSignedDTE(data, folio, cafXml, privateKey, certificate, env) {
  const { tipo_documento, receptor, detalle, totales, referencia } = data;
  const rutEmisor = env.RUT_EMISOR;
  const docId = `F${tipo_documento}T${folio}`;
  const stamp = ts();

  const ted = generateTED(
    { tipoDTE: tipo_documento, folio, rutEmisor, receptor, totales, detalle },
    cafXml,
    privateKey
  );

  const detalles = detalle
    .map((item, i) =>
      `<Detalle>` +
      `<NroLinDet>${i + 1}</NroLinDet>` +
      `<NmbItem>${x(item.nombre)}</NmbItem>` +
      `<QtyItem>${item.cantidad}</QtyItem>` +
      `<PrcItem>${Math.round(item.precio_unitario)}</PrcItem>` +
      `<MontoItem>${Math.round(item.monto_neto)}</MontoItem>` +
      `</Detalle>`
    )
    .join('');

  // El Documento incluye xmlns explícito para que el digest sea C14N-correcto
  // (en C14N inclusive, el namespace del elemento padre se hereda en el hijo;
  //  al ponerlo explícito aquí el string para hash coincide con el C14N output).
  const documento =
    `<Documento ID="${docId}" xmlns="http://www.sii.cl/SiiDte">` +
    `<Encabezado>` +
    `<IdDoc>` +
    `<TipoDTE>${tipo_documento}</TipoDTE>` +
    `<Folio>${folio}</Folio>` +
    `<FchEmis>${today()}</FchEmis>` +
    `<FmaPago>1</FmaPago>` +
    `</IdDoc>` +
    `<Emisor>` +
    `<RUTEmisor>${cleanRut(rutEmisor)}</RUTEmisor>` +
    `<RznSoc>${x(env.RAZON_SOCIAL)}</RznSoc>` +
    `<GiroEmis>${x(env.GIRO_EMISOR)}</GiroEmis>` +
    `<Acteco>${env.ACTECO}</Acteco>` +
    `<DirOrigen>${x(env.DIR_EMISOR)}</DirOrigen>` +
    `<CmnaOrigen>${x(env.CMNA_EMISOR)}</CmnaOrigen>` +
    `<CiudadOrigen>${x(env.CIUDAD_EMISOR)}</CiudadOrigen>` +
    `</Emisor>` +
    `<Receptor>` +
    `<RUTRecep>${cleanRut(receptor.rut)}</RUTRecep>` +
    `<RznSocRecep>${x(receptor.razon_social)}</RznSocRecep>` +
    `<GiroRecep>${x(receptor.giro || 'Sin giro')}</GiroRecep>` +
    (receptor.email ? `<Contacto>${x(receptor.email)}</Contacto>` : '') +
    (receptor.direccion ? `<DirRecep>${x(receptor.direccion)}</DirRecep>` : '') +
    (receptor.comuna ? `<CmnaRecep>${x(receptor.comuna)}</CmnaRecep>` : '') +
    (receptor.ciudad ? `<CiudadRecep>${x(receptor.ciudad)}</CiudadRecep>` : '') +
    `</Receptor>` +
    `<Totales>` +
    `<MntNeto>${totales.neto}</MntNeto>` +
    `<TasaIVA>19</TasaIVA>` +
    `<IVA>${totales.iva}</IVA>` +
    `<MntTotal>${totales.total}</MntTotal>` +
    `</Totales>` +
    `</Encabezado>` +
    detalles +
    ted +
    `<TmstFirma>${stamp}</TmstFirma>` +
    `</Documento>`;

  const docSignature = buildSignature(documento, `#${docId}`, privateKey, certificate);

  return (
    `<DTE version="1.0">` +
    documento +
    docSignature +
    `</DTE>`
  );
}

// Construye el EnvioDTE completo con su firma sobre el SetDTE.
export function buildEnvioDTE(signedDte, data, folio, env, privateKey, certificate) {
  const rutEmisor = cleanRut(env.RUT_EMISOR);
  const stamp = ts();

  const caratula =
    `<Caratula version="1.0">` +
    `<RutEmisor>${rutEmisor}</RutEmisor>` +
    `<RutEnvia>${rutEmisor}</RutEnvia>` +
    `<RutReceptor>60803000-K</RutReceptor>` +
    `<FchResol>${env.RESOLUCION_FECHA}</FchResol>` +
    `<NroResol>${env.RESOLUCION_NUMERO}</NroResol>` +
    `<TmstFirmaEnv>${stamp}</TmstFirmaEnv>` +
    `<SubTotDTE><TpoDTE>${data.tipo_documento}</TpoDTE><NroDTE>1</NroDTE></SubTotDTE>` +
    `</Caratula>`;

  // El SetDTE tiene su propio ID para la firma
  const setDteInner = caratula + signedDte;
  const setDteWithId = `<SetDTE ID="SetDoc">${setDteInner}</SetDTE>`;

  const setSignature = buildSignature(setDteWithId, '#SetDoc', privateKey, certificate);

  return (
    `<?xml version="1.0" encoding="ISO-8859-1"?>\n` +
    `<EnvioDTE version="1.0" ` +
    `xmlns="http://www.sii.cl/SiiDte" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="http://www.sii.cl/SiiDte EnvioDTE_v10.xsd">` +
    setDteWithId +
    setSignature +
    `</EnvioDTE>`
  );
}
