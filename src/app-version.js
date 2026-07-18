export const APP_VERSION = "release-2026.07.18.custodial-v3.1";
export const RELEASE_ID = String(
  process.env.RENDER_GIT_COMMIT
    || process.env.GIT_COMMIT
    || process.env.SOURCE_VERSION
    || APP_VERSION
).trim() || APP_VERSION;
