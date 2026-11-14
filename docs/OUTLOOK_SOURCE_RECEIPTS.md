# Protected Outlook source binding readback

The existing privileged `custodial_outlook_events_sync` **status** action can
optionally read an exact persisted source binding. This closes the normal
collector's inability to reconcile already-imported school documents, forwarded
copies, ended events and durable review records without replaying a writer.
It adds no tool, scope, credential, grant, SQL/RPC, HTTP route or scheduler.
Both `mcp:read` and `mcp:write` remain required, as for the existing status tool.

Use `contract_version: "custodial.outlook-event-sync-adapter.v1"` and one of:

```json
{"action":"status","observation":{"source_receipt":{"kind":"school_attachment","original_source_read":true,"attachment_read_complete":true,"attachment_sha256":"<actual raw XLSX SHA256>"}}}
```

```json
{"action":"status","observation":{"source_receipt":{"kind":"event_notice","original_source_read":true,"message_id":"<exact original Outlook message ID>"}}}
```

```json
{"action":"status","observation":{"source_receipt":{"kind":"event_key","original_source_read":true,"source_event_key":"<already-established unprefixed event key>"}}}
```

The declarations describe the authenticated connected agent's observations;
they are not Microsoft attestations. Read the actual original first. For an
event-key lookup, use the existing genuine booking, single-party document or
previously verified source identity. This lookup does not authorize merging
parties by names, dates, times, filenames or subject lines. It accepts equality
on one established key, never a caller-selected namespace or free-text search.
`include_public_feed:true` may accompany the selector; the existing safe public
projection remains a separate field and receives no private metadata.

Ordinary status `{}` and the existing public-only selector retain their response
shape and read behavior. No selector is accepted on a write or checkpoint.

## Output and limits

`source_receipt` uses `custodial.outlook-source-receipt.v1`. A complete bounded
lookup returns `found` or `not_found`. Failed, malformed, truncated, over-limit,
expired or cancelled reads never become an authoritative empty result. The
existing imported-mail limits remain 10,000 rows and 8 MiB; canonical event
projection retains its existing 500-event boundary. All reads share the
existing ten-second caller deadline and original-principal/expiry/scope fence.
Canonical SQL retains the existing dedicated reader's statement timeout; a
cancelled caller gets no late receipt, not a promise that an in-flight SQL
statement was physically cancelled immediately.

Only allowlisted receipt metadata leaves the protected reader: stored source
IDs/timestamps/digests, ledger identity/state, attachment identity/hash and date
scope for schools, and bound event identity for formal observations. It returns
no raw observation, rows, headers, mail body, subject, recipient, review reason,
generic event notes, private native access note or credentials.

School records are revalidated through the existing canonical payload digest
and source-key checks. Exact raw workbook bytes can identify a stored original
whose message/attachment ID differs from a forwarded copy. The returned IDs
belong to the stored original: fetch and verify that original through Outlook;
do not claim the copy and original are the same message.

Formal records validate the exact protected namespace, original message or
established key, stored observation schema, receipt state and source identity.
Their SQL-generated payload digest is reported as stored; the reader does not
claim to have recomputed PostgreSQL's JSONB text digest or recreated an original
write-call receipt. `NEEDS_REVIEW`, `BLOCKED_MANUAL` and null event bindings retain
their actual meaning. A durable staged observation is not a published event.

For returned bound event IDs only, the reader reuses the canonical event SQL,
place authority and safe operational projection/audience exclusions. It can
show current stored metadata for an ended event without adding ended events
back to the active public feed. Missing or withheld IDs remain explicit.
Source records and mutable current event data are separate protected reads,
not an atomic cross-table snapshot. Neither this historical metadata nor the
receipt alone verifies current public-feed visibility.

`not_found` is limited to the exact selector. It neither proves global absence
nor instructs a replay. Reconcile current source/copies/history through supported
controls; do not manufacture an import just to obtain a receipt. All original
source, cancellation, restore, revision, uncertainty and denial guards remain.
The fixed false mailbox/collector certification labels stay false. A complete
source checkpoint still requires the actual bounded all-page source review and
qualified dispositions under the existing collector policy.

## Deployment and qualification

These source fixtures are not live admission, automatic collection, original
mail authentication or phone acceptance. Use the normal independent delta
review, exact signed backend deployment and actual protected readback. Refresh
the **existing** custom MCP connection's tool metadata after deployment and
verify the advertised selector; no new connection or permission grant is needed
merely to refresh metadata. Do not infer success from a catalog entry or local
SDK test. No app build/install, Fully setting or phone data operation is involved.
