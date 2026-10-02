import { feedbackRelaySchemas, callFeedbackRelay } from '../feedback-email-relay.js';
import { registerMcpTool } from './register.js';
import { jsonResponse } from './responses.js';

export function registerFeedbackRelayTools(server, { includeWrites = true, client } = {}) {
  // Status is also private privileged activity. No read-only/anonymous catalog.
  if (!includeWrites) return;
  for (const [verb, schema] of Object.entries(feedbackRelaySchemas)) {
    registerMcpTool(server, `custodial_feedback_relay_${verb}`, {
      description: `Private Feedback ${verb} operation (custodial-feedback-relay.v2). Durable queue boundary with authenticated preflight observations; transport starts paused. This tool never sends email.`,
      inputSchema: schema,
    }, async (args, extra) => jsonResponse(await callFeedbackRelay(verb, args, extra, { client })));
  }
}
