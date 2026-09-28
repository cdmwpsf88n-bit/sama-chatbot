import postgres from 'postgres';
import { SCHEMA_SQL } from './schema.js';

let sql = null;
let schemaReady = null;

function isLocal(url) {
  return /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
}

/** Connexion unique réutilisée entre les requêtes. */
export function db() {
  if (sql) return sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquant : ajoutez-le dans les variables d\'environnement.');
  sql = postgres(url, {
    // Le "transaction pooler" de Supabase ne supporte pas les requêtes préparées.
    prepare: false,
    max: process.env.VERCEL ? 1 : 5,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: isLocal(url) ? false : 'require',
    onnotice: () => {},
    types: {
      // Garder les dates et heures en texte ("2026-10-03", "10:30:00") : pas de décalage de fuseau.
      date: { to: 1082, from: [1082], serialize: (x) => x, parse: (x) => x },
    },
  });
  return sql;
}

/** Crée les tables si elles n'existent pas encore (une fois par instance). */
export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = db().unsafe(SCHEMA_SQL).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export async function closeDb() {
  if (sql) {
    await sql.end({ timeout: 5 });
    sql = null;
    schemaReady = null;
  }
}
