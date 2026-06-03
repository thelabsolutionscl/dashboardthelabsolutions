import forge from 'node-forge';

export function parsePFX(pfxBase64, password) {
  const pfxDer = forge.util.decode64(pfxBase64);
  const pfxAsn1 = forge.asn1.fromDer(pfxDer);
  const pfx = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, password || '');

  let privateKey = null;
  const certs = [];

  for (const safeContents of pfx.safeContents) {
    for (const safeBag of safeContents.safeBags) {
      if (
        safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag ||
        safeBag.type === forge.pki.oids.keyBag
      ) {
        privateKey = safeBag.key;
      }
      if (safeBag.type === forge.pki.oids.certBag && safeBag.cert) {
        certs.push(safeBag.cert);
      }
    }
  }

  if (!privateKey) throw new Error('No se encontró clave privada en el .pfx');
  if (!certs.length) throw new Error('No se encontró certificado en el .pfx');

  // CRÍTICO: elegir el certificado cuya clave pública corresponde a la clave
  // privada. Si el .pfx trae la cadena de la CA, otros certs NO matchean la
  // clave privada y SII rechazaría la firma (ESTADO 10 "Error Interno").
  let certificate = certs.find(
    c => c.publicKey && c.publicKey.n && c.publicKey.n.equals(privateKey.n)
  );

  if (!certificate) {
    // Fallback: el primer cert que NO sea auto-firmado (no-CA)
    certificate = certs.find(c => !c.isIssuer(c)) || certs[0];
  }

  return { privateKey, certificate };
}

// Diagnóstico: verifica que el certificado seleccionado corresponda a la clave
// privada (mismo módulo RSA). Devuelve detalle útil para depurar el .pfx.
export function describePFX(pfxBase64, password) {
  const pfxDer = forge.util.decode64(pfxBase64);
  const pfxAsn1 = forge.asn1.fromDer(pfxDer);
  const pfx = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, password || '');

  let privateKey = null;
  const certs = [];
  for (const safeContents of pfx.safeContents) {
    for (const safeBag of safeContents.safeBags) {
      if (safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag || safeBag.type === forge.pki.oids.keyBag) {
        privateKey = safeBag.key;
      }
      if (safeBag.type === forge.pki.oids.certBag && safeBag.cert) certs.push(safeBag.cert);
    }
  }

  const pkN = privateKey?.n?.toString(16) || null;
  return {
    cert_count: certs.length,
    private_key_present: !!privateKey,
    certs: certs.map(c => {
      const subjCN = (c.subject.getField('CN') || {}).value || null;
      const issuerCN = (c.issuer.getField('CN') || {}).value || null;
      const certN = c.publicKey?.n?.toString(16) || null;
      // RUT suele ir en el serialNumber del subject
      const subjSerial = (c.subject.getField({ name: 'serialName' }) || c.subject.getField('2.5.4.5') || {}).value || null;
      return {
        subject_cn: subjCN,
        subject_rut: subjSerial,
        issuer_cn: issuerCN,
        self_signed: c.isIssuer(c),
        matches_private_key: certN && pkN ? certN === pkN : false,
        not_before: c.validity.notBefore,
        not_after: c.validity.notAfter,
      };
    }),
  };
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
