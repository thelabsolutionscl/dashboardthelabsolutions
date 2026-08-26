const test = require('node:test');
const assert = require('node:assert/strict');

const fix = require('../js/correo-to-multi-recipient-fix.js');
const {
  splitRecipients,
  normalizeRecipientValue,
  activeRecipientToken,
  mergeRecipient,
} = fix._test;

test('Para acepta varios destinatarios separados por coma, punto y coma o salto de linea', () => {
  assert.deepEqual(
    splitRecipients('uno@thelab.solutions; dos@thelab.solutions\ntres@thelab.solutions, UNO@thelab.solutions'),
    ['uno@thelab.solutions', 'dos@thelab.solutions', 'tres@thelab.solutions'],
  );
});

test('seleccionar otro contacto conserva los destinatarios anteriores', () => {
  const first = mergeRecipient('gustavo', 'gustavo@thelab.solutions');
  assert.equal(first, 'gustavo@thelab.solutions, ');

  const second = mergeRecipient(first + 'andrea', 'andrea@thelab.solutions');
  assert.equal(second, 'gustavo@thelab.solutions, andrea@thelab.solutions, ');

  const third = mergeRecipient(second + 'ventas', 'ventas@thelab.solutions');
  assert.equal(third, 'gustavo@thelab.solutions, andrea@thelab.solutions, ventas@thelab.solutions, ');
});

test('normaliza la lista antes de enviar y reconoce solo el token activo', () => {
  assert.equal(
    normalizeRecipientValue('gustavo@thelab.solutions; andrea@thelab.solutions, '),
    'gustavo@thelab.solutions, andrea@thelab.solutions',
  );
  assert.equal(
    activeRecipientToken('gustavo@thelab.solutions, and'),
    'and',
  );
});
