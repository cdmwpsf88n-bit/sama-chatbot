import { handler, readJson, send, queryOf } from '../../lib/http.js';
import { requireAdmin } from '../../lib/auth.js';
import { listReservations, adminSetStatus, BookingError } from '../../lib/booking.js';
import { getSettings } from '../../lib/settings.js';
import { sendCancelledEmails } from '../../lib/email.js';
import { nowIn } from '../../lib/time.js';

export default handler(['GET', 'PATCH'], async (req, res) => {
  requireAdmin(req);
  const settings = await getSettings();

  if (req.method === 'GET') {
    const q = queryOf(req);
    const rows = await listReservations({ from: q.from, to: q.to, status: q.status, q: q.q });
    return send(res, 200, { reservations: rows, today: nowIn(settings.timezone).date });
  }

  // PATCH { id, status, notify_client }
  const body = await readJson(req, 5_000);
  try {
    const r = await adminSetStatus(Number(body.id), String(body.status));
    if (body.status === 'cancelled' && body.notify_client) {
      await sendCancelledEmails(settings, r, { notifyOwner: false, notifyClient: true });
    }
    send(res, 200, { reservation: r });
  } catch (e) {
    if (e instanceof BookingError) return send(res, 400, { error: e.message });
    throw e;
  }
});
