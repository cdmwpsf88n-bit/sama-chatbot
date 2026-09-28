// Connexion au tableau de bord : mot de passe unique + cookie signé.

import crypto from 'node:crypto';

const COOKIE = 'sb_admin';
const MAX_AGE = 7 * 24 * 3600; // 7 jours

function secret() {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (!process.env.ADMIN_PASSWORD) throw Object.assign(new Error('ADMIN_PASSWORD manquant'), { status: 503 });
  // Repli si le secret n'est pas défini : dérivé du mot de passe.
  return crypto.createHash('sha256').update('sama-admin:' + process.env.ADMIN_PASSWORD).digest('hex');
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function checkPassword(password) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw Object.assign(new Error("ADMIN_PASSWORD n'est pas configuré sur le serveur."), { status: 503 });
  return typeof password === 'string' && safeEqual(password, expected);
}

function isHttps(req) {
  return req.headers['x-forwarded-proto'] === 'https' || !!process.env.VERCEL;
}

export function sessionCookie(req) {
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  const value = `${exp}.${sign(exp)}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE}${isHttps(req) ? '; Secure' : ''}`;
}

export function clearCookie(req) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isHttps(req) ? '; Secure' : ''}`;
}

export function isAdmin(req) {
  const raw = String(req.headers.cookie || '');
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(raw);
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  try {
    return safeEqual(sig, sign(exp));
  } catch {
    return false;
  }
}

/** Bloque les requêtes non connectées ; exige un en-tête spécial pour les modifications (anti-CSRF). */
export function requireAdmin(req) {
  if (!isAdmin(req)) throw Object.assign(new Error('Non connecté'), { status: 401 });
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'sama-admin') {
    throw Object.assign(new Error('Requête refusée'), { status: 403 });
  }
}
