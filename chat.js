import { handler, readJson, send, clientIp, sameOrigin } from '../lib/http.js';
import { getSettings } from '../lib/settings.js';
import { isLimited } from '../lib/ratelimit.js';
import { chat } from '../lib/ai.js';

const MAX_TURNS = 30;
const MAX_LEN = 1500;

export default handler(['POST'], async (req, res) => {
  if (!sameOrigin(req)) return send(res, 403, { error: 'Origine non autorisée' });
  const body = await readJson(req, 60_000);

  // Piège à robots : champ invisible pour les humains.
  if (body.website) return send(res, 200, { reply: 'Merci pour votre message.' });

  const history = Array.isArray(body.messages) ? body.messages : [];
  const clean = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, MAX_LEN) }))
    .slice(-MAX_TURNS);
  while (clean.length && clean[0].role !== 'user') clean.shift();
  if (!clean.length || clean[clean.length - 1].role !== 'user') return send(res, 400, { error: 'Message manquant' });
  if (history[history.length - 1]?.content?.length > 1000) return send(res, 400, { error: 'Message trop long (1000 caractères maximum).' });

  const ip = clientIp(req);
  if (await isLimited(`chat:min:${ip}`, 12, 60)) return send(res, 429, { error: 'Trop de messages. Patientez une minute.' });
  if (await isLimited(`chat:day:${ip}`, 200, 86400)) return send(res, 429, { error: 'Limite quotidienne atteinte. Contactez-nous par téléphone.' });
  const maxDaily = Number(process.env.MAX_DAILY_MESSAGES || 2000);
  if (await isLimited('chat:global:day', maxDaily, 86400)) return send(res, 503, { error: 'Le chat est très sollicité. Contactez-nous par téléphone.' });

  if (!process.env.ANTHROPIC_API_KEY) return send(res, 503, { error: "Le chat n'est pas encore configuré (clé API IA manquante)." });

  const settings = await getSettings();
  try {
    const { reply, events } = await chat(settings, clean, { ip });
    send(res, 200, { reply, events });
  } catch (e) {
    console.error('chat', e.message);
    send(res, 502, { error: `Le service est momentanément indisponible. Réessayez, ou appelez le ${settings.phone}.` });
  }
});
