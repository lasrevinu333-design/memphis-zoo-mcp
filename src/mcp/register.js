import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MCP_TOOL_MANIFEST, TOOL_SAFETY } from "./tool-manifest.js";

const serverToolAuth = new WeakMap();
const toolSafety = new Map(MCP_TOOL_MANIFEST.map((tool) => [tool.name, tool.safety]));
const anonymousTools = new Set(["ping", "server_connection_diagnostic"]);

function cloneSecuritySchemes(schemes) {
  return Array.isArray(schemes)
    ? schemes.map((scheme) => ({
        ...scheme,
        scopes: Array.isArray(scheme?.scopes) ? [...scheme.scopes] : scheme?.scopes,
      }))
    : [];
}

function requiredScopes(name) {
  if (anonymousTools.has(name)) return [];
  if (toolSafety.get(name) === TOOL_SAFETY.READ) return ["mcp:read"];
  // Unknown tools fail closed as privileged until deliberately classified.
  return ["mcp:read", "mcp:write"];
}

export function configureMcpToolAuth(server, { securitySchemes = [], challenge = null } = {}) {
  const cloned = cloneSecuritySchemes(securitySchemes);
  serverToolAuth.set(server, {
    noAuthEnabled: cloned.some((scheme) => scheme?.type === "noauth"),
    oauthEnabled: cloned.some((scheme) => scheme?.type === "oauth2"),
    challenge: String(challenge || "").trim() || null,
    finalized: false,
  });
}

function securitySchemesForTool(configuredAuth, scopes) {
  if (!scopes.length) return configuredAuth.noAuthEnabled ? [{ type: "noauth" }] : [];
  return configuredAuth.oauthEnabled ? [{ type: "oauth2", scopes: [...scopes] }] : [];
}

function scopedChallenge(challenge, scopes) {
  if (!challenge) return null;
  const scope = scopes.join(" ");
  if (/\bscope="[^"]*"/.test(challenge)) {
    return challenge.replace(/\bscope="[^"]*"/, `scope="${scope}"`);
  }
  return `${challenge}, scope="${scope}"`;
}

function authErrorResult(challenge, scopes) {
  const result = {
    content: [{
      type: "text",
      text: `OAuth authorization is required for this tool (${scopes.join(" ")}).`,
    }],
    isError: true,
  };
  const scoped = scopedChallenge(challenge, scopes);
  if (scoped) result._meta = { "mcp/www_authenticate": [scoped] };
  return result;
}

function authInfoAllows(extra, scopes) {
  const authInfo = extra?.authInfo;
  if (!authInfo) return false;
  if (authInfo?.extra?.authSource === "connector_token") return true;
  const granted = Array.isArray(authInfo.scopes) ? authInfo.scopes : [];
  return scopes.every((scope) => granted.includes(scope));
}

export function finalizeMcpToolAuth(server) {
  const configuredAuth = serverToolAuth.get(server);
  if (!configuredAuth || configuredAuth.finalized) return;
  configuredAuth.finalized = true;

  // @modelcontextprotocol/sdk 1.30.0 preserves extension metadata but does not
  // yet serialize the current top-level Tool.securitySchemes field. Keep the
  // exact 9fd0f099 instance-local wire projection and the _meta compatibility
  // mirror, failing closed if the SDK seam changes.
  const protocol = server?.server;
  const handlers = protocol?._requestHandlers;
  const listToolsHandler = handlers?.get?.("tools/list");
  if (!protocol?.setRequestHandler || typeof listToolsHandler !== "function") {
    throw new Error("Unable to publish MCP per-tool securitySchemes with the installed SDK.");
  }

  protocol.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const result = await listToolsHandler(request, extra);
    return {
      ...result,
      tools: (result?.tools || []).map((tool) => {
        const securitySchemes = cloneSecuritySchemes(tool?._meta?.securitySchemes);
        return securitySchemes.length ? { ...tool, securitySchemes } : tool;
      }),
    };
  });
}

export function registerMcpTool(server, name, definition, handler) {
  const title = definition?.title || name;
  const description = definition?.description || "";
  const inputSchema = definition?.inputSchema || {};
  const configuredAuth = serverToolAuth.get(server) || {
    noAuthEnabled: false,
    oauthEnabled: false,
    challenge: null,
  };
  const scopes = requiredScopes(name);
  const securitySchemes = cloneSecuritySchemes(
    definition?.securitySchemes ?? securitySchemesForTool(configuredAuth, scopes),
  );
  const meta = { ...(definition?._meta || {}) };
  if (securitySchemes.length) meta.securitySchemes = cloneSecuritySchemes(securitySchemes);
  const guardedHandler = scopes.length
    ? async (args, extra) => authInfoAllows(extra, scopes)
      ? handler(args, extra)
      : authErrorResult(configuredAuth.challenge, scopes)
    : handler;

  if (typeof server.registerTool === "function") {
    return server.registerTool(
      name,
      {
        title,
        description,
        inputSchema,
        ...(securitySchemes.length ? { securitySchemes } : {}),
        ...(Object.keys(meta).length ? { _meta: meta } : {}),
      },
      guardedHandler,
    );
  }

  if (typeof server.tool === "function") {
    if (securitySchemes.length || Object.keys(meta).length) {
      throw new Error("MCP tool authentication metadata requires registerTool support.");
    }
    if (description) return server.tool(name, description, inputSchema, guardedHandler);
    return server.tool(name, inputSchema, guardedHandler);
  }

  throw new Error("MCP server does not support registerTool or tool.");
}
