const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const requireSource = createRequire(
  require("node:path").resolve(__dirname, "../../package.json"),
);
const { io } = requireSource("socket.io-client");
const base = process.env.ZVIEWER_TEST_BASE;
const report = {
  date: new Date().toISOString(),
  base,
  checks: [],
  observations: [],
  rooms: [],
  totals: {},
};
const allSockets = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, condition, actual) {
  report.checks.push({ name, passed: !!condition, actual });
  console.log(
    `${condition ? "PASS" : "FAIL"} ${name}`,
    JSON.stringify(actual ?? "").slice(0, 900),
  );
}
async function http(method, route, body, token) {
  const res = await fetch(base + route, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text.slice(0, 1000);
  }
  return { status: res.status, data };
}
async function login(username, password = "RtAudit_20261019!") {
  const r = await http("POST", "/api/auth/login", { username, password });
  if (!r.data.accessToken)
    throw Error("Login failed " + username + " " + JSON.stringify(r));
  return { token: r.data.accessToken, user: r.data.user };
}
async function connect(token, extra = {}) {
  const s = io(base, {
    transports: ["websocket"],
    auth: { token },
    forceNew: true,
    reconnection: false,
    ...extra,
  });
  s.events = [];
  s.onAny((event, ...args) => s.events.push({ event, args }));
  await new Promise((resolve, reject) => {
    s.once("connect", resolve);
    s.once("connect_error", reject);
    setTimeout(() => reject(Error("connect timeout")), 5000).unref();
  });
  allSockets.push(s);
  return s;
}
function ack(s, event, payload) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timeout: true }), 3500);
    const cb = (r) => {
      clearTimeout(timer);
      resolve(r);
    };
    if (payload === undefined) s.emit(event, cb);
    else s.emit(event, payload, cb);
  });
}
function events(s, name) {
  return s.events.filter((x) => x.event === name).map((x) => x.args[0]);
}
async function rooms(token) {
  return (await http("GET", "/api/rooms", undefined, token)).data.rooms;
}
async function create(s, name, props = {}) {
  const r = await ack(s, "create-room", {
    name: "RT " + name,
    mode: "watch-together",
    ...props,
  });
  if (!r.success) throw Error("create " + JSON.stringify(r));
  report.rooms.push(r.data.roomId);
  return r.data.roomId;
}
async function main() {
  const root = await login("root", "root");
  let r = await http(
    "PUT",
    "/api/admin/settings",
    {
      roomCreationMode: "all-users",
      autoDeleteInactiveRooms: true,
      autoDeleteAfterHours: 24,
    },
    root.token,
  );
  check("settings permit registered room creators", r.data.success, r);
  const users = [];
  for (const name of ["rt_a", "rt_b", "rt_c", "rt_d"]) {
    let x = await http("POST", "/api/auth/register", {
      username: name,
      password: "RtAudit_20261019!",
    });
    if (x.status === 201) {
      check(
        name + " registration pending",
        x.data.user.status === "pending",
        x.data,
      );
      await http(
        "POST",
        `/api/admin/users/${x.data.user.id}/approve`,
        {},
        root.token,
      );
    }
    users.push(await login(name));
  }
  const [a, b, c, d] = users;
  const g1 = (await http("POST", "/api/auth/guest", {})).data;
  const g2 = (await http("POST", "/api/auth/guest", {})).data;
  const hs = await connect(a.token),
    vs = await connect(b.token),
    os = await connect(c.token),
    ds = await connect(d.token),
    gs1 = await connect(g1.accessToken),
    gs2 = await connect(g2.accessToken);
  const noAuth = io(base, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });
  const authError = await new Promise((res) => {
    noAuth.once("connect_error", (e) => res(e.message));
    setTimeout(() => res("timeout"), 3000).unref();
  });
  noAuth.disconnect();
  check(
    "unauthenticated Socket.IO refused",
    authError === "未提供认证令牌",
    authError,
  );
  r = await ack(gs1, "create-room", { name: "guest-room" });
  check("guest cannot create room", r.success === false, r);
  const rid = await create(hs, "main");
  r = await ack(vs, "request-join", { roomId: rid });
  check("viewer joins open room", r.success, r);
  const panel = await connect(b.token);
  r = await ack(panel, "join-room-panel", { roomId: rid });
  const panelRoom = (await rooms(root.token)).find(
    (room) => room.roomId === rid,
  );
  check(
    "admitted viewer panel joins without consuming another seat",
    r.success && panelRoom.viewerCount === 1,
    r,
  );
  panel.disconnect();

  r = await ack(os, "send-comment", { roomId: rid, content: "outsider" });
  check("outsider cannot comment", r.success === false, r);
  r = await ack(vs, "send-comment", {
    roomId: rid,
    content: " audit comment ",
  });
  check("viewer comment accepted", r.success, r);
  const hist = await ack(hs, "comment-history", { roomId: rid });
  check(
    "comment persisted and attributed",
    hist.comments?.some(
      (x) => x.username === "rt_b" && x.content === "audit comment",
    ),
    hist,
  );
  r = await ack(hs, "mute-viewer", { roomId: rid, userId: b.user.id });
  check("host mutes viewer", r.success, r);
  r = await ack(vs, "send-comment", { roomId: rid, content: "muted" });
  check("muted viewer cannot comment", r.success === false, r);
  r = await ack(vs, "send-danmaku", { roomId: rid, content: "muted" });
  check("muted viewer cannot danmaku", r.success === false, r);
  r = await ack(hs, "unmute-viewer", { roomId: rid, userId: b.user.id });
  check("host unmutes viewer", r.success, r);
  r = await ack(vs, "send-danmaku", {
    roomId: rid,
    content: "audit danmaku",
    videoTime: 5.25,
  });
  check("danmaku accepted", r.success, r);
  const meta = await http(
    "GET",
    `/api/rooms/${rid}/danmaku-meta`,
    undefined,
    a.token,
  );
  check(
    "danmaku persisted",
    meta.data.meta?.realtimeLog?.some(
      (x) => x.content === "audit danmaku" && x.time === 5.25,
    ),
    meta,
  );
  r = await ack(vs, "annotation-stroke", {
    roomId: rid,
    stroke: { id: "audit", type: "pen", points: [{ x: 0.1, y: 0.2 }] },
  });
  check("annotation broadcast accepted", r.success, r);
  r = await ack(vs, "clear-annotations", { roomId: rid });
  check("viewer cannot clear annotations", r.success === false, r);
  r = await ack(hs, "clear-annotations", { roomId: rid });
  check("host clears annotations", r.success, r);
  r = await ack(hs, "update-room-name", {
    roomId: rid,
    name: "RT renamed by ordinary owner",
  });
  check("ordinary user owner can rename via socket", r.success, r);
  r = await http(
    "PUT",
    `/api/rooms/${rid}/name`,
    { name: "RT REST renamed" },
    a.token,
  );
  check("ordinary user owner can rename via REST", r.status === 200, r);
  r = await http(
    "POST",
    `/api/rooms/${rid}/movies`,
    { title: "fixture movie", url: base + "/fixture.mp4", source: "url" },
    a.token,
  );
  check("ordinary user owner can add movie via REST", r.status === 201, r);
  r = await ack(hs, "add-movie", {
    roomId: rid,
    movie: {
      title: "fixture socket movie",
      url: base + "/fixture.mp4",
      source: "url",
    },
  });
  check("ordinary user owner can add movie via socket", r.success, r);
  const ml = await http("GET", `/api/rooms/${rid}/movies`, undefined, a.token);
  const mid = ml.data.movies?.[0]?.id;
  check("movie list HTTP available", mid > 0, ml);
  r = await ack(vs, "play-movie", { roomId: rid, movieId: mid });
  check(
    "viewer cannot change movie without permission",
    r.success === false,
    r,
  );
  r = await ack(hs, "play-movie", { roomId: rid, movieId: mid });
  check("host selects current movie", r.success, r);
  const st = {
    sourceUrl: base + "/fixture.mp4",
    sourceType: "url",
    isPlaying: true,
    currentTime: 15,
    playbackRate: 1.5,
    duration: 120,
  };
  r = await ack(hs, "watch-together-state", {
    roomId: rid,
    state: st,
    seq: 1,
    clientTs: Date.now(),
  });
  check(
    "watch state accepted and forwarded",
    r.success && events(vs, "watch-together-state").length > 0,
    r,
  );
  await sleep(1200);
  r = await ack(vs, "watch-together-request-state", { roomId: rid });
  check(
    "watch memory advances with playback rate",
    r.data?.state?.currentTime >= 16.5 && r.data?.state?.currentTime < 19,
    r,
  );
  r = await ack(vs, "watch-together-control", { roomId: rid, action: "pause" });
  check("viewer watch control rejected", r.success === false, r);
  r = await ack(hs, "watch-together-control", { roomId: rid, action: "pause" });
  check("host pauses playback", r.success, r);
  const paused1 = await ack(vs, "watch-together-request-state", {
    roomId: rid,
  });
  await sleep(350);
  const paused2 = await ack(vs, "watch-together-request-state", {
    roomId: rid,
  });
  check(
    "paused memory remains stationary",
    paused2.data?.state?.isPlaying === false &&
      Math.abs(
        paused2.data.state.currentTime - paused1.data.state.currentTime,
      ) < 0.01,
    { paused1, paused2 },
  );
  r = await ack(hs, "watch-together-control", {
    roomId: rid,
    action: "seek",
    value: 60,
  });
  check("host seeks playback", r.success, r);
  r = await ack(vs, "watch-together-check-status", {
    roomId: rid,
    currentTime: 1,
    isPlaying: true,
    playbackRate: 1,
    clientTs: Date.now(),
  });
  check(
    "watch self-check corrects divergent viewer",
    r.data?.needsSync === true && r.data.state.currentTime === 60,
    r,
  );
  for (const ev of ["signal-offer", "signal-answer", "signal-ice-candidate"]) {
    r = await ack(vs, ev, { to: hs.id, data: { test: ev } });
    check(
      ev + " same-room relay",
      r.success && events(hs, ev).some((x) => x.from === vs.id),
      r,
    );
    r = await ack(os, ev, { to: hs.id, data: { test: "outsider" } });
    check(ev + " rejects cross-room", r.success === false, r);
  }
  const duplicate = await connect(b.token);
  r = await ack(duplicate, "request-join", { roomId: rid });
  check("second tab same user rejected", r.code === "ALREADY_IN_ROOM", r);
  duplicate.disconnect();
  r = await ack(hs, "host-leave");
  check("host leaves while room stays active", r.success, r);
  r = await ack(vs, "watch-together-request-state", { roomId: rid });
  check(
    "offline host reflected in watch state",
    r.data?.hostOnline === false,
    r,
  );
  const rhs = await connect(a.token);
  r = await ack(rhs, "register-host", { roomId: rid });
  check(
    "host reconnect restores paused progress and movie",
    r.success &&
      r.data.playback.currentTime === 60 &&
      r.data.playback.currentMovieId === mid,
    r,
  );
  r = await ack(rhs, "appoint-moderator", { roomId: rid, userId: b.user.id });
  check("host appoints moderator", r.success, r);
  r = await ack(vs, "add-movie", {
    roomId: rid,
    movie: {
      title: "moderator movie",
      url: base + "/moderator.mp4",
      source: "url",
    },
  });
  check("moderator can add movie", r.success, r);
  r = await ack(rhs, "dismiss-moderator", { roomId: rid, userId: b.user.id });
  check("host dismisses moderator", r.success, r);
  r = await ack(vs, "add-movie", {
    roomId: rid,
    movie: { title: "forbidden movie", url: base + "/no.mp4", source: "url" },
  });
  check(
    "dismissed moderator loses movie permission immediately",
    r.success === false,
    r,
  );
  r = await ack(rhs, "transfer-host", { roomId: rid, viewerSocketId: vs.id });
  check("host transfers to viewer", r.success, r);
  r = await ack(rhs, "watch-together-control", { roomId: rid, action: "play" });
  check("former host loses control immediately", r.success === false, r);
  r = await ack(vs, "watch-together-control", { roomId: rid, action: "play" });
  check("new host gains control immediately", r.success, r);
  r = await ack(vs, "close-room");
  check("new host closes room", r.success, r);
  r = await http("POST", "/api/voice/token", { roomId: rid }, b.token);
  check("closed room cannot issue a voice token", r.status === 404, r);
  check(
    "closed room removed from public list",
    !(await rooms(root.token)).some((x) => x.roomId === rid),
    rid,
  );
  const ph = await connect(a.token);
  const pid = await create(ph, "private approval", {
    password: "OnlyAudit!",
    requireApproval: true,
    maxViewers: 2,
  });
  r = await ack(gs1, "request-join", { roomId: pid, password: "bad" });
  check("private room rejects incorrect password", r.success === false, r);
  r = await ack(gs1, "request-join", { roomId: pid, password: "OnlyAudit!" });
  check(
    "first guest waits for approval",
    r.success && r.message === "等待分享端确认",
    r,
  );
  r = await ack(ph, "approve-join", { viewerSocketId: gs1.id });
  check("host approves first guest", r.success, r);
  r = await ack(gs2, "request-join", { roomId: pid, password: "OnlyAudit!" });
  check(
    "new independent guest still requires approval",
    r.message === "等待分享端确认",
    r,
  );
  check(
    "new guest receives no join-approved before host action",
    events(gs2, "join-approved").filter((x) => x.roomId === pid).length === 0,
    events(gs2, "join-approved"),
  );
  const voiceOut = await http(
    "POST",
    "/api/voice/token",
    { roomId: pid },
    c.token,
  );
  let grant = null;
  try {
    grant = JSON.parse(
      Buffer.from(voiceOut.data.token.split(".")[1], "base64url").toString(),
    ).video;
  } catch {}
  check("private voice token denied to outsider", voiceOut.status === 403, {
    status: voiceOut.status,
    grant,
  });
  const ghostVoice = await http(
    "POST",
    "/api/voice/token",
    { roomId: "NONEXISTENT_AUDIT_ROOM" },
    c.token,
  );
  let ghostGrant = null;
  try {
    ghostGrant = JSON.parse(
      Buffer.from(ghostVoice.data.token.split(".")[1], "base64url").toString(),
    ).video;
  } catch {}
  check("nonexistent room voice token denied", ghostVoice.status === 404, {
    status: ghostVoice.status,
    grant: ghostGrant,
  });
  r = await http(
    "POST",
    "/api/voice/mute",
    { roomId: pid, identity: "user:" + a.user.id, muted: true },
    c.token,
  );
  check("outsider voice moderation rejected", r.status === 403, r);
  r = await ack(ph, "host-leave");
  check("private host leaves", r.success, r);
  const rootSocket = await connect(root.token);
  r = await ack(rootSocket, "admin-close-room", { roomId: pid });
  check("admin can close room while host offline", r.success, r);
  const dh = await connect(a.token),
    dv = await connect(b.token);
  const did = await create(dh, "duplicate join", { maxViewers: 4 });
  const joins = [];
  for (let i = 0; i < 3; i++)
    joins.push(await ack(dv, "request-join", { roomId: did }));
  let listed = (await rooms(root.token)).find((x) => x.roomId === did);
  check(
    "repeated join on same socket is idempotent",
    listed?.viewerCount === 1,
    { joins, room: listed },
  );
  dv.disconnect();
  await sleep(700);
  listed = (await rooms(root.token)).find((x) => x.roomId === did);
  check(
    "viewer disconnect clears all active sessions",
    listed?.viewerCount === 0,
    listed,
  );
  const mhs = await connect(a.token),
    mvs = await connect(b.token);
  const mrid = await create(mhs, "music", { mode: "listen-together" });
  r = await ack(mvs, "request-join", { roomId: mrid });
  check("music viewer joins", r.success, r);
  const song = (n) => ({
    songId: n,
    name: "Audit Song " + n,
    artist: "Audit Artist",
    album: "Audit Album",
    durationMs: 180000,
    vip: false,
  });
  r = await ack(mvs, "music:queue-upsert", { roomId: mrid, item: song(1001) });
  check("viewer cannot mutate queue", r.success === false, r);
  for (const n of [1001, 1002, 1003]) {
    r = await ack(mhs, "music:queue-upsert", { roomId: mrid, item: song(n) });
    check("host queues song " + n, r.success, r);
  }
  let ms = await ack(mvs, "music:get-state", { roomId: mrid });
  check(
    "music queue persists and has username",
    ms.queue?.length === 3 && ms.queue.every((x) => x.addedBy === "rt_a"),
    ms,
  );
  r = await ack(mhs, "music:queue-reorder", {
    roomId: mrid,
    ids: [...ms.queue].reverse().map((x) => x.id),
  });
  check("music queue reorder", r.success, r);
  r = await ack(mhs, "music:queue-reorder", {
    roomId: mrid,
    ids: [ms.queue[0].id, ms.queue[0].id, ms.queue[0].id],
  });
  check("invalid music queue permutation rejected", r.success === false, r);
  const musicState = {
    roomId: mrid,
    trackSongId: 1001,
    trackKey: "ncm:1001",
    isPlaying: true,
    positionSec: 20,
    playMode: "sequence",
    updatedAt: Date.now(),
    clientTs: Date.now(),
  };
  r = await ack(mhs, "music:sync-state", musicState);
  check(
    "host music state forwards to viewer",
    r.success &&
      events(mvs, "music:sync-state").some((x) => x.trackSongId === 1001),
    r,
  );
  await sleep(1150);
  ms = await ack(mvs, "music:get-state", { roomId: mrid });
  check(
    "music memory advances progress",
    ms.syncState?.positionSec >= 21 && ms.syncState.positionSec < 24,
    ms,
  );
  r = await ack(mvs, "music:sync-state", musicState);
  check("viewer cannot overwrite music baseline", r.success === false, r);
  r = await ack(mhs, "music:sync-state", { ...musicState, positionSec: -1 });
  check("invalid music position rejected", r.success === false, r);
  r = await ack(mvs, "music:check-status", {
    roomId: mrid,
    positionSec: 1,
    isPlaying: false,
    clientTs: Date.now(),
  });
  check(
    "music self-check detects divergent state",
    r.data?.needsSync === true,
    r,
  );
  r = await ack(mvs, "music:control-request", {
    roomId: mrid,
    action: "seek",
    positionSec: 45,
  });
  check(
    "viewer requests music seek",
    r.success &&
      events(mhs, "music:control-request").some(
        (x) => x.from === mvs.id && x.positionSec === 45,
      ),
    r,
  );
  r = await ack(mhs, "music:control-response", {
    roomId: mrid,
    action: "seek",
    approved: true,
    from: mvs.id,
  });
  check(
    "host music request response forwarded",
    r.success &&
      events(mvs, "music:control-response").some((x) => x.approved === true),
    r,
  );
  r = await ack(mhs, "host-leave");
  check("music host leaves", r.success, r);
  ms = await ack(mvs, "music:get-state", { roomId: mrid });
  check("music get-state detects offline host", ms.hostOnline === false, ms);
  const mhs2 = await connect(a.token);
  r = await ack(mhs2, "register-host", { roomId: mrid });
  check("music host reconnects", r.success, r);
  ms = await ack(mhs2, "music:get-state", { roomId: mrid });
  check(
    "music reconnect retains queue and state",
    ms.hostOnline === true &&
      ms.queue.length === 3 &&
      ms.syncState.trackSongId === 1001,
    ms,
  );
  r = await ack(mhs2, "music:queue-remove", {
    roomId: mrid,
    id: ms.queue[0].id,
  });
  check("music remove queue item", r.success, r);
  r = await ack(mhs2, "music:queue-clear", { roomId: mrid });
  check("music queue clear", r.success, r);
  ms = await ack(mvs, "music:get-state", { roomId: mrid });
  check("music queue empty after clear", ms.queue?.length === 0, ms);
  for (const roomId of report.rooms)
    await http("DELETE", `/api/admin/rooms/${roomId}`, undefined, root.token);
}
main()
  .catch((e) => {
    report.error = e.stack;
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const s of allSockets) s.disconnect();
    report.totals = {
      passed: report.checks.filter((x) => x.passed).length,
      failed: report.checks.filter((x) => !x.passed).length,
    };
    fs.writeFileSync(
      path.join(process.env.ZVIEWER_TEST_OUTPUT, "results.json"),
      JSON.stringify(report, null, 2),
    );
    if (report.error || report.totals.failed) process.exitCode = 1;
    console.log("TOTALS", report.totals);
  });
