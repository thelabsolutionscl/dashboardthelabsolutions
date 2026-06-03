import { createRequire } from 'module';
import { sha1b64, rsaSha1b64, certDerb64, rsaModulusb64, rsaExponentb64, privateKeyPem } from './sii-crypto.js';

const require = createRequire(import.meta.url);
const { SignedXml } = require('xml-crypto');

function siiHost(env) {
  return env.SII_ENV === 'produccion'
    ? 'https://palena.sii.cl'
    : 'https://maullin.sii.cl';
}

// Construye un bloque XMLDSig Signature.
// Reglas críticas para que SII lo acepte:
//  1. xmlns default (sin prefijo) — SII Java usa getElementsByTagName("Signature")
//     con namespace-unaware parsing, que busca el nombre literal del tag.
//  2. xmlns declarado en <SignedInfo> (no solo en <Signature> padre) para que el
//     string que firmamos coincida exactamente con la salida C14N del subtree.
//  3. Tags vacíos con cierre explícito (C14N expande <Foo/> a <Foo></Foo>).
function buildXmlSignature(refUri, contentToDigest, privateKey, certificate) {
  const digest = sha1b64(contentToDigest);

  const ns = 'xmlns="http://www.w3.org/2000/09/xmldsig#"';
  const signedInfo =
    `<SignedInfo ${ns}>` +
    `<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod>` +
    `<Reference URI="${refUri}">` +
    `<Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform></Transforms>` +
    `<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod>` +
    `<DigestValue>${digest}</DigestValue>` +
    `</Reference>` +
    `</SignedInfo>`;

  const sigValue = rsaSha1b64(signedInfo, privateKey);
  const certB64 = certDerb64(certificate);
  const mod = rsaModulusb64(certificate);
  const exp = rsaExponentb64(certificate);

  return (
    `<Signature ${ns}>` +
    signedInfo +
    `<SignatureValue>${sigValue}</SignatureValue>` +
    `<KeyInfo>` +
    `<KeyValue><RSAKeyValue><Modulus>${mod}</Modulus><Exponent>${exp}</Exponent></RSAKeyValue></KeyValue>` +
    `<X509Data><X509Certificate>${certB64}</X509Certificate></X509Data>` +
    `</KeyInfo>` +
    `</Signature>`
  );
}

const SII_HEADERS = {
  'User-Agent': 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.0)',
  'Accept': 'text/xml',
};

