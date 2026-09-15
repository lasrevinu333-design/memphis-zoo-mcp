import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MCP_TOOL_MANIFEST, TOOL_SAFETY } from "./tool-manifest.js";

const serverToolAuth = new WeakMap();
const toolSafety = new Map(MCP_TOOL_MANIFEST.map((tool) => [tool.name, tool.safety]));

function cloneSecuritySchemes(schemes) {
  return Array.isArray(schemes)
    ? schemes.map((scheme) => ({ ...scheme, scopes: Array.isArray(scheme?.scopes) ? [...scheme.scopes] : scheme?.scopes }))
    : [];
}

export function configureMcpToolAuth(server, { securitySchemes = [], challenge = null } = {}) {
  serverToolAuth.set(server, {
    securitySchemes: cloneSecuritySchemes(securitySchemes),
    challenge: String(challenge || "").trim() || null,
    finalized: false,
  });
}

function toolIsReadOnly(name) {
  return toolSafety.get(name) === TOOL_SAFETY.READ;
}

function authErrorResult(challenge) {
  const result = {
    content: [{ type: "text", text: "Authentication required: no valid access token was provided." }],
    isError: true,
  };
  if (challenge) result._meta = { "mcp/www_authenticate": [challenge] };
  return result;
}

export function finalizeMcpToolAuth(server) {
  const configuredAuth = serverToolAuth.get(server);
  if (!configuredAuth || configuredAuth.finalized) return;
  configuredAuth.finalized = true;
  if (!configuredAuth.securitySchemes.length) return;

  // @modelcontextprotocol/sdk 1.30.0 accepts securitySchemes in registerTool
  // config but only serializes fields known to its current ToolSchema. Preserve
  // the required top-level field on the wire while retaining the documented
  // _meta compatibility mirror. Fail closed if that SDK seam changes.
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
  const configuredAuth = serverToolAuth.get(server) || {};
  const configuredSchemes = cloneSecuritySchemes(configuredAuth.securitySchemes ?? []);
  const defaultSchemes = toolIsReadOnly(name)
    ? configuredSchemes
    : configuredSchemes.filter((scheme) => scheme?.type !== "noauth");
  const securitySchemes = cloneSecuritySchemes(
    definition?.securitySchemes ?? defaultSchemes,
  );
  const meta = { ...(definition?._meta || {}) };
  if (securitySchemes.length) meta.securitySchemes = cloneSecuritySchemes(securitySchemes);
  const allowsAnonymous = toolIsReadOnly(name)
    && securitySchemes.some((scheme) => scheme?.type === "noauth");
  const guardedHandler = !allowsAnonymous
    ? async (args, extra) => extra?.authInfo ? handler(args, extra) : authErrorResult(configuredAuth.challenge)
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
      guardedHandler
    );
  }

  if (typeof server.tool === "function") {
    if (securitySchemes.length || Object.keys(meta).length) {
      throw new Error("MCP tool authentication metadata requires registerTool support.");
    }
    if (description) return server.tool(name, description, inputSchema, handler);
    return server.tool(name, inputSchema, handler);
  }

  throw new Error("MCP server does not support registerTool or tool.");
}
