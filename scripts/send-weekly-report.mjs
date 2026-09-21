import fs from 'node:fs';

const apiKey = (process.env.RESEND_API_KEY || '').trim();
const to = (process.env.REPORT_EMAIL || '').trim();
const from = (process.env.RESEND_FROM || 'The Lab Solutions <hola@thelab.solutions>').trim();

if (!apiKey || !to) {
  console.log('RESEND_API_KEY o REPORT_EMAIL no configurado — resumen omitido.');
  process.exit(0);
}

const summary = fs.readFileSync('backup/resumen.txt', 'utf8').trim();
const date = new Date().toISOString().slice(0, 10);
const html = '<div style="font-family:system-ui,Arial,sans-serif;line-height:1.55;white-space:pre-wrap">' +
  summary.replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])) +
  '</div>';

const response = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + apiKey,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    from,
    to: [to],
    reply_to: 'hola@thelab.solutions',
    subject: '💾 Backup semanal CRM — ' + date,
    text: summary,
    html,
  }),
});

const payload = await response.json().catch(() => ({}));
if (!response.ok) {
  throw new Error('Resend HTTP ' + response.status + ': ' + (payload.message || 'error sin detalle'));
}
console.log('Resumen enviado por Resend: ' + (payload.id || 'aceptado'));
