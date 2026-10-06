// Manager-only display projection. Never returns source mail, generic event
// notes, recipients, credentials or raw GPS payloads. No mutation endpoint.
const text = (v, max = 1000) => typeof v === 'string' ? v.trim().slice(0, max) : null;
const count = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
const instant = v => typeof v === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(v)
  && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const CODES = Object.freeze({trash_boxes:'Trash boxes requested', extra_cans:'Extra trash cans requested',
  restroom_checks:'Restroom checks requested'});
export function projectOperationsEvents(rows) {
  if (!Array.isArray(rows) || rows.length > 500) throw new Error('operations_events_invalid');
  return rows.filter(row => row && typeof row.id === 'string').map(row => ({
    id: row.id, revision: count(row.revision), name: text(row.event_name, 180),
    location: text(row.display_location || row.venue_name, 240), date: text(row.event_date, 10),
    end_date: text(row.end_date, 10), start_time: text(row.start_time, 8), end_time: text(row.end_time, 8),
    timezone: 'America/Chicago', start_at: instant(row.start_instant_utc), end_at: instant(row.end_instant_utc),
    attendees: count(row.attendee_count), status: text(row.status, 32),
    superseded_by: text(row.superseded_by_event_id, 80), needs_review: row.needs_review === true,
    // These fields are explicitly manager-approved custodial speech/display
    // fields in the existing Events contract. e.notes/source_text are excluded.
    custodial_notes: text(row.custodial_public_notes),
    requirements: [...new Set(Array.isArray(row.custodial_note_codes) ? row.custodial_note_codes : [])]
      .map(code => CODES[code]).filter(Boolean),
    updated_at: instant(row.updated_at),
  }));
}

export function makeOperationsBoardHandler({readEvents, readMail = null, now = () => new Date()} = {}) {
  if (typeof readEvents !== 'function') throw new Error('operations_event_reader_required');
  return async function operationsBoard(req, res) {
    // Route middleware remains the authority; this additionally prevents an
    // accidentally unguarded mounting from exposing the manager projection.
    if (req?.memphisAuth?.role !== 'ops_manager' || !req.memphisAuth.manager_id
      || !req.memphisAuth.credential_id) return res.status(403).json({ok:false,error:'Named manager required.'});
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const events = projectOperationsEvents(await readEvents());
      let mail=null;
      if(typeof readMail==='function')try{mail=await readMail();}catch{/* mail failure must not hide Events */}
      return res.status(200).json({ok:true,data:{schema:'custodial.operations-board.v1',
        generated_at:now().toISOString(),timezone:'America/Chicago',events,
        // Server-owned projection only. Imported snapshots do not assert
        // unattended mailbox completeness or freshness.
        schools:mail?.schools||{state:'unavailable',reason:'outlook_school_producer_not_bound',rows:[]},
        spiceworks:mail?.spiceworks||{state:'unavailable',reason:'outlook_spiceworks_producer_not_bound',rows:[]},
        staff_locations:{state:'unavailable',reason:'qualified_manager_location_projection_not_bound',rows:[]},
        school_departure_policy:{local_time:'13:00',timezone:'America/Chicago',source:'owner_policy'},
      }});
    } catch {
      return res.status(503).json({ok:false,error:'Operations event source unavailable.'});
    }
  };
}
