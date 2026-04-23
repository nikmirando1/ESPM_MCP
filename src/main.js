#!/usr/bin/env node

/**
 * ESPM MCP Server — unified entry point.
 *
 * Usage:
 *   node src/main.js [stdio|http] [--port <n>] [--host <h>]
 *
 * Transport defaults to `stdio` when omitted.
 * --port and --host are only used for the http transport.
 *
 * https://github.com/nikmirando1/ESPM_MCP
 */

import { createEspmServer } from "./server.js";

const args = process.argv.slice(2);
const transport = args.find((a) => !a.startsWith("--")) ?? "stdio";

function flag(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

if (transport === "stdio") {
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  const server = createEspmServer();
  await server.connect(new StdioServerTransport());
} else if (transport === "http") {
  const { createServer } = await import("node:http");
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );

  const port = Number(flag("port", process.env.MCP_HTTP_PORT ?? "3000"));
  const host = flag("host", process.env.MCP_HTTP_HOST ?? "127.0.0.1");

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
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
  }

  const httpServer = createServer(async (req, res) => {
    const url = (req.url || "").split("?")[0];
    if (url !== "/mcp") {
      writeJsonRpcError(res, 404, -32601, "Not found");
      return;
    }
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
    const mcpTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      mcpTransport.close();
      server.close();
    });
    try {
      await server.connect(mcpTransport);
      await mcpTransport.handleRequest(req, res, body);
    } catch (err) {
      console.error("ESPM MCP HTTP request failed:", err);
      if (!res.headersSent) {
        writeJsonRpcError(res, 500, -32603, "Internal error");
      }
    }
  });

  httpServer.listen(port, host, () => {
    console.error(`ESPM MCP HTTP server listening on http://${host}:${port}/mcp`);
  });
} else {
  console.error(`Unknown transport "${transport}". Choose: stdio, http`);
  process.exit(1);
}
