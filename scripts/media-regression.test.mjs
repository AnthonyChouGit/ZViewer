import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { parseMkvCueIndex, buildMkvKeyframeIndexFromBlob } from '../frontend/vendor/playsvideo/dist/pipeline/mkv-keyframe-index.js';
import { packetsFromAdtsData } from '../frontend/vendor/playsvideo/dist/pipeline/audio-transcode.js';
import { decodePgsRle } from '../frontend/src/modules/subtitles/pgs-decoder.ts';

function el(id, body) {
  body = Buffer.from(body);
  const size = body.length < 127 ? Buffer.from([0x80 | body.length]) : Buffer.from([0x40 | (body.length >> 8), body.length & 255]);
  return Buffer.concat([Buffer.from(id.toString(16).padStart(2, '0'), 'hex'), size, body]);
}
const uint = (id, n) => el(id, n < 256 ? [n] : [n >> 8, n & 255]);
const position = (track, offset) => el(0xb7, Buffer.concat([uint(0xf7, track), uint(0xf1, offset)]));
const cue = (time, positions) => el(0xbb, Buffer.concat([uint(0xb3, time), ...positions]));
function indexedMkv() {
  const cues = el(0x1c53bb6b, Buffer.concat([
    cue(0, [position(5, 1)]),
    cue(1234, [position(8, 2)]), // subtitle-only cue must not cut video
    cue(4000, [position(5, 3), position(8, 4)]),
    cue(8000, [position(8, 5), position(5, 6)]),
  ]));
  const duration = Buffer.alloc(8); duration.writeDoubleBE(10000);
  const info = el(0x1549a966, el(0x4489, duration));
  let seek = Buffer.alloc(0);
  for (let i = 0; i < 3; i++) seek = el(0x114d9b74, el(0x4dbb, Buffer.concat([el(0x53ab, [0x1c,0x53,0xbb,0x6b]), uint(0x53ac, seek.length + info.length)])));
  return Buffer.concat([el(0x1a45dfa3, []), el(0x18538067, Buffer.concat([seek, info, cues]))]);
}

test('MKV video index excludes subtitle/audio cues and respects every CueTrackPositions', async () => {
  const data = indexedMkv();
  const all = await parseMkvCueIndex((a,b) => data.subarray(a,b), data.length);
  assert.deepEqual(all.cuePoints.map(c => c.timestampMs), [0,1234,4000,8000]);
  const video = await buildMkvKeyframeIndexFromBlob(new Blob([data]), 5);
  assert.deepEqual(video.keyframes.map(c => c.timestamp), [0,4,8]);
  assert.equal(await buildMkvKeyframeIndexFromBlob(new Blob([data])), null);
  assert.equal(await buildMkvKeyframeIndexFromBlob(new Blob([data]), 99), null);
});

test('AAC encoder priming is removed and timestamps use the actual ADTS sample rate', () => {
  const adts = Buffer.concat([0,1,2,3].map(i => Buffer.from([0xff,0xf1,0x4c,0x80,1,0x1f,0xfc,i])));
  const result = packetsFromAdtsData(adts, 44100, 1125.984);
  assert.equal(result.packets.length, 3);
  assert.equal(result.packets[0].data[7], 1);
  assert.equal(result.packets[0].timestamp, 1125.984);
  assert.equal(result.packets[1].timestamp, 1125.984 + 1024/48000);
  assert.equal(result.packets[0].duration, 1024/48000);
  assert.equal(result.decoderConfig.sampleRate, 48000);
});

test('PGS RLE handles literal, transparent, short/long colored runs and line endings', () => {
  const data = Uint8Array.from([1, 0,0x82,2, 0,1, 0,0, 0,0xc0,4,3, 0,0]);
  assert.deepEqual([...decodePgsRle(data,4,2)], [1,2,2,0,3,3,3,3]);
  assert.throws(() => decodePgsRle(Uint8Array.from([0,0x40]),4,1), /截断/);
  assert.throws(() => decodePgsRle(Uint8Array.from([0,0x85,1]),4,1), /行长度/);
});

function loadLocalTs(file, requireFn = () => { throw new Error('Unexpected import'); }) {
  const code = ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const exports = {};
  new Function('exports','require',code)(exports,requireFn);
  return exports;
}

const syncState = loadLocalTs('frontend/src/modules/sync-playback/services/state-merge.ts');
const biliState = {
  sourceUrl: 'https://media.example/video.m4s', sourceType: 'bilibili',
  audioUrl: 'https://media.example/audio.m4s', format: 'dash',
  videoCodec: 'avc1.640028', audioCodec: 'mp4a.40.2', cid: 123,
  currentQn: 80, acceptQuality: [{ id: 80, label: '1080P' }],
  isPlaying: true, currentTime: 30, playbackRate: 1, duration: 91,
  hostCliEnabled: true, bufferMode: true, isPreview: true, previewTitle: 'old preview',
};
const hlsState = {
  sourceUrl: 'https://media.example/episode.m3u8', sourceType: 'kazumi', format: 'hls',
  audioUrl: undefined, videoCodec: undefined, audioCodec: undefined, cid: undefined,
  currentQn: undefined, acceptQuality: undefined, duration: undefined,
  isPlaying: true, currentTime: 0, playbackRate: 1,
  headers: { Referer: 'https://source.example/' },
};
const wire = value => JSON.parse(JSON.stringify(value));

