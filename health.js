import { handler, send } from '../lib/http.js';
import { db, ensureSchema } from '../lib/db.js';

// Vérification rapide : base de données joignable et configuration présente.
export default handler(['GET'], async (req, res) => {
  const checks = {
    database: false,
    ai_key: !!process.env.ANTHROPIC_API_KEY,
    email_provider: process.env.EMAIL_PROVIDER || 'brevo',
    email_key: !!(process.env.BREVO_API_KEY || process.env.RESEND_API_KEY || process.env.EMAIL_PROVIDER === 'console'),
    notify_email: !!process.env.NOTIFY_EMAIL,
    admin_password: !!process.env.ADMIN_PASSWORD,
  };
  try {
    await ensureSchema();
    await db()`select 1`;
    checks.database = true;
  } catch (e) {
    checks.database_error = e.message.slice(0, 200);
  }
  const ok = checks.database && checks.ai_key && checks.email_key && checks.notify_email && checks.admin_password;
  send(res, ok ? 200 : 503, { ok, checks });
});
