// Named-manager, read-only projection of the private push queue. The route
// mount must apply makeOpsAccessMiddleware before this handler.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = Object.freeze({
  message: { label: 'Messenger activity', href: './messages.html?hub=manager' },
  event_digest: { label: 'Upcoming events reminder', href: './events.html' },
  location_digest: { label: 'Location attention', href: './dashboard.html' },
  lunch_delivery_failure: { label: 'Lunch alert delivery attention', href: null },
  test: { label: 'Phone notification test', href: null },
});
const STATES = Object.freeze({
  pending: 'Queued; no delivery confirmed',
  leased: 'Sending in progress; delivery outcome unknown',
  sent: 'Provider accepted; phone display and reading not verified',
  failed: 'Needs attention; delivery outcome may be uncertain',
  cancelled: 'Cancelled; any earlier delivery is not ruled out',
});
const SAFE_COLUMNS = 'queue_id,manager_id,notification_type,status,created_at,updated_at,available_at,sent_at';

function safeTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value)) ? value : null;
}

export function projectManagerNotificationHistory(rows, managerId) {
  if (!Array.isArray(rows) || rows.length > 101) throw new Error('Manager notification result is not bounded.');
  const expected = String(managerId || '').toLowerCase();
  return rows.map((row) => {
    if (!row || String(row.manager_id || '').toLowerCase() !== expected || !UUID.test(String(row.queue_id || ''))) {
      throw new Error('Manager notification identity mismatch.');
    }
    const type = Object.hasOwn(TYPES, row.notification_type)
      ? TYPES[row.notification_type] : { label: 'Notification type unavailable', href: null };
    const status = Object.hasOwn(STATES, row.status) ? row.status : 'unknown';
    return {
      queue_id: row.queue_id,
      notification_type: Object.hasOwn(TYPES, row.notification_type) ? row.notification_type : 'unknown',
      label: type.label,
      href: type.href,
      status,
      status_label: STATES[status] || 'Delivery state unavailable',
      created_at: safeTime(row.created_at),
      updated_at: safeTime(row.updated_at),
      available_at: safeTime(row.available_at),
      sent_at: status === 'sent' ? safeTime(row.sent_at) : null,
    };
  });
}

export function makeManagerNotificationHistoryHandler({ db }) {
  if (!db || typeof db.from !== 'function') throw new Error('A server-only database client is required.');
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const managerId = String(req.memphisAuth?.manager_id || '');
    const credentialId = String(req.memphisAuth?.credential_id || '');
    if (req.memphisAuth?.role !== 'ops_manager' || !UUID.test(managerId) || !UUID.test(credentialId)) {
      return res.status(403).json({ ok: false, error: 'A current named manager session is required.' });
    }
    if (req.query?.manager_id !== undefined || req.query?.credential_id !== undefined
      || req.body?.manager_id !== undefined || req.body?.credential_id !== undefined) {
      return res.status(422).json({ ok: false, error: 'Manager identity is taken from the authenticated session.' });
    }
    try {
      const result = await db.from('ops_manager_notification_queue')
        .select(SAFE_COLUMNS).eq('manager_id', managerId)
        .order('created_at', { ascending: false }).order('queue_id', { ascending: false }).limit(101);
      if (result.error) throw result.error;
      const projected = projectManagerNotificationHistory(result.data, managerId);
      return res.status(200).json({ ok: true, data: {
        manager_id: managerId,
        credential_id: credentialId,
        notifications: projected.slice(0, 100),
        truncated: projected.length > 100,
        limit: 100,
      } });
    } catch {
      return res.status(503).json({ ok: false, error: 'Notification history is unavailable. Please retry.' });
    }
  };
}
