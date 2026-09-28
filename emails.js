import { handler, send } from '../../lib/http.js';
import { requireAdmin } from '../../lib/auth.js';
import { getSettings } from '../../lib/settings.js';
import { sendTestEmail } from '../../lib/email.js';
import { db, ensureSchema } from '../../lib/db.js';

// GET : derniers emails envoyés ; POST : envoyer un email de test à NOTIFY_EMAIL.
export default handler(['GET', 'POST'], async (req, res) => {
  requireAdmin(req);
  if (req.method === 'GET') {
    await ensureSchema();
    const rows = await db()`select to_email, subject, kind, provider, status, error, created_at from email_log order by id desc limit 50`;
    return send(res, 200, { emails: rows });
  }
  const result = await sendTestEmail(await getSettings());
  send(res, result.ok ? 200 : 502, result.ok
    ? { ok: true, message: `Email de test envoyé à ${process.env.NOTIFY_EMAIL}.` }
    : { ok: false, error: `Échec de l'envoi : ${result.error}` });
});
