const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { once } = require("node:events");
const { AppDataSource: db } = require("../../backend/dist/data-source");
const entity = (name) => require(`../../backend/dist/entities/${name}`)[name];
const Room = entity("Room"),
  Session = entity("Session"),
  User = entity("User");
const Movie = entity("Movie"),
  UserMount = entity("UserMount");
const DanmakuTrack = entity("DanmakuTrack"),
  RoomDanmakuMeta = entity("RoomDanmakuMeta");
const {
  roomSessionService,
} = require("../../backend/dist/modules/room/room-session.service");
const { canReadRoom } = require("../../backend/dist/services/room-access");
const auth = require("../../backend/dist/middleware/auth");
const {
  isInternalServerUrl,
} = require("../../backend/dist/services/network-utils");
const {
  deleteRoomAndRelations,
} = require("../../backend/dist/modules/room/room-removal.service");
const save = (type, fields) =>
  db.getRepository(type).save(db.getRepository(type).create(fields));
const socket = (id) => ({
  id,
  connected: true,
  data: {},
  join: async () => {},
});
let owner;
before(async () => {
  await db.initialize();
  owner = await save(User, {
    username: "fixture-owner",
    passwordHash: "unused",
    status: "active",
    role: "user",
  });
});
after(async () => {
  await db.destroy();
});
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
test("IPv6 literals and normalized IPv4 mappings cannot bypass private-host detection", () => {
  for (const host of [
    "[::1]",
    "[::]",
    "[fd12::1]",
    "[fe80::1]",
    "[::ffff:127.0.0.1]",
    "[::ffff:7f00:1]",
    "127.1",
    "0x7f000001",
    "localhost.",
  ]) {
    assert.equal(isInternalServerUrl(`http://${host}/`), true, host);
  }
  assert.equal(isInternalServerUrl("https://example.com/video"), false);
});
test("revoked tokens fail on the first check, including after a cold module start", async () => {
  const payload = auth.verifyAccessToken(
    auth.generateTokens(owner.id, "user").accessToken,
  );
  await auth.assertTokenActive(payload);
  await db
    .getRepository(User)
    .update(owner.id, { tokenInvalidBefore: new Date(payload.issuedAtMs) });
  await assert.rejects(auth.assertTokenActive(payload));
  await db.getRepository(User).update(owner.id, { tokenInvalidBefore: null });
});
test("guest admission is scoped to the individual guest; movie DTOs exclude mount credentials", async () => {
  await save(Room, {
    roomId: "guest-scope",
    mode: "watch-together",
    ownerUserId: owner.id,
  });
  const a = auth.verifyAccessToken(auth.generateTokens(0, "guest").accessToken);
  const b = auth.verifyAccessToken(auth.generateTokens(0, "guest").accessToken);
  assert.notEqual(a.guestId, b.guestId);
  const s = socket("guest-one");
  s.data = a;
  await roomSessionService.admitViewer(s, "guest-scope", 0);
  assert.equal(await canReadRoom("guest-scope", a), true);
  assert.equal(await canReadRoom("guest-scope", b), false);
  const movie = await save(Movie, {
    roomId: "guest-scope",
    title: "fixture",
    url: "fixture",
    username: "secret-user",
    password: "secret-pass",
  });
  const {
    movieService,
  } = require("../../backend/dist/modules/movie/movie.service");
  const dto = movieService.serializeMovie(movie);
  assert.equal(dto.username, null);
  assert.equal(dto.password, null);
});
test("admission is atomic under repeated and competing joins; disconnect clears legacy duplicates", async () => {
  await save(Room, {
    roomId: "capacity",
    mode: "watch-together",
    maxViewers: 1,
  });
  const s = socket("same-socket");
  const admitted = await Promise.all(
    Array.from({ length: 8 }, () =>
      roomSessionService.admitViewer(s, "capacity", owner.id),
    ),
  );
  assert.equal(new Set(admitted.map((s) => s.id)).size, 1);
  await assert.rejects(
    roomSessionService.admitViewer(
      socket("second-socket"),
      "capacity",
      owner.id,
    ),
    /上限/,
  );
  await save(Session, {
    roomId: "capacity",
    socketId: s.id,
    userId: owner.id,
    role: "viewer",
  });
  await roomSessionService.endSession(s.id);
  assert.equal(await roomSessionService.getViewerCount("capacity"), 0);
  const races = await Promise.allSettled(
    ["racer-a", "racer-b"].map((id) =>
      roomSessionService.admitViewer(socket(id), "capacity", owner.id),
    ),
  );
  assert.equal(races.filter((r) => r.status === "fulfilled").length, 1);
});
test("detached panels lose their subscription when the primary guest session ends", async () => {
  const roomId = "panel-close";
  await save(Room, { roomId, mode: "watch-together" });
  const actor = auth.verifyAccessToken(
    auth.generateTokens(0, "guest").accessToken,
  );
  const primary = socket("panel-primary");
  primary.data = actor;
  await roomSessionService.admitViewer(primary, roomId, 0);
  const left = [],
    events = [];
  const panel = {
    data: { ...actor, panelRoomIds: [roomId] },
    leave: async (id) => left.push(id),
    emit: (event) => events.push(event),
  };
  const io = { sockets: { sockets: new Map([["panel", panel]]) } };
  await roomSessionService.endSession(primary.id, io);
  assert.deepEqual(left, [roomId]);
  assert.deepEqual(panel.data.panelRoomIds, []);
  assert.ok(events.includes("viewer-kicked"));
});
test("deletion removes imported tracks and realtime metadata from the database", async () => {
  const roomId = "delete-danmaku";
  await save(Room, { roomId, mode: "watch-together" });
  await save(DanmakuTrack, {
    roomId,
    trackId: "fixture",
    label: "fixture",
    source: "{}",
    items: "[]",
  });
  await save(RoomDanmakuMeta, {
    roomId,
    realtimeLog: '[{"content":"fixture"}]',
  });
  await deleteRoomAndRelations(roomId);
  assert.equal(await db.getRepository(DanmakuTrack).countBy({ roomId }), 0);
  assert.equal(await db.getRepository(RoomDanmakuMeta).countBy({ roomId }), 0);
});
test("Jellyfin HLS rewrites nested playlists, segments, keys and maps through authenticated scope", async (t) => {
  const upstream = express();
  upstream.get("/emby/Videos/item/main.m3u8", (_q, r) =>
    r
      .type("application/vnd.apple.mpegurl")
      .send(
        '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin?api_key=private-token"\n#EXT-X-MAP:URI="init.mp4"\nchild.m3u8\n',
      ),
  );
  upstream.get("/emby/Videos/item/child.m3u8", (_q, r) =>
    r
      .type("application/vnd.apple.mpegurl")
      .send(
        "#EXTM3U\n#EXTINF:3,\nhls1/main/0.ts?api_key=private-token\n#EXT-X-ENDLIST\n",
      ),
  );
  upstream.get("/emby/Videos/item/hls1/main/0.ts", (q, r) => {
    assert.equal(q.query.api_key, "private-token");
    r.send(Buffer.from("segment bytes"));
  });
  const origin = await listen(t, upstream);
  const mount = await save(UserMount, {
    userId: owner.id,
    type: "jellyfin",
    name: "fixture",
    serverUrl: origin,
    apiKey: "private-token",
    embyUserId: "media-user",
  });
  const movie = await save(Movie, {
    roomId: "guest-scope",
    title: "HLS",
    source: "jellyfin",
    url: "fixture",
    path: "item",
    format: "hls",
    serverUrl: origin,
    sourceMountId: mount.id,
  });
  const app = express();
  app.use(
    "/api/jellyfin",
    require("../../backend/dist/routes/emby-like-factory").createEmbyLikeRouter(
      {
        mountType: "jellyfin",
        apiPrefix: "jellyfin",
        label: "Jellyfin",
        logTag: "test",
        fallbackErrorCode: "TEST_ERROR",
      },
    ),
  );
  const base = await listen(t, app),
    headers = {
      Authorization: `Bearer ${auth.generateTokens(owner.id, "user").accessToken}`,
    };
  const root = await fetch(`${base}/api/jellyfin/stream?movieId=${movie.id}`, {
    headers,
  });
  assert.equal(root.status, 200);
  const manifest = await root.text();
  assert.ok(!manifest.includes("private-token"));
  assert.equal((manifest.match(/resource=/g) ?? []).length, 3);
  const child = manifest.split("\n").find((line) => line.startsWith("/api/"));
  const nested = await fetch(base + child, { headers });
  assert.equal(nested.status, 200);
  const segmentUri = (await nested.text())
    .split("\n")
    .find((line) => line.startsWith("/api/"));
  const segment = await fetch(base + segmentUri, { headers });
  assert.equal(segment.status, 200);
  assert.equal(await segment.text(), "segment bytes");
  const guest = auth.generateTokens(0, "guest").accessToken;
  assert.equal(
    (
      await fetch(base + segmentUri, {
        headers: { Authorization: `Bearer ${guest}` },
      })
    ).status,
    403,
  );
  const forged = `${base}/api/jellyfin/stream?movieId=${movie.id}&resource=${encodeURIComponent("http://127.0.0.1/private")}`;
  assert.equal((await fetch(forged, { headers })).status, 400);
});
test("Emby password sessions reuse one concurrent login and renew a revoked session once", async (t) => {
  let logins = 0,
    token;
  const upstream = express();
  upstream.use(express.json());
  upstream.post("/emby/Users/authenticatebyname", (_q, r) => {
    token = `fixture-token-${++logins}`;
    r.json({ AccessToken: token, User: { Id: "media-user" } });
  });
  upstream.get("/emby/Users/Me", (q, r) =>
    q.headers["x-emby-token"] === token
      ? r.json({ Id: "media-user" })
      : r.sendStatus(401),
  );
  const serverUrl = await listen(t, upstream);
  const {
    resolveEmbySession,
  } = require("../../backend/dist/services/emby-client");
  const mount = { serverUrl, username: "fixture", password: "fixture-only" };
  const sessions = await Promise.all(
    Array.from({ length: 8 }, () => resolveEmbySession(mount)),
  );
  assert.equal(logins, 1);
  assert.equal(new Set(sessions.map((s) => s.token)).size, 1);
  token = "revoked";
  const renewed = await Promise.all(
    Array.from({ length: 8 }, () => resolveEmbySession(mount)),
  );
  assert.equal(logins, 2);
  assert.ok(renewed.every((s) => s.token === "fixture-token-2"));
});
test("WebDAV clearing a required password validates the cleared value before saving", async (t) => {
  const upstream = express();
  upstream.use((_q, r) =>
    r.status(401).set("WWW-Authenticate", 'Basic realm="fixture"').end(),
  );
  const serverUrl = await listen(t, upstream);
  const mount = await save(UserMount, {
    userId: owner.id,
    name: "fixture",
    type: "webdav",
    serverUrl,
    username: "fixture",
    password: "keep-on-rejection",
    path: "/",
  });
  const {
    updateMount,
  } = require("../../backend/dist/modules/webdav/webdav-mount.service");
  await assert.rejects(
    updateMount(owner.id, mount.id, {
      name: "fixture",
      serverUrl,
      username: "fixture",
      password: "",
      path: "/",
    }),
  );
  assert.equal(
    (await db.getRepository(UserMount).findOneBy({ id: mount.id })).password,
    "keep-on-rejection",
  );
});
