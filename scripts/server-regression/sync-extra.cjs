const fs = require("fs"),
  path = require("path");
const rq = require("module").createRequire(
  require("node:path").resolve(__dirname, "../../package.json"),
);
const { io } = rq("socket.io-client");
const base = process.env.ZVIEWER_TEST_BASE,
  sockets = [],
  rs = { checks: [], rooms: [] };
const wait = (n) => new Promise((r) => setTimeout(r, n));
function ck(name, ok, actual) {
  rs.checks.push({ name, passed: !!ok, actual });
  console.log(
    ok ? "PASS" : "FAIL",
    name,
    JSON.stringify(actual ?? "").slice(0, 1200),
  );
}
async function http(method, p, b, t) {
  const r = await fetch(base + p, {
    method,
    headers: {
      ...(b === undefined ? {} : { "Content-Type": "application/json" }),
      ...(t ? { Authorization: "Bearer " + t } : {}),
    },
    body: b === undefined ? undefined : JSON.stringify(b),
  });
  let data;
  try {
    data = await r.json();
  } catch {
    data = {};
  }
  return { status: r.status, data };
}
async function login(u, p = "RtAudit_20261019!") {
  return (await http("POST", "/api/auth/login", { username: u, password: p }))
    .data;
}
async function conn(t) {
  const s = io(base, {
    transports: ["websocket"],
    auth: { token: t },
    forceNew: true,
    reconnection: false,
  });
  s.ev = [];
  s.onAny((event, ...args) => s.ev.push({ event, args }));
  await new Promise((r, j) => {
    s.once("connect", r);
    s.once("connect_error", j);
  });
  sockets.push(s);
  return s;
}
const ack = (s, e, p) =>
  new Promise((r) => {
    const tm = setTimeout(() => r({ timeout: true }), 3000);
    const cb = (x) => {
      clearTimeout(tm);
      r(x);
    };
    if (p === undefined) s.emit(e, cb);
    else s.emit(e, p, cb);
  });
