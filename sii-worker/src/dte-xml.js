import { createRequire } from 'module';
import { rsaSha1b64Pem, certDerb64, rsaModulusb64, rsaExponentb64, privateKeyPem } from './sii-crypto.js';

const require = createRequire(import.meta.url);
const { SignedXml } = require('xml-crypto');

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

// Extrae el bloque <CAF>...</CAF> del XML de autorización completo (verbatim).
// Debe ir byte-a-byte como lo entregó SII, porque trae su propia firma <FRMA>.
function extractCafElement(cafXml) {
  const m = cafXml.match(/<CAF[\s\S]*?<\/CAF>/);
  return m ? m[0] : cafXml;
}

// Extrae la llave privada del CAF (<RSASK>) en formato PEM. El timbre (FRMT)
// se firma con ESTA llave, no con la del certificado de la empresa.
function extractCafPrivateKey(cafXml) {
  const m = cafXml.match(/<RSASK>([\s\S]*?)<\/RSASK>/);
  if (!m) throw new Error('CAF no contiene <RSASK> (llave privada del timbre)');
  return m[1].trim();
}

// Genera el TED (Timbre Electrónico) firmado con la llave privada del CAF.
// El TED va embebido dentro del <Documento> antes de <TmstFirma>.
function generateTED(params, cafXml) {
  const { tipoDTE, folio, rutEmisor, receptor, totales, detalle } = params;
  const cafElement = extractCafElement(cafXml);
  const cafKeyPem = extractCafPrivateKey(cafXml);
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

  // FRMT = RSA-SHA1(DD) firmado con la llave privada del CAF (RSASK)
  const frmt = rsaSha1b64Pem(dd, cafKeyPem);

  return `<TED version="1.0">${dd}<FRMT algoritmo="SHA1withRSA">${frmt}</FRMT></TED>`;
}

// Firma enveloped con xml-crypto sobre el elemento `localName` (referenciado por
// `refUri`), insertando el <Signature> como hermano posterior. xml-crypto maneja
// la canonicalización C14N correctamente incluyendo herencia de namespaces.
function signEnveloped(fullXml, localName, refUri, privateKey, certificate) {
  const certB64 = certDerb64(certificate);
  const mod = rsaModulusb64(certificate);
  const exp = rsaExponentb64(certificate);
  const xpath = `//*[local-name(.)='${localName}']`;

  const sig = new SignedXml({
    privateKey: privateKeyPem(privateKey),
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });

  sig.addReference({
    xpath,
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature'],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    uri: refUri,
  });

  sig.getKeyInfoContent = () =>
    `<KeyValue><RSAKeyValue><Modulus>${mod}</Modulus><Exponent>${exp}</Exponent></RSAKeyValue></KeyValue>` +
    `<X509Data><X509Certificate>${certB64}</X509Certificate></X509Data>`;

  sig.computeSignature(fullXml, { location: { reference: xpath, action: 'after' } });
  return sig.getSignedXml();
}

// Construye el <Documento> sin firmar (con el TED ya firmado dentro).
// No lleva xmlns propio: hereda http://www.sii.cl/SiiDte del EnvioDTE, así la
// C14N al firmar coincide con la C14N al verificar (mismo contexto namespace).
function buildDocumento(data, folio, cafXml, env) {
  const { tipo_documento, receptor, detalle, totales } = data;
  const rutEmisor = env.RUT_EMISOR;
  const docId = `F${tipo_documento}T${folio}`;
  const stamp = ts();

  const ted = generateTED(
    { tipoDTE: tipo_documento, folio, rutEmisor, receptor, totales, detalle },
    cafXml
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

  return (
    `<Documento ID="${docId}">` +
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
    `</Documento>`
  );
}

// Construye el EnvioDTE completo y firmado, listo para subir al SII.
// Estrategia: arma TODO el documento sin firmar primero, luego firma el
// <Documento> (#F..) y el <SetDTE> (#SetDoc) EN CONTEXTO con xml-crypto.
// Así el namespace SiiDte es idéntico al firmar y al verificar.
export function buildSignedEnvioDTE(data, folio, cafXml, privateKey, certificate, env) {
  const rutEmisor = cleanRut(env.RUT_EMISOR);
  const docId = `F${data.tipo_documento}T${folio}`;
  const stamp = ts();

  const documento = buildDocumento(data, folio, cafXml, env);
  const dte = `<DTE version="1.0">${documento}</DTE>`;

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

  const setDte = `<SetDTE ID="SetDoc">${caratula}${dte}</SetDTE>`;

  // Documento sin prólogo XML (xml-crypto/xmldom lo maneja mejor sin <?xml?>)
  const envioUnsigned =
    `<EnvioDTE version="1.0" ` +
    `xmlns="http://www.sii.cl/SiiDte" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="http://www.sii.cl/SiiDte EnvioDTE_v10.xsd">` +
    setDte +
    `</EnvioDTE>`;

  // 1. Firma el Documento (Signature queda como hermano dentro de <DTE>)
  let signed = signEnveloped(envioUnsigned, 'Documento', `#${docId}`, privateKey, certificate);
  // 2. Firma el SetDTE (Signature queda como hermano dentro de <EnvioDTE>,
  //    cubriendo la carátula + DTE ya firmado)
  signed = signEnveloped(signed, 'SetDTE', '#SetDoc', privateKey, certificate);

  return `<?xml version="1.0" encoding="ISO-8859-1"?>\n${signed}`;
}
