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

// Paso 1: obtiene semilla del SII
async function getSeed(env) {
  const res = await fetch(`${siiHost(env)}/DTEWS/CrSeed.jws`, {
    headers: { 'User-Agent': 'Mozilla/4.0 (compatible)' },
  });
  const xml = await res.text();
  const m = xml.match(/<SEMILLA>(\d+)<\/SEMILLA>/);
  if (!m) throw new Error('SII no devolvió semilla: ' + xml.substring(0, 300));
  return m[1];
}

// Paso 2: firma la semilla y obtiene token de sesión
export async function getSIIToken(privateKey, certificate, env) {
  const semilla = await getSeed(env);

  // El item que se firma es el contenido del elemento <item> (SII usa enveloped sobre <item>)
  const itemContent = `<Semilla>${semilla}</Semilla>`;
  const itemXml = `<item>${itemContent}</item>`;

  const signature = buildXmlSignature('', itemXml, privateKey, certificate);

  const body =
    `<?xml version="1.0"?>\n<getToken>\n<item>\n` +
    `<Semilla>${semilla}</Semilla>\n` +
    signature +
    `\n</item>\n</getToken>`;

  const res = await fetch(`${siiHost(env)}/DTEWS/GetTokenFromSeed.jws`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'User-Agent': 'Mozilla/4.0 (compatible)',
    },
    body,
  });

  const xml = await res.text();
  const tokenMatch = xml.match(/<TOKEN>([^<]+)<\/TOKEN>/);
  if (!tokenMatch) {
    const glosa = xml.match(/<GLOSA>([^<]+)<\/GLOSA>/);
    throw new Error('Error obteniendo token SII: ' + (glosa ? glosa[1] : xml.substring(0, 400)));
  }
  return tokenMatch[1].trim();
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
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Cookie': `TOKEN=${token}`,
      'User-Agent': 'Mozilla/4.0 (compatible)',
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
