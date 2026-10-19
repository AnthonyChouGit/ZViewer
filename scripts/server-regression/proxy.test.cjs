// Audit-only local fixtures; no network targets outside 127.0.0.1.
const { createRequire } = require("node:module");
const req = createRequire(
  require("node:path").resolve(__dirname, "../../package.json"),
);
const express = req("express");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { gzipSync } = require("node:zlib");
const { proxyHttpUpstream } = req("./backend/dist/services/proxy/http-proxy");
async function listen(t, app) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}
async function proxy(t, originUrl, timeoutMs = 250) {
  const app = express();
  app.use((request, response) =>
    proxyHttpUpstream(request, response, {
      url: originUrl + request.path,
      timeoutMs,
      logTag: "audit",
      errorMessage: "upstream failed",
    }),
  );
  return listen(t, app);
}
test("upstream errors, ETag 304 and connection timeout preserve HTTP meaning", async (t) => {
  const app = express();
  const received = [];
  app.get("/error", (r, s) => s.status(403).send("upstream denied"));
  app.get("/etag", (r, s) => {
    received.push(r.headers);
    s.setHeader("ETag", '"fixture"');
    if (r.headers["if-none-match"] === '"fixture"') return s.status(304).end();
    s.send("body");
  });
  app.get("/timeout", () => {});
  const local = await proxy(t, await listen(t, app));
  const error = await fetch(local + "/error");
  assert.equal(error.status, 403);
  assert.equal(error.headers.get("content-length"), "0");
  assert.equal(await error.text(), "");
  const cached = await fetch(local + "/etag", {
    headers: { "If-None-Match": '"fixture"' },
  });
  assert.equal(cached.status, 304);
  assert.equal(cached.headers.get("etag"), '"fixture"');
  assert.equal(await cached.text(), "");
  const timeout = await fetch(local + "/timeout");
  assert.equal(timeout.status, 504);
  assert.equal((await timeout.json()).message, "上游请求超时");
});
test("compressed upstream body reaches client fully with valid Content-Length", async (t) => {
  const expected = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><text>' +
      "COMPRESSED_FIXTURE".repeat(500) +
      "</text></svg>",
  );
  const compressed = gzipSync(expected);
  const app = express();
  app.get("/image", (r, s) => {
    s.setHeader("Content-Encoding", "gzip");
    s.setHeader("Content-Type", "image/svg+xml");
    s.setHeader("Content-Length", String(compressed.length));
    s.end(compressed);
  });
  const local = await proxy(t, await listen(t, app));
  const response = await fetch(local + "/image");
  const actual = Buffer.from(await response.arrayBuffer());
  console.log(
    JSON.stringify({
      expected: expected.length,
      compressed: compressed.length,
      actual: actual.length,
      headers: Object.fromEntries(response.headers),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(
    actual.length,
    expected.length,
    "decompressed upstream body must not be truncated to compressed Content-Length",
  );
  assert.deepEqual(actual, expected);
});
