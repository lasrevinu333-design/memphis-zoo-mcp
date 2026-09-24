import { createStaticWeeklyProjectionRpcInput } from './static-weekly-schedule-database-adapter.js';
import { createStaticWeeklyLunchAuthorityDocument } from './static-weekly-lunch-authority-adapter.js';

// Run in the same isolated compiler preparation as the canonical projection.
// No submitted schedule or public HTTP payload is a lunch-authority source.
export function createStaticWeeklyProjectionWithLunchRpcInput(options) {
  const projection = createStaticWeeklyProjectionRpcInput(options);
  const authority = options.result.canonicalAuthority;
  // The verifier derives effective closing segments from the immutable source;
  // feeding its own derived rows back in would bypass/reapply that authority.
  const canonical = structuredClone(authority.compilerInput);
  canonical.exceptions = structuredClone(authority.overlayCompilerInput.exceptions);
  const version = canonical.version;
  delete canonical.version;
  const input = {
    ...canonical,
    serviceDate: canonical.serviceDate || authority.effectiveDate,
    timezone: options.result.timezone,
    versions: [version],
  };
  const lunchDocument = createStaticWeeklyLunchAuthorityDocument({
    input, result: options.result,
  });
  return { ...projection, lunchDocument };
}
