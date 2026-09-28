import { handler, readJson, send, clientIp, sameOrigin } from '../../lib/http.js';
import { checkPassword, sessionCookie } from '../../lib/auth.js';
import { isLimited } from '../../lib/ratelimit.js';

export default handler(['POST'], async (req, res) => {
  if (!sameOrigin(req)) return send(res, 403, { error: 'Origine non autorisée' });
  const ip = clientIp(req);
  if (await isLimited(`login:${ip}`, 5, 900)) return send(res, 429, { error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
  const { password } = await readJson(req, 5_000);
  if (!checkPassword(password)) return send(res, 401, { error: 'Mot de passe incorrect.' });
  send(res, 200, { ok: true }, { 'set-cookie': sessionCookie(req) });
});
