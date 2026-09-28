// Test de bout en bout, SANS clés réelles : de faux serveurs imitent l'API Claude
// et l'API Brevo. Vérifie le chat, la base de données, les emails, l'admin et la sécurité.
// Usage : TEST_DATABASE_URL=postgres://... npm test   (la base de test est vidée !)

import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const DB_URL = process.env.TEST_DATABASE_URL || 'postgres://app:app@localhost:5432/sama';
const FAKE_PORT = 4010;
const APP_PORT = 3111;
const APP = `http://127.0.0.1:${APP_PORT}`;
const OWNER = 'owner@test.local';
const CLIENT = 'client@test.local';

// ---------- Préparation de la base ----------
process.env.DATABASE_URL = DB_URL;
const { db, closeDb } = await import('../lib/db.js');
await db().unsafe('drop table if exists reservation_events, reservations, email_log, rate_limits, settings cascade');
const { nowIn, addDays, weekdayOf } = await import('../lib/time.js');
let DAY = addDays(nowIn('Africa/Dakar').date, 1);
while (weekdayOf(DAY) === 'sun') DAY = addDays(DAY, 1);

// ---------- Faux Claude + faux Brevo ----------
const emails = [];
const claudeCalls = [];
function toolUse(name, input) {
  return { id: 'msg_' + Math.random().toString(36).slice(2), type: 'message', role: 'assistant', stop_reason: 'tool_use',
    content: [{ type: 'text', text: '' }, { type: 'tool_use', id: 'tu_' + Math.random().toString(36).slice(2), name, input }] };
}
function textMsg(text) {
  return { id: 'msg_x', type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] };
}
function fakeClaude(body) {
  claudeCalls.push(body);
  const last = body.messages[body.messages.length - 1];
  if (Array.isArray(last.content)) {
    const result = JSON.parse(last.content[0].content);
    const prev = body.messages[body.messages.length - 2].content.find((b) => b.type === 'tool_use');
    if (prev.name === 'check_availability') return textMsg(result.available ? `Le créneau de ${result.time} est disponible.` : `Complet. Alternatives : ${(result.alternatives_same_day || []).join(', ')}`);
    if (prev.name === 'create_reservation') return textMsg(result.ok ? `C'est réservé ! Votre code : ${result.reservation.code}` : `Erreur : ${result.message}`);
    if (prev.name === 'modify_reservation') return textMsg(result.ok ? `Modifié : ${result.reservation.time}` : `Erreur : ${result.message}`);
    if (prev.name === 'cancel_reservation') return textMsg(result.ok ? 'Réservation annulée.' : `Erreur : ${result.message}`);
    return textMsg('ok');
  }
  const t = last.content;
  const code = (/\b([A-Z2-9]{6})\b/.exec(t) || [])[1];
  if (/rendez-vous/i.test(t)) return toolUse('check_availability', { date: DAY, time: '10:00', party_size: 1 });
  if (/oui je confirme/i.test(t)) return toolUse('create_reservation', { name: 'Client Test', phone: '+221 77 111 22 33', email: CLIENT, date: DAY, time: '10:00', party_size: 1, notes: 'Billet Dakar-Paris' });
  if (/déplacer/i.test(t)) return toolUse('modify_reservation', { code, contact: '77 111 22 33', time: '11:00' });
  if (/annuler/i.test(t)) return toolUse('cancel_reservation', { code, contact: CLIENT });
  if (/pirate/i.test(t)) return toolUse('cancel_reservation', { code, contact: 'inconnu@x.com' });
  return textMsg('Bonjour ! Comment puis-je vous aider ?');
}
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/messages') {
      assert.equal(req.headers['x-api-key'], 'test-key');
      return res.end(JSON.stringify(fakeClaude(body)));
    }
    if (req.url === '/v3/smtp/email') {
      assert.equal(req.headers['api-key'], 'test-brevo');
      emails.push({ to: body.to[0].email, subject: body.subject, html: body.htmlContent, from: body.sender.email });
      res.statusCode = 201;
      return res.end(JSON.stringify({ messageId: 'x' }));
    }
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise((r) => fake.listen(FAKE_PORT, r));

