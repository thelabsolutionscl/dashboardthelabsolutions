import { sha1b64, rsaSha1b64, certDerb64, rsaModulusb64, rsaExponentb64 } from './sii-crypto.js';

function siiHost(env) {
  return env.SII_ENV === 'produccion'
    ? 'https://palena.sii.cl'
    : 'https://maullin.sii.cl';
}

// Construye un bloque XMLDSig Signature. El parámetro `refUri` es el URI
// del Reference (ej: "" para documento completo, "#F33T1" para elemento por ID).
function buildXmlSignature(refUri, contentToDigest, privateKey, certificate) {
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

// Paso 2: firma la semilla y obtiene token de sesión
export async function getSIIToken(privateKey, certificate, env) {
  const semilla = await getSeed(env);

  const itemContent = `<Semilla>${semilla}</Semilla>`;
  const itemXml = `<item>${itemContent}</item>`;
  const signature = buildXmlSignature('', itemXml, privateKey, certificate);

  // Axis1 SimpleDeserializer espera un String — el XML debe ir entity-encoded
  const innerXml = `<item><Semilla>${semilla}</Semilla>${signature}</item>`;
  const escapedXml = innerXml.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const soapBody =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:impl="http://DefaultNamespace">` +
    `<soapenv:Header/>` +
    `<soapenv:Body><impl:getToken>` +
    `<pszXml>${escapedXml}</pszXml>` +
    `</impl:getToken></soapenv:Body>` +
    `</soapenv:Envelope>`;

  const res = await fetch(`${siiHost(env)}/DTEWS/GetTokenFromSeed.jws`, {
    method: 'POST',
    headers: { ...SII_HEADERS, 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '""' },
    body: soapBody,
  });

  const xml = await res.text();

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
  const rutClean = rutEmisor.replace(/\./g, '');  // "77190661-3"
  const boundary = '------SIIWorkerBoundary' + Date.now().toString(16);

  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="rutSender"\r\n\r\n${rutClean}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="passSender"\r\n\r\n${token}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="rutCompany"\r\n\r\n${rutClean}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="archivo"; filename="EnvioDTE.xml"\r\n` +
    `Content-Type: text/xml\r\n\r\n` +
    envioDteXml + `\r\n` +
    `--${boundary}--`;

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

  const trackid = (text.match(/TRACKID[^>]*>([^<]+)/i) || [])[1]?.trim() || null;
  const estado = (text.match(/ESTADO[^>]*>(\-?\d+)/i) || [])[1]?.trim() || null;
  const glosa = (text.match(/GLOSA[^>]*>([^<]+)/i) || [])[1]?.trim() || '';

  if (estado === '-11') throw new Error('RUT no autorizado como emisor electrónico en SII');
  if (estado === '-1')  throw new Error('Error autenticación SII: ' + glosa);

  return { trackid, estado, glosa };
}
