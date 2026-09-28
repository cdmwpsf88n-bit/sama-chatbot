import { db, ensureSchema } from './db.js';

/**
 * Compteur par clé et par fenêtre de temps, stocké en base
 * (fiable même avec plusieurs serveurs). Renvoie true si la limite est dépassée.
 */
export async function isLimited(key, limit, windowSeconds) {
  await ensureSchema();
  const sql = db();
  const [{ count }] = await sql`
    insert into rate_limits (key, window_start, count)
    values (${key}, to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds}), 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`;
  if (Math.random() < 0.02) {
    sql`delete from rate_limits where window_start < now() - interval '2 days'`.catch(() => {});
  }
  return count > limit;
}
