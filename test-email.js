// Envoie un email de test à NOTIFY_EMAIL : npm run test:email

import fs from 'node:fs';
const envFile = new URL('../.env', import.meta.url);
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { getSettings } = await import('../lib/settings.js');
const { sendTestEmail } = await import('../lib/email.js');
const { closeDb } = await import('../lib/db.js');

const r = await sendTestEmail(await getSettings());
console.log(r.ok ? `Email envoyé à ${process.env.NOTIFY_EMAIL}. Vérifiez votre boîte (et les spams).` : `Échec : ${r.error}`);
await closeDb();
process.exitCode = r.ok ? 0 : 1;
