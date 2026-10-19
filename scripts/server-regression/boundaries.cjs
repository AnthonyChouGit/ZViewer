const fs = require("fs");
const path = require("path");
const rq = require("module").createRequire(
  require("node:path").resolve(__dirname, "../../package.json"),
);
const { io } = rq("socket.io-client");
const base = process.env.ZVIEWER_TEST_BASE,
  sockets = [],
  rs = { checks: [], rooms: [] };
const sleep = (x) => new Promise((r) => setTimeout(r, x));
function ck(name, ok, actual) {
  rs.checks.push({ name, passed: !!ok, actual });
  console.log(
    ok ? "PASS" : "FAIL",
    name,
    JSON.stringify(actual ?? "").slice(0, 1300),
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
    const tm = setTimeout(() => r({ timeout: true }), 3500);
    const cb = (x) => {
      clearTimeout(tm);
      r(x);
    };
    if (p === undefined) s.emit(e, cb);
    else s.emit(e, p, cb);
  });
async function create(s, name, p = {}) {
  const x = await ack(s, "create-room", {
    name: "RT boundary " + name,
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
  const g = (await http("POST", "/api/auth/guest", {})).data;
  const h = await conn(a.accessToken),
    o = await conn(c.accessToken),
    gg = await conn(g.accessToken);
  const rid = await create(h, "private", {
    requireApproval: true,
    password: "AuditPasswordOnly!",
  });
  let r = await ack(h, "add-movie", {
    roomId: rid,
    movie: {
      title: "private fixture",
      url: base + "/fixture.mp4",
      source: "webdav",
      serverUrl: base + "/dummy-webdav",
      username: "audit-mount-user",
      password: "audit-dummy-secret",
      path: "/fixture.mp4",
    },
  });
  ck("private fixture added", r.success, r);
  r = await ack(h, "send-comment", {
    roomId: rid,
    content: "Private room confidential audit comment",
  });
  ck("private comment added", r.success, r);
  r = await http("GET", `/api/rooms/${rid}/movies`, undefined, g.accessToken);
  ck("guest outside password room cannot read movies", r.status === 403, {
    status: r.status,
    movieCount: r.data.movies?.length,
    hasDummyMountPassword:
      r.data.movies?.[0]?.password === "audit-dummy-secret",
  });
  let x = await http(
    "POST",
    `/api/rooms/${rid}/danmaku-tracks`,
    {
      trackId: "audit-track",
      label: "Private track",
      source: "audit",
      items: [{ text: "private imported danmaku", time: 10 }],
    },
    root.accessToken,
  );
  ck("root creates danmaku track", x.status === 201, x);
  r = await http(
    "GET",
    `/api/rooms/${rid}/danmaku-tracks`,
    undefined,
    g.accessToken,
  );
  ck("guest outside password room cannot read tracks", r.status === 403, {
    status: r.status,
    tracks: r.data.tracks,
  });
  await ack(h, "send-danmaku", {
    roomId: rid,
    content: "private live danmaku",
    videoTime: 8,
  });
  r = await http(
    "GET",
    `/api/rooms/${rid}/danmaku-meta`,
    undefined,
    g.accessToken,
  );
  ck(
    "guest outside password room cannot read live danmaku",
    r.status === 403,
    r,
  );
  const voice = await http(
    "POST",
    "/api/voice/token",
    { roomId: rid },
    g.accessToken,
  );
  ck(
    "anonymous guest outside private room denied voice token",
    voice.status === 403,
    { status: voice.status },
  );
  const panelId = await create(await conn(a.accessToken), "approval panel", {
    requireApproval: true,
    maxViewers: 1,
  });
  r = await ack(gg, "join-room-panel", { roomId: panelId });
  ck(
    "unapproved guest cannot bypass approval through panel join",
    r.success === false,
    r,
  );
  r = await ack(gg, "request-movie-list", { roomId: panelId });
  ck(
    "unapproved panel cannot obtain full room membership",
    r.success === false,
    r,
  );
  const rooms = (await http("GET", "/api/rooms", undefined, root.accessToken))
    .data.rooms;
  ck(
    "panel window does not consume viewer capacity",
    rooms.find((x) => x.roomId === panelId).viewerCount === 0,
    rooms.find((x) => x.roomId === panelId),
  );
  const capHost = await conn(a.accessToken),
    cap = await create(capHost, "approval capacity", {
      requireApproval: true,
      maxViewers: 1,
    });
  const v1 = await conn(b.accessToken),
    v2 = await conn(c.accessToken);
  await ack(v1, "request-join", { roomId: cap });
  await ack(v2, "request-join", { roomId: cap });
  const a1 = await ack(capHost, "approve-join", { viewerSocketId: v1.id }),
    a2 = await ack(capHost, "approve-join", { viewerSocketId: v2.id });
  let capRooms = (await http("GET", "/api/rooms", undefined, root.accessToken))
    .data.rooms;
  ck(
    "approval checks capacity at admit time",
    capRooms.find((x) => x.roomId === cap).viewerCount <= 1,
    { a1, a2, room: capRooms.find((x) => x.roomId === cap) },
  );
  const mhost = await conn(a.accessToken),
    mid = await create(mhost, "music reopen", { mode: "listen-together" });
  let ms = {
    roomId: mid,
    trackSongId: 1001,
    trackKey: "ncm:1001",
    isPlaying: true,
    positionSec: 10,
    playMode: "sequence",
    updatedAt: Date.now(),
  };
  await ack(mhost, "music:sync-state", ms);
  await ack(mhost, "close-room");
  const reopen = await http(
    "POST",
    `/api/admin/rooms/${mid}/reopen`,
    {},
    root.accessToken,
  );
  const mh2 = await conn(a.accessToken);
  await ack(mh2, "register-host", { roomId: mid });
  r = await ack(mh2, "music:get-state", { roomId: mid });
  ck(
    "closing/reopening music room clears playback memory",
    r.syncState === null,
    { reopenStatus: reopen.status, state: r.syncState },
  );
  const invalidHost = await conn(a.accessToken);
  r = await ack(invalidHost, "create-room", {
    name: "RT invalid creation",
    mode: "watch-together",
    maxViewers: 0,
  });
  if (r.success) rs.rooms.push(r.data.roomId);
  ck("create-room rejects maxViewers zero", r.success === false, r);
  const iroom = r.data?.roomId;
  if (iroom) {
    const newViewer = await conn(b.accessToken);
    const join = await ack(newViewer, "request-join", { roomId: iroom });
    ck(
      "zero-capacity room blocks legitimate join (diagnostic)",
      join.success === false,
      join,
    );
  }
  const invalidModeHost = await conn(a.accessToken),
    im = await create(invalidModeHost, "invalid-mode");
  r = await ack(invalidModeHost, "update-room-mode", {
    roomId: im,
    mode: "invalid-mode",
  });
  ck("invalid room mode rejected", r.success === false, r);
  await http("DELETE", `/api/admin/rooms/${rid}`, undefined, root.accessToken);
  r = await http(
    "GET",
    `/api/rooms/${rid}/danmaku-tracks`,
    undefined,
    root.accessToken,
  );
  ck("room deletion removes danmaku tracks", r.status === 404, r);
  r = await http(
    "GET",
    `/api/rooms/${rid}/danmaku-meta`,
    undefined,
    root.accessToken,
  );
  ck("room deletion removes realtime danmaku records", r.status === 404, r);
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
      path.join(process.env.ZVIEWER_TEST_OUTPUT, "boundaries-results.json"),
      JSON.stringify(rs, null, 2),
    );
    if (rs.error || rs.totals.failed) process.exitCode = 1;
    console.log("TOTALS", rs.totals);
  });
