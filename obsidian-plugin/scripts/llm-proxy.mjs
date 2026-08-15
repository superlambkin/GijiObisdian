#!/usr/bin/env node
// Local HTTPS proxy for GijiObsidian LLM calls
// Obsidian (Electron) main-process fetch has been observed to fail with
// "Failed to fetch" for HTTPS POSTs to api.minimaxi.com, while curl / Node
// fetch succeed. This proxy accepts plain HTTP on localhost and forwards
// to the upstream HTTPS API, sidestepping the Electron fetch issue.
//
// 使い方:
//   1. このスクリプトを起動: node llm-proxy.mjs
//   2. GijiObsidian の LLM baseUrl を http://127.0.0.1:17891/anthropic に設定
//      （upstream の path が "/anthropic/v1/messages" になるため、
//        baseUrl には "/anthropic" を含める）
//
// 終了: Ctrl+C

import http from "node:http";
import https from "node:https";

const PORT = Number(process.env.GIJI_PROXY_PORT) || 17891;
const TARGET_HOST = process.env.GIJI_PROXY_TARGET || "api.minimaxi.com";

const server = http.createServer((req, res) => {
  const opts = {
    hostname: TARGET_HOST,
    port: 443,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: TARGET_HOST },
  };
  const proxyReq = https.request(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on("error", (e) => {
    console.error(`[proxy] upstream error: ${e.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(`Proxy error: ${e.message}`);
    }
  });
  req.pipe(proxyReq);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`✅ LLM proxy: http://127.0.0.1:${PORT} → https://${TARGET_HOST}`);
  console.log(`  GijiObsidian の LLM baseUrl に "http://127.0.0.1:${PORT}" を設定してください`);
});