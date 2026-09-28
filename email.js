// Envoi d'emails via Brevo ou Resend (API HTTP, sans dépendance).
// Chaque envoi est enregistré dans la table email_log (visible dans l'admin).

import { db, ensureSchema } from './db.js';
import { formatDateFr, formatTimeFr } from './time.js';

function provider() {
  return (process.env.EMAIL_PROVIDER || 'brevo').toLowerCase();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function logEmail(entry) {
  try {
    await ensureSchema();
    await db()`insert into email_log (to_email, subject, kind, provider, status, error)
               values (${entry.to}, ${entry.subject}, ${entry.kind}, ${entry.provider}, ${entry.status}, ${entry.error || null})`;
  } catch (e) {
    console.error('email_log', e.message);
  }
}

/** Envoie un email. Ne lève jamais d'erreur : renvoie {ok, error}. */
export async function sendEmail({ to, subject, html, text, kind = 'other', replyTo }) {
  const p = provider();
  const fromAddress = process.env.EMAIL_FROM_ADDRESS;
  const fromName = process.env.EMAIL_FROM_NAME || 'Réservations';
  let error = null;
  try {
    if (!to) throw new Error('Destinataire manquant');
    if (p === 'console') {
      console.log(`[email:console] à ${to} — ${subject}\n${text}`);
    } else if (p === 'brevo') {
      if (!process.env.BREVO_API_KEY) throw new Error('BREVO_API_KEY manquant');
      if (!fromAddress) throw new Error('EMAIL_FROM_ADDRESS manquant');
      const res = await fetch(process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: fromName, email: fromAddress },
          to: [{ email: to }],
          subject,
          htmlContent: html,
          textContent: text,
          ...(replyTo ? { replyTo: { email: replyTo } } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Brevo ${res.status} : ${(await res.text()).slice(0, 300)}`);
    } else if (p === 'resend') {
      if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY manquant');
      if (!fromAddress) throw new Error('EMAIL_FROM_ADDRESS manquant');
      const res = await fetch(process.env.RESEND_API_URL || 'https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: `${fromName} <${fromAddress}>`,
          to: [to],
          subject,
          html,
          text,
          ...(replyTo ? { reply_to: replyTo } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Resend ${res.status} : ${(await res.text()).slice(0, 300)}`);
    } else {
      throw new Error(`EMAIL_PROVIDER inconnu : ${p} (brevo, resend ou console)`);
    }
  } catch (e) {
    error = e.message;
    console.error('[email] échec', kind, to, error);
  }
  await logEmail({ to: to || '?', subject, kind, provider: p, status: error ? 'failed' : 'sent', error });
  return { ok: !error, error };
}

// ---------- Modèles d'emails ----------

function detailRows(r) {
  return [
    ['Code', r.code],
    ['Nom', r.name],
    ['Date', formatDateFr(r.date)],
    ['Heure', formatTimeFr(r.time)],
    ['Personnes', String(r.party_size)],
    ['Téléphone', r.phone],
    ['Email', r.email],
    ['Remarques', r.notes || '—'],
  ];
}

function layout(settings, title, intro, rows, footer = '') {
  const table = rows.map(([k, v]) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#5a6b68;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#13201e;font-weight:600">${esc(v)}</td></tr>`).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f2f5f4;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:#ffffff;border:1px solid #d4dedb;border-radius:12px;padding:24px">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#1f6f5c;margin-bottom:8px">${esc(settings.business_name)}</div>
    <h1 style="font-size:20px;margin:0 0 12px;color:#13201e">${esc(title)}</h1>
    <p style="font-size:15px;line-height:1.5;color:#13201e;margin:0 0 16px">${esc(intro)}</p>
    <table style="border-collapse:collapse;font-size:14px">${table}</table>
    ${footer ? `<p style="font-size:14px;line-height:1.5;color:#5a6b68;margin:16px 0 0">${footer}</p>` : ''}
  </div>
  <p style="font-size:12px;color:#5a6b68;text-align:center;margin-top:12px">${esc(settings.business_name)}${settings.address ? ' · ' + esc(settings.address) : ''}${settings.phone ? ' · ' + esc(settings.phone) : ''}</p>
</div></body></html>`;
  const text = [title, '', intro, '', ...rows.map(([k, v]) => `${k} : ${v}`), '', footer.replace(/<[^>]+>/g, '')].join('\n');
  return { html, text };
}

function adminLink() {
  const base = (process.env.APP_URL || '').replace(/\/$/, '');
  return base ? `<a href="${esc(base)}/admin" style="color:#1f6f5c">Ouvrir le tableau de bord</a>` : '';
}

function notifyAddress() {
  return process.env.NOTIFY_EMAIL;
}

/** Nouvelle réservation : email au propriétaire + confirmation au client. */
export async function sendNewReservationEmails(settings, r) {
  const owner = layout(settings, `Nouvelle réservation — ${formatDateFr(r.date)} à ${formatTimeFr(r.time)}`,
    `${r.name} a réservé (${settings.booking_label}) via le chatbot.`, detailRows(r), adminLink());
  const client = layout(settings, 'Votre réservation est confirmée',
    `Bonjour ${r.name}, votre ${settings.booking_label} est bien enregistré(e).`,
    detailRows(r).filter(([k]) => k !== 'Email'),
    `Gardez votre code <strong>${esc(r.code)}</strong> : il permet de modifier ou d'annuler votre réservation dans le chat, avec votre téléphone ou votre email.`);
  const [a, b] = await Promise.all([
    sendEmail({ to: notifyAddress(), subject: `Nouvelle réservation ${r.code} — ${r.name}`, ...owner, kind: 'owner_new', replyTo: r.email }),
    sendEmail({ to: r.email, subject: `Réservation confirmée — ${settings.business_name}`, ...client, kind: 'client_new' }),
  ]);
  return { owner: a, client: b };
}

export async function sendModifiedEmails(settings, before, after) {
  const change = `Avant : ${formatDateFr(before.date)} à ${formatTimeFr(before.time)}, ${before.party_size} pers.`;
  const owner = layout(settings, `Réservation modifiée — ${after.code}`, `${after.name} a modifié sa réservation. ${change}`, detailRows(after), adminLink());
  const client = layout(settings, 'Votre réservation a été modifiée',
    `Bonjour ${after.name}, voici votre réservation mise à jour. ${change}`,
    detailRows(after).filter(([k]) => k !== 'Email'));
  const [a, b] = await Promise.all([
    sendEmail({ to: notifyAddress(), subject: `Modification ${after.code} — ${after.name}`, ...owner, kind: 'owner_modified', replyTo: after.email }),
    sendEmail({ to: after.email, subject: `Réservation modifiée — ${settings.business_name}`, ...client, kind: 'client_modified' }),
  ]);
  return { owner: a, client: b };
}

export async function sendCancelledEmails(settings, r, { notifyOwner = true, notifyClient = true } = {}) {
  const jobs = [];
  if (notifyOwner) {
    const owner = layout(settings, `Réservation annulée — ${r.code}`, `${r.name} a annulé sa réservation.`, detailRows(r), adminLink());
    jobs.push(sendEmail({ to: notifyAddress(), subject: `Annulation ${r.code} — ${r.name}`, ...owner, kind: 'owner_cancelled', replyTo: r.email }));
  }
  if (notifyClient) {
    const client = layout(settings, 'Votre réservation est annulée',
      `Bonjour ${r.name}, votre réservation du ${formatDateFr(r.date)} à ${formatTimeFr(r.time)} est annulée.`,
      detailRows(r).filter(([k]) => k !== 'Email'),
      'Vous pouvez réserver à nouveau à tout moment dans le chat.');
    jobs.push(sendEmail({ to: r.email, subject: `Réservation annulée — ${settings.business_name}`, ...client, kind: 'client_cancelled' }));
  }
  return Promise.all(jobs);
}

export async function sendTestEmail(settings) {
  const { html, text } = layout(settings, 'Email de test', "Si vous lisez ceci, l'envoi d'emails fonctionne.", [
    ['Service', provider()],
    ['Expéditeur', process.env.EMAIL_FROM_ADDRESS || '—'],
    ['Destinataire', notifyAddress() || '—'],
  ]);
  return sendEmail({ to: notifyAddress(), subject: `Test d'envoi — ${settings.business_name}`, html, text, kind: 'test' });
}
