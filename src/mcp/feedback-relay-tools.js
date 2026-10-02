import { feedbackRelaySchemas, callFeedbackRelay } from '../feedback-email-relay.js';
import { registerMcpTool } from './register.js';
import { jsonResponse } from './responses.js';

export function registerFeedbackRelayTools(server, { includeWrites = true, client } = {}) {
  // Status is also private privileged activity. No read-only/anonymous catalog.
  if (!includeWrites) return;
  for (const [verb, schema] of Object.entries(feedbackRelaySchemas)) {
    registerMcpTool(server, `custodial_feedback_relay_${verb}`, {
      description: `Private Feedback ${verb} operation. Non-sending durable queue boundary; transport starts paused.`,
      inputSchema: schema,
    }, async (args, extra) => jsonResponse(await callFeedbackRelay(verb, args, extra, { client })));
  }
}
