#!/usr/bin/env node

/**
 * ESPM MCP Server — HTTP entry.
 *
 * Starts a Streamable HTTP MCP endpoint at POST /mcp. Runs stateless: one
 * fresh Server + transport per request, no session IDs. Suitable for hosted
 * MCP clients or any client that speaks the Streamable HTTP transport.
 *
 * No built-in auth: binds to 127.0.0.1 by default. Put a reverse proxy in
 * front if you need auth or want to expose beyond localhost.
 */

import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createEspmServer } from "../server.js";

const port = Number(process.env.MCP_HTTP_PORT ?? 3000);
const host = process.env.MCP_HTTP_HOST ?? "127.0.0.1";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function writeJsonRpcError(res, status, code, message) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code, message },
      id: null,
    })
  );
}

const httpServer = createServer(async (req, res) => {
  const url = (req.url || "").split("?")[0];
  if (url !== "/mcp") {
    writeJsonRpcError(res, 404, -32601, "Not found");
    return;
  }
  // Stateless mode serves all JSON-RPC over POST; no GET/DELETE endpoints.
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    writeJsonRpcError(res, 405, -32000, "Method not allowed");
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    writeJsonRpcError(res, 400, -32700, "Parse error");
    return;
  }

  const server = createEspmServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error("ESPM MCP HTTP request failed:", err);
    if (!res.headersSent) {
      writeJsonRpcError(res, 500, -32603, "Internal error");
    }
  }
});

httpServer.listen(port, host, () => {
  // stderr: keep stdout clean as a general habit (not strictly required here).
  console.error(`ESPM MCP HTTP server listening on http://${host}:${port}/mcp`);
});