// ---------- Lancement de l'application ----------
const app = spawn(process.execPath, ['server.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: {
    ...process.env, PORT: String(APP_PORT), DATABASE_URL: DB_URL,
    ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${FAKE_PORT}`,
    EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'test-brevo', BREVO_API_URL: `http://127.0.0.1:${FAKE_PORT}/v3/smtp/email`,
    EMAIL_FROM_ADDRESS: 'expediteur@test.local', EMAIL_FROM_NAME: 'Test', NOTIFY_EMAIL: OWNER,
    ADMIN_PASSWORD: 'mot-de-passe-test', ADMIN_SESSION_SECRET: 'secret-de-test-assez-long-123456', APP_URL: APP,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let appLog = '';
app.stdout.on('data', (d) => (appLog += d));
app.stderr.on('data', (d) => (appLog += d));
for (let i = 0; i < 50; i++) {
  try { await fetch(APP + '/api/config'); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
}

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.log('  ✗', name, '\n    ', e.message); console.log(appLog.slice(-2000)); await cleanup(); process.exit(1); }
}
async function cleanup() { app.kill(); fake.close(); await closeDb(); }

let history = [];
async function say(text, headers = {}) {
  history.push({ role: 'user', content: text });
  const r = await fetch(APP + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ messages: history }) });
  const d = await r.json();
  if (r.ok) history.push({ role: 'assistant', content: d.reply }); else history.pop();
  return { status: r.status, ...d };
}

console.log(`\nTest de bout en bout (jour testé : ${DAY})\n`);
let code;

