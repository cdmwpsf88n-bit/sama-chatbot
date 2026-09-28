import { handler, send } from '../lib/http.js';
import { getSettings } from '../lib/settings.js';

// Informations publiques pour la page de chat (aucune donnée sensible).
export default handler(['GET'], async (req, res) => {
  const s = await getSettings();
  send(res, 200, {
    business_name: s.business_name,
    welcome_message: s.welcome_message,
    languages: s.languages,
    phone: s.phone,
    address: s.address,
  }, { 'cache-control': 'public, max-age=60' });
});
