// Runs against a disposable local database; never contacts an existing deployment.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const root = path.resolve(__dirname, "../..");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "zviewer-regression-"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const s = net.createServer().listen(0, "127.0.0.1");
  await once(s, "listening");
  const port = s.address().port;
  await new Promise((resolve) => s.close(resolve));
  return port;
}
function run(script, env, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [...args, path.join(__dirname, script)],
      {
        cwd: root,
        env,
        windowsHide: true,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${script}: exit ${code}`)),
    );
  });
}
(async () => {
  const port = await freePort();
  const env = {
    ...process.env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    HTTPS: "false",
    CONFIG_DIR: output,
    DATABASE_URL: path.join(output, "test.sqlite"),
    UPLOADS_DIR: path.join(output, "uploads"),
    AVATARS_DIR: path.join(output, "uploads/avatars"),
    MEDIA_DIR: path.join(output, "media"),
    JWT_ACCESS_SECRET: "local-regression-access-only",
    JWT_REFRESH_SECRET: "local-regression-refresh-only",
    LIVEKIT_EXTERNAL: "1",
    LIVEKIT_API_KEY: "test-key",
    LIVEKIT_API_SECRET: "test-secret-at-least-thirty-two-characters",
    STREAM_PUSH_ENABLED: "0",
    ZVIEWER_TEST_BASE: `http://127.0.0.1:${port}`,
    ZVIEWER_TEST_OUTPUT: output,
  };
  fs.mkdirSync(env.UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(env.UPLOADS_DIR, ".isolated-test"),
    "Do not migrate existing uploads.",
  );
  const server = spawn(
    process.execPath,
    [path.join(root, "backend/dist/index.js")],
    {
      cwd: output,
      env,
      windowsHide: true,
      stdio: [
        "ignore",
        fs.openSync(path.join(output, "server.log"), "a"),
        fs.openSync(path.join(output, "errors.log"), "a"),
      ],
    },
  );
  let exited = false;
  server.once("exit", () => {
    exited = true;
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 150 && !exited; attempt++) {
      try {
        ready = (await fetch(env.ZVIEWER_TEST_BASE + "/health")).ok;
      } catch {
        /* starting */
      }
      if (ready) break;
      await sleep(100);
    }
    if (!ready) throw new Error("Local regression server did not start");
    for (const script of ["audit.cjs", "boundaries.cjs", "sync-extra.cjs"])
      await run(script, env);
    await run("proxy.test.cjs", env, ["--test"]);
    // Service tests use another disposable database after the HTTP process stops.
    server.kill();
    await once(server, "exit");
    await run(
      "services.test.cjs",
      { ...env, DATABASE_URL: path.join(output, "services.sqlite") },
      ["--test"],
    );
    console.log(`Regression evidence: ${output}`);
  } finally {
    if (!exited) server.kill();
  }
})().catch((error) => {
  console.error(error);
  console.error(`Evidence: ${output}`);
  process.exitCode = 1;
});
