import { readFile, writeFile } from 'node:fs/promises';

async function replaceExact(path, oldText, newText) {
  const source = await readFile(path, 'utf8');
  if (!source.includes(oldText)) throw new Error(`${path}: expected source block not found`);
  const next = source.replace(oldText, newText);
  if (next === source) throw new Error(`${path}: replacement did not change file`);
  await writeFile(path, next);
}

const path = 'src/manager-notifications.js';
await replaceExact(path,
`const PUSH_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";`,
`const PUSH_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const FIREBASE_READ_SCOPE = "https://www.googleapis.com/auth/firebase.readonly";
const TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";
const FIREBASE_MANAGEMENT_BASE = "https://firebase.googleapis.com/v1beta1";
const DEFAULT_ANDROID_PACKAGE = "org.memphiszoo.ops";
const DEFAULT_IOS_BUNDLE = "org.memphiszoo.ops";`);

await replaceExact(path,
`function createGoogleAssertion(account, now = Date.now()) {`,
`function createGoogleAssertion(account, scope = PUSH_SCOPE, now = Date.now()) {`);
await replaceExact(path,
`    scope: PUSH_SCOPE,`,
`    scope,`);
await replaceExact(path,
`  let oauth = null;
  let inFlight = false;`,
`  const oauthByScope = new Map();
  const clientConfigCache = new Map();
  let inFlight = false;`);

await replaceExact(path,
`  async function accessToken() {
    if (!account) throw Object.assign(new Error("Firebase push delivery is not configured."), { status: 503 });
    if (oauth?.token && oauth.expiresAt > Date.now() + 60_000) return oauth.token;
    const response = await fetch(TOKEN_AUDIENCE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: createGoogleAssertion(account) }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.access_token) throw new Error(payload?.error_description || \`Google OAuth returned HTTP \${response.status}.\`);
    oauth = { token: payload.access_token, expiresAt: Date.now() + int(payload.expires_in, 3600, 60, 7200) * 1000 };
    return oauth.token;
  }

  async function send(job, pushDevice) {
    const token = await accessToken();`,
`  async function accessToken(scope = PUSH_SCOPE) {
    if (!account) throw Object.assign(new Error("Firebase services are not configured."), { status: 503 });
    const cached = oauthByScope.get(scope);
    if (cached?.token && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const response = await fetch(TOKEN_AUDIENCE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: createGoogleAssertion(account, scope) }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.access_token) throw new Error(payload?.error_description || \`Google OAuth returned HTTP \${response.status}.\`);
    const value = { token: payload.access_token, expiresAt: Date.now() + int(payload.expires_in, 3600, 60, 7200) * 1000 };
    oauthByScope.set(scope, value);
    return value.token;
  }

  async function firebaseManagementRequest(pathname) {
    const token = await accessToken(FIREBASE_READ_SCOPE);
    const target = \`\${FIREBASE_MANAGEMENT_BASE}\${pathname.startsWith("/") ? pathname : "/" + pathname}\`;
    const response = await fetch(target, {
      headers: { Authorization: \`Bearer \${token}\`, Accept: "application/json" },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.error?.message || \`Firebase Management API returned HTTP \${response.status}.\`);
      error.status = response.status === 404 ? 404 : 502;
      throw error;
    }
    return payload || {};
  }

  async function getClientConfig(platform) {
    if (!account) throw Object.assign(new Error("Firebase client configuration is unavailable."), { status: 503 });
    const normalized = String(platform || "").trim().toLowerCase();
    if (!['android','ios'].includes(normalized)) throw Object.assign(new Error("Firebase client platform must be android or ios."), { status: 400 });
    const cached = clientConfigCache.get(normalized);
    if (cached?.expiresAt > Date.now()) return cached.value;
    const android = normalized === 'android';
    const collection = android ? 'androidApps' : 'iosApps';
    const matchField = android ? 'packageName' : 'bundleId';
    const expected = envText(env, android ? 'FIREBASE_ANDROID_PACKAGE' : 'FIREBASE_IOS_BUNDLE') || (android ? DEFAULT_ANDROID_PACKAGE : DEFAULT_IOS_BUNDLE);
    const list = await firebaseManagementRequest(\`/projects/\${encodeURIComponent(account.project_id)}/\${collection}?pageSize=100\`);
    const apps = Array.isArray(list.apps) ? list.apps : [];
    const firebaseApp = apps.find((item) => item?.state !== 'DELETED' && String(item?.[matchField] || '').trim() === expected);
    if (!firebaseApp?.name || !firebaseApp?.appId) throw Object.assign(new Error(\`No Firebase \${normalized} app is registered for \${expected}.\`), { status: 404 });
    const artifact = await firebaseManagementRequest(\`/\${firebaseApp.name}/config\`);
    const contentsBase64 = String(artifact?.configFileContents || '').trim();
    if (!contentsBase64) throw Object.assign(new Error(\`Firebase returned an empty \${normalized} client configuration.\`), { status: 502 });
    const value = {
      platform: normalized,
      project_id: account.project_id,
      app_id: firebaseApp.appId,
      app_resource: firebaseApp.name,
      package_or_bundle: expected,
      filename: String(artifact.configFilename || (android ? 'google-services.json' : 'GoogleService-Info.plist')),
      contents_base64: contentsBase64,
    };
    clientConfigCache.set(normalized, { value, expiresAt: Date.now() + 60 * 60 * 1000 });
    return value;
  }

  async function send(job, pushDevice) {
    const token = await accessToken(PUSH_SCOPE);`);

await replaceExact(path,
`  return { configured: Boolean(account), projectId: account?.project_id || null, sweep };`,
`  return { configured: Boolean(account), projectId: account?.project_id || null, getClientConfig, sweep };`);

await replaceExact(path,
`  app.get("/manager-notifications-api/health", (_req, res) => {
    res.status(db ? 200 : 503).json({
      ok: Boolean(db),
      manager_only: true,
      employee_kiosk_notifications: false,
      provider: "fcm",
      provider_configured: runtime.configured,
      project_id: runtime.projectId,
      defaults: { messages_enabled: true, event_reminders_enabled: false, due_soon_enabled: false, overdue_enabled: false },
    });
  });`,
`  app.get("/manager-notifications-api/health", (_req, res) => {
    res.status(db ? 200 : 503).json({
      ok: Boolean(db),
      manager_only: true,
      employee_kiosk_notifications: false,
      provider: "fcm",
      provider_configured: runtime.configured,
      project_id: runtime.projectId,
      client_config_artifacts: runtime.configured ? {
        android: "/manager-notifications-api/client-config/android",
        ios: "/manager-notifications-api/client-config/ios",
      } : null,
      defaults: { messages_enabled: true, event_reminders_enabled: false, due_soon_enabled: false, overdue_enabled: false },
    });
  });

  app.get("/manager-notifications-api/client-config/:platform", async (req, res) => {
    try {
      const config = await runtime.getClientConfig(req.params?.platform);
      const raw = Buffer.from(config.contents_base64, "base64");
      if (!raw.length) throw Object.assign(new Error("Firebase client configuration was empty."), { status: 502 });
      if (String(req.query?.format || "").toLowerCase() === "json") {
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.json({ ok: true, data: config });
        return;
      }
      res.setHeader("Content-Type", config.platform === "android" ? "application/json; charset=utf-8" : "application/x-plist; charset=utf-8");
      res.setHeader("Content-Disposition", \`attachment; filename="\${config.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"\`);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.status(200).send(raw);
    } catch (error) { fail(res, error, "Firebase client configuration could not be downloaded."); }
  });`);

console.log('Prepared Firebase client config artifact endpoints.');
