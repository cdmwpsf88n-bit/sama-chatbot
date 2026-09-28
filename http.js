// Aides HTTP communes aux fonctions de l'API (Vercel et serveur Node).

export async function readJson(req, maxBytes = 100_000) {
  // Sur Vercel, le corps est déjà lu dans req.body.
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Requête trop volumineuse'), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

/** Refuse les requêtes envoyées depuis un autre site que le nôtre. */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function queryOf(req) {
  if (req.query) return req.query;
  return Object.fromEntries(new URL(req.url, 'http://x').searchParams);
}

/** Enveloppe commune : méthodes autorisées + erreurs propres. */
export function handler(methods, fn) {
  return async (req, res) => {
    if (!methods.includes(req.method)) return send(res, 405, { error: 'Méthode non autorisée' }, { allow: methods.join(', ') });
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof SyntaxError || e.statusCode === 400) return send(res, 400, { error: 'JSON invalide' });
      if (e.status) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: 'Erreur interne. Réessayez dans un instant.' });
    }
  };
}