test('Bilibili to Kazumi clears omitted audio and source metadata after a real JSON round trip', () => {
  const payload = wire({ state: hlsState, diff: syncState.computeStateDiff(biliState, hlsState) });
  assert.equal(Object.hasOwn(payload.diff, 'audioUrl'), false);
  // Reproduce the old receiver: a diff cannot clear a JSON-omitted field.
  assert.equal(syncState.mergeStateDiff(biliState, payload.diff).audioUrl, biliState.audioUrl);
  const restored = syncState.restoreStateSnapshot(biliState, payload.state);
  // roomStore intentionally shallow-merges partial progress updates.
  const stored = { ...biliState, ...restored };
  for (const key of ['audioUrl', 'videoCodec', 'audioCodec', 'cid', 'currentQn', 'acceptQuality', 'hostCliEnabled', 'bufferMode', 'isPreview', 'previewTitle']) {
    assert.equal(stored[key], undefined, key);
  }
  assert.equal(stored.format, 'hls');
  assert.equal(stored.duration, 0);
  assert.deepEqual(stored.headers, hlsState.headers);
  assert.equal(biliState.audioUrl, 'https://media.example/audio.m4s');
});

test('full state restores after a missed diff and clears old headers on HLS to DASH switching', () => {
  const stale = { ...hlsState, headers: { Referer: 'https://old.example/', Cookie: 'synthetic-test-cookie' } };
  const payload = wire({ state: biliState, diff: { currentTime: 30 }, seq: 9 });
  const restored = syncState.restoreStateSnapshot(stale, payload.state);
  assert.equal(restored.sourceUrl, biliState.sourceUrl);
  assert.equal(restored.audioUrl, biliState.audioUrl);
  assert.equal(restored.format, 'dash');
  assert.equal(restored.headers, undefined);
});

test('full request/heartbeat snapshots clear optional fields even when the video URL is unchanged', () => {
  const snapshot = wire({ ...hlsState, sourceUrl: biliState.sourceUrl, format: 'mp4' });
  const restored = syncState.restoreStateSnapshot(biliState, snapshot);
  assert.equal(restored.sourceUrl, biliState.sourceUrl);
  assert.equal(restored.audioUrl, undefined);
  assert.equal(restored.format, 'mp4');
  assert.equal(restored.cid, undefined);
  assert.deepEqual(restored.headers, hlsState.headers);
});

test('same-source snapshots from legacy hosts preserve media policies without leaking them across films', () => {
  const current = { ...hlsState, playsvideoEnabled: false, noProxyFallback: true };
  const legacy = wire(hlsState);
  const restored = syncState.restoreStateSnapshot(current, legacy);
  assert.equal(restored.playsvideoEnabled, false);
  assert.equal(restored.noProxyFallback, true);
  const changed = syncState.restoreStateSnapshot(current, wire(biliState));
  assert.equal(changed.playsvideoEnabled, undefined);
  assert.equal(changed.noProxyFallback, undefined);
  const emitted = wire(syncState.buildStateFromVideo(null, current));
  assert.equal(emitted.playsvideoEnabled, false);
  assert.equal(emitted.noProxyFallback, true);
});
test('MKV compression metadata uses real EBML IDs and distinguishes none/zlib/header stripping', () => {
  const ebml = loadLocalTs('frontend/src/lib/mkv/ebml.ts');
  const { MatroskaDemuxer } = loadLocalTs('frontend/src/lib/mkv/matroska-demuxer.ts', () => ebml);
  const track = (n, compression) => el(0xae, Buffer.concat([
    uint(0xd7,n), uint(0x83,17), el(0x86,Buffer.from('S_HDMV/PGS')),
    compression ? el(0x6d80,el(0x6240,el(0x5034,compression))) : Buffer.alloc(0),
  ]));
  const tracks = el(0x1654ae6b,Buffer.concat([track(1),track(2,Buffer.alloc(0)),track(3,Buffer.concat([uint(0x4254,3),el(0x4255,[0x16,0,0])]))]));
  let parsed;
  new MatroskaDemuxer({onTracks:t=>parsed=t}).append(Buffer.concat([el(0x1a45dfa3,[]),el(0x18538067,tracks)]));
  assert.deepEqual(parsed.map(t=>t.contentCompAlgo), [-1,0,3]);
  assert.deepEqual([...parsed[2].contentCompSettings],[0x16,0,0]);
});