async function create(s, name, p = {}) {
  const x = await ack(s, "create-room", {
    name: "RT extra " + name,
    mode: "watch-together",
    ...p,
  });
  if (!x.success) throw Error(JSON.stringify(x));
  rs.rooms.push(x.data.roomId);
  return x.data.roomId;
}
async function main() {
  const root = await login("root", "root"),
    a = await login("rt_a"),
    b = await login("rt_b"),
    c = await login("rt_c");
  const h = await conn(a.accessToken),
    v = await conn(b.accessToken),
    o = await conn(c.accessToken);
  const rid = await create(h, "sync");
  await ack(v, "request-join", { roomId: rid });
  let r = await ack(v, "viewer-ready", { roomId: rid });
  ck(
    "viewer-ready reaches host",
    r.success &&
      h.ev.some((x) => x.event === "viewer-ready" && x.args[0].from === v.id),
    r,
  );
  r = await ack(h, "sharer-ready", { roomId: rid });
  ck(
    "sharer-ready reaches viewer",
    r.success && v.ev.some((x) => x.event === "sharer-ready"),
    r,
  );
  r = await ack(v, "sharer-ready", { roomId: rid });
  ck("viewer cannot spoof sharer-ready", r.success === false, r);
  r = await ack(h, "sharer-error", {
    roomId: rid,
    message: "Audit expected screen capture failure",
  });
  ck(
    "screen capture error relayed",
    r.success && v.ev.some((x) => x.event === "sharer-error"),
    r,
  );
  const subtitle = {
    roomId: rid,
    tracks: [{ id: "audit-sub", label: "Audit subtitle" }],
    cues: [{ start: 0, end: 5, text: "Private subtitle fixture" }],
    selectedTrack: 0,
    enabled: true,
  };
  r = await ack(h, "subtitle-update", subtitle);
  ck(
    "host subtitle sent to viewer",
    r.success && v.ev.some((x) => x.event === "subtitle-update"),
    r,
  );
  r = await ack(v, "subtitle-update", subtitle);
  ck("viewer cannot overwrite subtitle", r.success === false, r);
  o.emit("subtitle-request", { roomId: rid });
  await wait(80);
  ck(
    "outsider cannot pull cached subtitle",
    !o.ev.some((x) => x.event === "subtitle-update"),
    { leakedSubtitle: o.ev.filter((x) => x.event === "subtitle-update") },
  );
  const late = await conn(c.accessToken);
  await ack(late, "request-join", { roomId: rid });
  ck(
    "late viewer gets cached subtitle",
    late.ev.some(
      (x) =>
        x.event === "subtitle-update" &&
        x.args[0].cues?.[0]?.text === "Private subtitle fixture",
    ),
    {},
  );
  r = await ack(h, "track-change", { roomId: rid, type: "subtitle", value: 0 });
  ck(
    "track selection relayed",
    r.success &&
      v.ev.some(
        (x) => x.event === "track-change" && x.args[0].type === "subtitle",
      ),
    r,
  );
  for (const kind of ["seek", "pause", "play"]) {
    r = await ack(v, kind + "-request", { roomId: rid, time: 50 });
    ck(
      kind + " control request reaches host",
      r.success &&
        h.ev.some(
          (x) =>
            x.event === kind + "-request" && x.args[0].viewerSocketId === v.id,
        ),
      r,
    );
    r = await ack(h, kind + "-response", {
      roomId: rid,
      viewerSocketId: v.id,
      accept: true,
      time: 50,
    });
    ck(
      kind + " control response reaches viewer",
      r.success &&
        v.ev.some(
          (x) => x.event === kind + "-response" && x.args[0].accept === true,
        ),
      r,
    );
  }
  const state = {
    sourceUrl: base + "/fixture.mp4",
    sourceType: "url",
    isPlaying: true,
    currentTime: 10,
    playbackRate: 1,
    duration: 100,
  };
  await ack(h, "watch-together-state", {
    roomId: rid,
    state,
    seq: 1,
    clientTs: Date.now(),
  });
  r = await ack(h, "host-heartbeat", {
    roomId: rid,
    currentTime: 25,
    isPlaying: false,
    playbackRate: 1,
    suppressed: false,
    clientTs: Date.now(),
  });
  ck("host heartbeat accepted", r.success, r);
  r = await ack(v, "watch-together-request-state", { roomId: rid });
  ck(
    "host heartbeat updates server baseline",
    r.data?.state?.isPlaying === false && r.data.state.currentTime === 25,
    r,
  );
  await wait(2200);
  ck(
    "server authoritative heartbeat reaches viewer",
    v.ev.some(
      (x) => x.event === "sync-heartbeat" && x.args[0].source === "server",
    ),
    v.ev
      .filter((x) => x.event === "sync-heartbeat")
      .map((x) => ({
        source: x.args[0].source,
        hostOnline: x.args[0].hostOnline,
      })),
  );
  r = await ack(h, "host-leave");
  await wait(6100);
  const hb = v.ev
    .filter(
      (x) => x.event === "sync-heartbeat" && x.args[0].source === "server",
    )
    .at(-1)?.args[0];
  ck(
    "server heartbeat reflects host offline after cache window",
    hb?.hostOnline === false,
    hb,
  );
  const rh = await conn(a.accessToken);
  await ack(rh, "register-host", { roomId: rid });
  r = await ack(rh, "kick-viewer", { roomId: rid, viewerSocketId: v.id });
  await wait(80);
  ck(
    "kicked viewer receives notification and is disconnected",
    r.success &&
      v.ev.some((x) => x.event === "viewer-kicked") &&
      v.connected === false,
    r,
  );
  const newReg = await http("POST", "/api/auth/register", {
    username: "rt_revocation",
    password: "RtAudit_20261019!",
  });
  if (newReg.status === 201)
    await http(
      "POST",
      `/api/admin/users/${newReg.data.user.id}/approve`,
      {},
      root.accessToken,
    );
  const rev = await login("rt_revocation");
  await wait(1100);
  r = await http(
    "PATCH",
    "/api/auth/password",
    {
      oldPassword: "RtAudit_20261019!",
      newPassword: "RtAudit_changed_20261019!",
    },
    rev.accessToken,
  );
  ck("temporary user changes password", r.status === 200, { status: r.status });
  r = await http("GET", "/api/auth/me", undefined, rev.accessToken);
  ck(
    "old access token rejected by HTTP after password change",
    r.status === 401 || r.status === 403,
    { status: r.status, message: r.data.message },
  );
  let oldSocketAccepted = false,
    revHost;
  try {
    revHost = await conn(rev.accessToken);
    oldSocketAccepted = true;
  } catch {}
  ck(
    "old access token rejected by new Socket.IO connection",
    !oldSocketAccepted,
    { oldSocketAccepted },
  );
  if (revHost) {
    r = await ack(revHost, "create-room", { name: "RT revoked-token room" });
    if (r.success) rs.rooms.push(r.data.roomId);
    ck(
      "revoked access token cannot create socket room",
      r.success === false,
      r,
    );
  }
  await http(
    "DELETE",
    `/api/admin/users/${rev.user.id}`,
    undefined,
    root.accessToken,
  );
  for (const roomId of rs.rooms)
    await http(
      "DELETE",
      `/api/admin/rooms/${roomId}`,
      undefined,
      root.accessToken,
    );
}
main()
  .catch((e) => {
    rs.error = e.stack;
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const s of sockets) s.disconnect();
    rs.totals = {
      passed: rs.checks.filter((x) => x.passed).length,
      failed: rs.checks.filter((x) => !x.passed).length,
    };
    fs.writeFileSync(
      path.join(process.env.ZVIEWER_TEST_OUTPUT, "sync-extra-results.json"),
      JSON.stringify(rs, null, 2),
    );
    if (rs.error || rs.totals.failed) process.exitCode = 1;
    console.log("TOTALS", rs.totals);
  });
