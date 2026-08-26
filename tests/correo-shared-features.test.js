const test = require('node:test');
const assert = require('node:assert/strict');

const feature = require('../js/correo-shared-features.js');
const t = feature._test;

test('CC/CCO acepta coma, punto y coma y saltos de linea sin duplicados', () => {
  assert.deepEqual(
    t.splitRecipients('ana@empresa.cl; bob@empresa.cl, ANA@empresa.cl\ncarla@empresa.cl'),
    ['ana@empresa.cl', 'bob@empresa.cl', 'carla@empresa.cl']
  );
  assert.equal(
    t.normalizeRecipientValue('ana@empresa.cl; bob@empresa.cl'),
    'ana@empresa.cl, bob@empresa.cl'
  );
});

test('seleccionar un contacto reemplaza solo el token activo y conserva los anteriores', () => {
  assert.equal(
    t.mergeRecipient('ana@empresa.cl, bo', 'bob@empresa.cl'),
    'ana@empresa.cl, bob@empresa.cl, '
  );
  assert.equal(
    t.activeRecipientToken('ana@empresa.cl, bo'),
    'bo'
  );
});

test('la validacion de destinatarios ignora entradas invalidas', () => {
  assert.deepEqual(
    t.validRecipients('ana@empresa.cl, no-es-correo; bob@empresa.cl'),
    ['ana@empresa.cl', 'bob@empresa.cl']
  );
});

test('las plantillas compartidas se normalizan y deduplican', () => {
  const list = t.normalizeTemplates([
    { id: '1', title: 'Cotizacion', subject: 'Hola', body: '<p>A</p>' },
    { id: '2', title: 'Cotizacion', subject: 'Hola', body: '<p>A</p>' },
    { id: '3', title: 'Seguimiento', subject: 'Seguimiento', body: '<p>B</p>' },
  ]);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, '1');
  assert.equal(list[1].id, '3');
});

test('el payload remoto MAIL_TEMPLATES conserva todas las plantillas', () => {
  const payload = JSON.stringify({
    version: 1,
    updatedAt: 123,
    templates: [
      { id: '1', title: 'Uno', subject: 'A', body: 'Body A' },
      { id: '2', title: 'Dos', subject: 'B', body: 'Body B' },
    ],
  });
  const parsed = t.parseTemplatePayload(payload);
  assert.equal(t.REMOTE_TEMPLATE_NAME, 'MAIL_TEMPLATES');
  assert.equal(t.SHARED_TEMPLATE_KEY, 'thelab_mail_tpl_shared_v1');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].title, 'Dos');
});
