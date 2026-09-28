// Crée les tables et les réglages par défaut : npm run db:setup
// (facultatif : l'application le fait aussi toute seule au premier message)

import fs from 'node:fs';
const envFile = new URL('../.env', import.meta.url);
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { ensureSchema, closeDb } = await import('../lib/db.js');
const { getSettings } = await import('../lib/settings.js');

try {
  await ensureSchema();
  const s = await getSettings({ fresh: true });
  console.log(`Base de données prête. Entreprise : ${s.business_name}`);
} catch (e) {
  console.error('Échec :', e.message);
  process.exitCode = 1;
} finally {
  await closeDb();
}
