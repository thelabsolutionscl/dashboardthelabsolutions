import forge from 'node-forge';

export function parsePFX(pfxBase64, password) {
  const pfxDer = forge.util.decode64(pfxBase64);
  const pfxAsn1 = forge.asn1.fromDer(pfxDer);
  const pfx = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, password || '');

  let privateKey = null;
  let certificate = null;

  for (const safeContents of pfx.safeContents) {
    for (const safeBag of safeContents.safeBags) {
      if (
        safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag ||
        safeBag.type === forge.pki.oids.keyBag
      ) {
        privateKey = safeBag.key;
      }
      if (safeBag.type === forge.pki.oids.certBag) {
        // Prefer non-CA certificate
        if (!certificate || !safeBag.cert.isIssuer(safeBag.cert)) {
          certificate = safeBag.cert;
        }
      }
    }
  }

  if (!privateKey) throw new Error('No se encontró clave privada en el .pfx');
  if (!certificate) throw new Error('No se encontró certificado en el .pfx');

  return { privateKey, certificate };
}

// SHA1 digest → base64 (para XMLDSig DigestValue y FRMT del TED)
export function sha1b64(str) {
  const md = forge.md.sha1.create();
  md.update(str, 'utf8');
  return forge.util.encode64(md.digest().bytes());
}

// RSA-SHA1 firma → base64 (para XMLDSig SignatureValue y FRMT del TED)
export function rsaSha1b64(str, privateKey) {
  const md = forge.md.sha1.create();
  md.update(str, 'utf8');
  return forge.util.encode64(privateKey.sign(md));
}

// Certificado DER en base64 (para X509Certificate en KeyInfo)
export function certDerb64(certificate) {
  return forge.util.encode64(
    forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).bytes()
  );
}

// Módulo RSA en base64 (para RSAKeyValue/Modulus)
export function rsaModulusb64(certificate) {
  const hex = certificate.publicKey.n.toString(16);
  const padded = hex.length % 2 === 0 ? hex : '0' + hex;
  return forge.util.encode64(forge.util.hexToBytes(padded));
}

// Exponente RSA en base64 (para RSAKeyValue/Exponent)
export function rsaExponentb64(certificate) {
  const hex = certificate.publicKey.e.toString(16);
  const padded = hex.length % 2 === 0 ? hex : '0' + hex;
  return forge.util.encode64(forge.util.hexToBytes(padded));
}