// CrSeed.jws requiere SOAP POST (no GET simple)
async function getSeed(env) {
  const soap =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:impl="http://DefaultNamespace">' +
    '<soapenv:Header/>' +
    '<soapenv:Body><impl:getSeed/></soapenv:Body>' +
    '</soapenv:Envelope>';

  const res = await fetch(`${siiHost(env)}/DTEWS/CrSeed.jws`, {
    method: 'POST',
    headers: { ...SII_HEADERS, 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '""' },
    body: soap,
  });
  const xml = await res.text();

  // Buscar SEMILLA directamente (si el XML es raw dentro del SOAP)
  let semilla = (xml.match(/<SEMILLA>(\d+)<\/SEMILLA>/) || [])[1];

  // Si no, extraer getSeedReturn y desescapar entidades HTML
  if (!semilla) {
    const m = xml.match(/<[^:>\s]+:getSeedReturn[^>]*>([\s\S]*?)<\/[^:>\s]+:getSeedReturn>/);
    if (m) {
      const inner = m[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
      semilla = (inner.match(/<SEMILLA>(\d+)<\/SEMILLA>/) || [])[1];
    }
  }

  if (!semilla) throw new Error('SII no devolvió semilla: ' + xml.substring(0, 400));
  return semilla;
}

// helper para desescapar entidades XML dentro de un elemento SOAP
function extractSoapReturn(xml, methodName) {
  const m = xml.match(new RegExp(`<[^:>\\s]+:${methodName}Return[^>]*>([\\s\\S]*?)<\\/[^:>\\s]+:${methodName}Return>`));
  if (!m) return null;
  return m[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"');
}

// Firma el documento getToken con xml-crypto (C14N correcto garantizado).
// Estructura estándar SII:
//   <getToken>
//     <item><Semilla>X</Semilla></item>
//     <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">...</Signature>
//   </getToken>
function signGetToken(semilla, privateKey, certificate) {
  const certB64 = certDerb64(certificate);
  const mod = rsaModulusb64(certificate);
  const exp = rsaExponentb64(certificate);

  const xml = `<getToken><item><Semilla>${semilla}</Semilla></item></getToken>`;

  const sig = new SignedXml({
    privateKey: privateKeyPem(privateKey),
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });

  sig.addReference({
    xpath: '/*',
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature'],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    isEmptyUri: true,
  });

  // KeyInfo con RSAKeyValue + X509Certificate (formato que SII espera)
  sig.getKeyInfoContent = () =>
    `<KeyValue><RSAKeyValue><Modulus>${mod}</Modulus><Exponent>${exp}</Exponent></RSAKeyValue></KeyValue>` +
    `<X509Data><X509Certificate>${certB64}</X509Certificate></X509Data>`;

  // Sin prefijo → <Signature xmlns="...">; append → Signature como último hijo de <getToken>
  sig.computeSignature(xml, { location: { reference: '/*', action: 'append' } });

  return sig.getSignedXml();
}

// Paso 2: firma la semilla y obtiene token de sesión
export async function getSIIToken(privateKey, certificate, env) {
  const semilla = await getSeed(env);
  const innerXml = signGetToken(semilla, privateKey, certificate);

  // Entity-encode: &amp; primero, luego <, >, "
  const escapedXml = innerXml
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // SOAP con namespace inline en <getToken> para que <pszXml> herede DefaultNamespace
  // y xsi:type="xsd:string" para que Axis1 matchee el parámetro correctamente
  const soapBody =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<soapenv:Header/>` +
    `<soapenv:Body>` +
    `<getToken xmlns="http://DefaultNamespace">` +
    `<pszXml xsi:type="xsd:string">${escapedXml}</pszXml>` +
    `</getToken>` +
    `</soapenv:Body>` +
    `</soapenv:Envelope>`;

  console.log('[DEBUG getToken] innerXml firmado:', innerXml);

  const res = await fetch(`${siiHost(env)}/DTEWS/GetTokenFromSeed.jws`, {
    method: 'POST',
    headers: { ...SII_HEADERS, 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '""' },
    body: soapBody,
  });

  const xml = await res.text();
  console.log('[DEBUG getToken] SII HTTP status:', res.status);
  console.log('[DEBUG getToken] SII raw response:', xml.substring(0, 800));

  // Buscar TOKEN directo o dentro de getTokenReturn (entity-encoded)
  let token = (xml.match(/<TOKEN>([^<]+)<\/TOKEN>/) || [])[1]?.trim();
  const inner = extractSoapReturn(xml, 'getToken');
  if (!token && inner) token = (inner.match(/<TOKEN>([^<]+)<\/TOKEN>/) || [])[1]?.trim();

  if (!token) {
    const fault  = xml.match(/<faultstring>([^<]+)<\/faultstring>/);
    const glosa  = (inner || xml).match(/<GLOSA>([^<]+)<\/GLOSA>/);
    const estado = (inner || xml).match(/<ESTADO>([^<]+)<\/ESTADO>/);
    const detail = [
      fault  ? `FAULT: ${fault[1]}`   : '',
      estado ? `ESTADO: ${estado[1]}` : '',
      glosa  ? `GLOSA: ${glosa[1]}`   : '',
    ].filter(Boolean).join(' | ');
    throw new Error('Error obteniendo token SII: ' + (detail || (inner || xml).substring(0, 400)));
  }
  return token;
}

// Sube el EnvioDTE firmado al SII y devuelve trackid + estado
export async function uploadDTE(envioDteXml, token, rutEmisor, env) {
  // SII espera el RUT separado: número (sin DV) y dígito verificador.
  const rutClean = rutEmisor.replace(/\./g, '');           // "77499554-4"
  const [rutNum, dv] = rutClean.split('-');                // ["77499554", "4"]
  const boundary = '----SIIWorkerBoundary' + Date.now().toString(16);

  // Campos correctos del DTEUpload del SII: rutSender/dvSender (quien envía),
  // rutCompany/dvCompany (emisor), archivo. La auth va por la cookie TOKEN.
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="rutSender"\r\n\r\n${rutNum}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="dvSender"\r\n\r\n${dv}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="rutCompany"\r\n\r\n${rutNum}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="dvCompany"\r\n\r\n${dv}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="archivo"; filename="EnvioDTE.xml"\r\n` +
    `Content-Type: text/xml\r\n\r\n` +
    envioDteXml + `\r\n` +
    `--${boundary}--\r\n`;

  const res = await fetch(`${siiHost(env)}/cgi_dte/UPL/DTEUpload`, {
    method: 'POST',
    headers: {
      ...SII_HEADERS,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Cookie': `TOKEN=${token}`,
    },
    body,
  });

  const text = await res.text();

  console.log('[DEBUG uploadDTE] HTTP status:', res.status);
  console.log('[DEBUG uploadDTE] respuesta cruda SII COMPLETA:\n', text);

  const trackid = (text.match(/TRACKID[^>]*>([^<]+)/i) || [])[1]?.trim() || null;
  const estado = (text.match(/ESTADO[^>]*>(\-?\d+)/i) || [])[1]?.trim() || null;
  const glosa = (text.match(/GLOSA[^>]*>([^<]+)/i) || [])[1]?.trim() || '';

  if (estado === '-11') throw new Error('RUT no autorizado como emisor electrónico en SII');
  if (estado === '-1')  throw new Error('Error autenticación SII: ' + glosa);

  // Extrae el texto de error de la página HTML del SII (quita tags) para diagnóstico
  const errSection = text.includes('HA OCURRIDO UN ERROR')
    ? text.slice(text.indexOf('HA OCURRIDO UN ERROR')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 800)
    : text.substring(0, 800);

  return { trackid, estado, glosa, http: res.status, raw: errSection };
}
