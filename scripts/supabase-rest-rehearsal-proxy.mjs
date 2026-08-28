#!/usr/bin/env node

import http from "node:http";

const listenPort = Number(process.env.REHEARSAL_SUPABASE_REST_PROXY_PORT || 31870);
const upstream = new URL(String(process.env.REHEARSAL_POSTGREST_URL || "http://127.0.0.1:31869"));
if (!Number.isSafeInteger(listenPort) || listenPort < 1 || listenPort > 65_535) throw new Error("REHEARSAL_SUPABASE_REST_PROXY_PORT is invalid.");
if (upstream.protocol !== "http:" || !/^(127\.0\.0\.1|localhost)$/.test(upstream.hostname) || upstream.username || upstream.password || upstream.search || upstream.hash) {
  throw new Error("REHEARSAL_POSTGREST_URL must name a loopback HTTP PostgREST service without credentials.");
}

const server = http.createServer((req, res) => {
  const incoming = new URL(req.url || "/", `http://127.0.0.1:${listenPort}`);
  if (incoming.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end('{"ok":true,"scope":"isolated_rehearsal_supabase_rest_prefix"}\n');
    return;
  }
  if (incoming.pathname !== "/rest/v1" && !incoming.pathname.startsWith("/rest/v1/")) {
    res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
    res.end('{"message":"Not found"}\n');
    return;
  }
  const path = `${incoming.pathname.slice("/rest/v1".length) || "/"}${incoming.search}`;
  const upstreamRequest = http.request({
    hostname: upstream.hostname,
    port: Number(upstream.port || 80),
    method: req.method,
    path,
    headers: { ...req.headers, host: upstream.host },
  }, (upstreamResponse) => {
    res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(res);
  });
  upstreamRequest.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json", "cache-control": "no-store" });
    res.end('{"message":"Recovered PostgREST is unavailable"}\n');
  });
  req.pipe(upstreamRequest);
});

server.listen(listenPort, "127.0.0.1", () => {
  console.log(`Isolated Supabase REST prefix listening on 127.0.0.1:${listenPort}`);
});

function shutdown() {
  server.close((error) => {
    if (error) process.exitCode = 1;
  });
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
