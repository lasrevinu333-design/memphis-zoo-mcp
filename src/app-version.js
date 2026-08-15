export const APP_VERSION = "release-2026.07.19.custodial-v3.12";
export const RELEASE_ID = APP_VERSION;
export const DEPLOYMENT_COMMIT_SHA = String(
  process.env.RENDER_GIT_COMMIT
    || process.env.GIT_COMMIT
    || process.env.SOURCE_VERSION
    || "unknown"
).trim() || "unknown";