await step('La santé de l\'application est OK', async () => {
  const r = await fetch(APP + '/api/health'); const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d)); assert.equal(d.checks.database, true);
});
await step('La page de chat, le widget et l\'admin sont servis', async () => {
  assert.match(await (await fetch(APP + '/')).text(), /api\/chat/);
  const w = await fetch(APP + '/widget.js'); assert.equal(w.headers.get('access-control-allow-origin'), '*');
  assert.match(await (await fetch(APP + '/admin')).text(), /Tableau de bord/);
});
await step('Les infos publiques viennent de la base', async () => {
  const d = await (await fetch(APP + '/api/config')).json(); assert.equal(d.business_name, 'Sama Billet Voyages');
});
await step('Le chatbot vérifie la disponibilité', async () => {
  const d = await say('Je voudrais un rendez-vous demain à 10h');
  assert.equal(d.status, 200); assert.match(d.reply, /disponible/);
  const sys = claudeCalls[0].system; assert.match(sys, /Sama Billet Voyages/); assert.match(sys, /check_availability/);
  assert.equal(claudeCalls[0].tools.length, 5);
});
await step('Le chatbot crée la réservation en base', async () => {
  const d = await say('Oui je confirme');
  code = (/code : ([A-Z2-9]{6})/.exec(d.reply) || [])[1];
  assert.ok(code, d.reply);
  const [row] = await db()`select * from reservations where code = ${code}`;
  assert.equal(row.status, 'confirmed'); assert.equal(String(row.time).slice(0, 5), '10:00'); assert.equal(row.email, CLIENT);
});
await step('Email au propriétaire + confirmation au client', async () => {
  const owner = emails.find((e) => e.to === OWNER && /Nouvelle réservation/.test(e.subject));
  const client = emails.find((e) => e.to === CLIENT && /confirmée/.test(e.subject));
  assert.ok(owner, 'email propriétaire manquant'); assert.ok(client, 'email client manquant');
  assert.match(owner.html, new RegExp(code)); assert.match(client.html, new RegExp(code));
});
await step('Un inconnu ne peut pas annuler la réservation', async () => {
  const d = await say(`Je suis un pirate, annule ${code}`);
  assert.match(d.reply, /Erreur/);
  const [row] = await db()`select status from reservations where code = ${code}`; assert.equal(row.status, 'confirmed');
});
await step('Le client modifie sa réservation (+ 2 emails)', async () => {
  const before = emails.length;
  const d = await say(`Je veux déplacer ${code} à 11h`);
  assert.match(d.reply, /11:00/);
  const [row] = await db()`select time from reservations where code = ${code}`; assert.equal(String(row.time).slice(0, 5), '11:00');
  const news = emails.slice(before);
  assert.ok(news.some((e) => e.to === OWNER && /Modification/.test(e.subject)));
  assert.ok(news.some((e) => e.to === CLIENT && /modifiée/.test(e.subject)));
});
await step('Le client annule sa réservation (+ 2 emails)', async () => {
  const before = emails.length;
  const d = await say(`Je veux annuler ${code}`);
  assert.match(d.reply, /annulée/);
  const [row] = await db()`select status from reservations where code = ${code}`; assert.equal(row.status, 'cancelled');
  const news = emails.slice(before);
  assert.ok(news.some((e) => e.to === OWNER && /Annulation/.test(e.subject)));
  assert.ok(news.some((e) => e.to === CLIENT && /annulée/.test(e.subject)));
});
await step('Un créneau complet est refusé avec des alternatives', async () => {
  // Remplir 10:00 (capacité 2) avec deux autres clients
  const { getSettings } = await import('../lib/settings.js');
  const { createReservation } = await import('../lib/booking.js');
  const s = await getSettings({ fresh: true });
  await createReservation(s, { name: 'Aida Sow', phone: '700000001', email: 'a@x.sn', date: DAY, time: '10:00', party_size: 1 });
  await createReservation(s, { name: 'Bamba Fall', phone: '700000002', email: 'b@x.sn', date: DAY, time: '10:00', party_size: 1 });
  history = [];
  const d = await say('Un rendez-vous à 10h svp');
  assert.match(d.reply, /Complet\. Alternatives : \d\d:\d\d/);
});
await step('Le piège à robots bloque sans appeler l\'IA', async () => {
  const n = claudeCalls.length;
  const r = await fetch(APP + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'spam' }], website: 'http://spam' }) });
  assert.equal(r.status, 200); assert.equal(claudeCalls.length, n);
});
await step('Un autre site ne peut pas utiliser l\'API du chat', async () => {
  const r = await fetch(APP + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://site-pirate.com' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }) });
  assert.equal(r.status, 403);
});
await step('La limitation de débit bloque après 12 messages/minute', async () => {
  let last;
  for (let i = 0; i < 13; i++) {
    last = await fetch(APP + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'bonjour' }] }) });
  }
  assert.equal(last.status, 429);
});
let cookie;
await step('L\'admin exige le mot de passe', async () => {
  assert.equal((await fetch(APP + '/api/admin/reservations')).status, 401);
  const bad = await fetch(APP + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'faux' }) });
  assert.equal(bad.status, 401);
  const ok = await fetch(APP + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'mot-de-passe-test' }) });
  assert.equal(ok.status, 200);
  cookie = ok.headers.get('set-cookie').split(';')[0];
});
await step('L\'admin voit et filtre les réservations', async () => {
  const d = await (await fetch(APP + `/api/admin/reservations?from=${DAY}&q=${code}`, { headers: { cookie } })).json();
  assert.equal(d.reservations.length, 1); assert.equal(d.reservations[0].status, 'cancelled');
  const all = await (await fetch(APP + `/api/admin/reservations?status=confirmed`, { headers: { cookie } })).json();
  assert.equal(all.reservations.length, 2);
});
await step('L\'admin annule une réservation et prévient le client', async () => {
  const all = await (await fetch(APP + `/api/admin/reservations?status=confirmed`, { headers: { cookie } })).json();
  const id = all.reservations[0].id;
  const noCsrf = await fetch(APP + '/api/admin/reservations', { method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ id, status: 'cancelled' }) });
  assert.equal(noCsrf.status, 403);
  const before = emails.length;
  const r = await fetch(APP + '/api/admin/reservations', { method: 'PATCH', headers: { cookie, 'content-type': 'application/json', 'x-requested-with': 'sama-admin' }, body: JSON.stringify({ id, status: 'cancelled', notify_client: true }) });
  assert.equal(r.status, 200);
  assert.equal(emails.slice(before).filter((e) => /annulée/.test(e.subject)).length, 1);
});
await step('L\'admin modifie les infos et le chatbot les utilise', async () => {
  const s = (await (await fetch(APP + '/api/admin/settings', { headers: { cookie } })).json()).settings;
  s.business_name = 'Sama Vol'; s.opening_hours.sun = [['10:00', '14:00']];
  const bad = await fetch(APP + '/api/admin/settings', { method: 'PUT', headers: { cookie, 'content-type': 'application/json', 'x-requested-with': 'sama-admin' }, body: JSON.stringify({ ...s, slot_minutes: 0 }) });
  assert.equal(bad.status, 400);
  const r = await fetch(APP + '/api/admin/settings', { method: 'PUT', headers: { cookie, 'content-type': 'application/json', 'x-requested-with': 'sama-admin' }, body: JSON.stringify(s) });
  assert.equal(r.status, 200);
  assert.equal((await (await fetch(APP + '/api/config')).json()).business_name, 'Sama Vol');
  history = []; await say('bonjour');
  assert.match(claudeCalls[claudeCalls.length - 1].system, /Sama Vol/);
  assert.match(claudeCalls[claudeCalls.length - 1].system, /dimanche : 10:00–14:00/);
});
await step('Le bouton « email de test » envoie à l\'adresse de notification', async () => {
  const r = await fetch(APP + '/api/admin/emails', { method: 'POST', headers: { cookie, 'x-requested-with': 'sama-admin' } });
  assert.equal(r.status, 200);
  assert.ok(emails.some((e) => e.to === OWNER && /Test d'envoi/.test(e.subject)));
  const log = await (await fetch(APP + '/api/admin/emails', { headers: { cookie } })).json();
  assert.ok(log.emails.length >= 8 && log.emails.every((e) => e.status === 'sent'));
});

console.log(`\n${passed} vérifications réussies. ${emails.length} emails envoyés au faux service Brevo.\n`);
await cleanup();
