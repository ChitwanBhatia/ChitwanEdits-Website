// Builds preview clips, full-watch clips, posters, the homepage hero tiles and site/data/videos.js
// from tools/videos.json and the parts chosen in the clip picker (tools/picks.json).
// Only videos with a full-watch pick are published; the rest are left off the site.
// Unchanged entries are skipped on re-runs.
//
//   node tools/build.mjs                 build everything that changed
//   node tools/build.mjs --force         rebuild every clip
//   node tools/build.mjs --redo=id1,id2  rebuild these clips even if unchanged
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIDEOS_DIR = path.join(ROOT, 'Videos');
const SITE_DIR = path.join(ROOT, 'site');
const PREVIEW_DIR = path.join(SITE_DIR, 'media', 'previews');
const POSTER_DIR = path.join(SITE_DIR, 'media', 'posters');
const TILE_DIR = path.join(SITE_DIR, 'media', 'tiles');
const FULL_DIR = path.join(SITE_DIR, 'media', 'full');
const CACHE_FILE = path.join(ROOT, 'tools', '.build-cache.json');
const PICKS_FILE = path.join(ROOT, 'tools', 'picks.json');

const FF_DIR = process.env.FFMPEG_DIR || 'C:\\ffmpeg-8.1.2-essentials_build\\bin';
const tool = (name) => {
  const p = path.join(FF_DIR, `${name}.exe`);
  return fs.existsSync(p) ? p : name;
};
const FFMPEG = tool('ffmpeg');
const FFPROBE = tool('ffprobe');

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const redoArg = argv.find((a) => a.startsWith('--redo='));
const REDO = new Set(redoArg ? redoArg.slice('--redo='.length).split(',') : []);

// Clips fit inside these boxes; the long edge becomes this many px.
const PREVIEW_BOX = 854;
const TILE_BOX = 480;
const FULL_BOX = 1920;
// Cloudflare serves static files up to 25 MiB, so full-watch clips are kept under this size.
const FULL_MAX_BYTES = 24.5 * 1024 * 1024;
const FULL_BUDGET_KBIT = (23 * 1024 * 1024 * 8) / 1000; // 23 MiB in kilobits, leaving headroom
const FULL_MAX_KBPS = 6000;
const AUDIO_KBPS = 128;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} failed:\n${r.stderr}`);
  return r.stdout;
}

function probe(file) {
  const info = JSON.parse(run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]));
  const v = info.streams.find((s) => s.codec_type === 'video');
  let w = v.width;
  let h = v.height;
  const rot = (v.side_data_list || []).find((d) => d.rotation !== undefined);
  if (rot && Math.abs(rot.rotation) === 90) [w, h] = [h, w];
  const [num, den] = (v.avg_frame_rate || '30/1').split('/').map(Number);
  return { w, h, fps: den ? num / den : 30, duration: Number(info.format.duration) };
}

function fitBox(w, h, box) {
  const s = box / Math.max(w, h);
  const even = (n) => Math.max(2, Math.round((n * s) / 2) * 2);
  return { w: even(w), h: even(h) };
}

const fmtTime = (sec) => {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function youtubeId(value) {
  if (!value) return '';
  const m = String(value).match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
  if (m) return m[1];
  return /^[\w-]{11}$/.test(value) ? value : '';
}

const loadCache = () => (fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {});

// Picked parts as [start, end] seconds, sorted and kept inside the video.
const cleanCuts = (cuts, duration) => (cuts || [])
  .map(([s, e]) => [Math.max(0, s), Math.min(duration, e)])
  .filter(([s, e]) => e - s >= 0.1)
  .sort((a, b) => a[0] - b[0]);
const cutsLength = (cuts) => cuts.reduce((sum, [s, e]) => sum + (e - s), 0);

// One fast-seeking input per part, so long originals are not decoded from the start.
const cutInputs = (src, cuts) => cuts.flatMap(([s, e]) => ['-ss', s.toFixed(3), '-t', (e - s).toFixed(3), '-i', src]);

const videoFilter = (meta, box) => {
  const size = fitBox(meta.w, meta.h, Math.min(box, Math.max(meta.w, meta.h)));
  const scale = `scale=${size.w}:${size.h}:flags=lanczos,setsar=1`;
  return { scale, vf: meta.fps > 31 ? `fps=30,${scale}` : scale };
};

// Silent loop joined from the picked parts (used for card previews and hero tiles).
function encodeSilentLoop(src, cuts, vf, crf, out) {
  const joins = cuts.map((_, i) => `[${i}:v]setpts=PTS-STARTPTS[v${i}]`).join(';');
  const filter = `${joins};${cuts.map((_, i) => `[v${i}]`).join('')}concat=n=${cuts.length}:v=1:a=0[vc];[vc]${vf}[v]`;
  run(FFMPEG, [
    '-v', 'error', '-y', ...cutInputs(src, cuts), '-filter_complex', filter, '-map', '[v]',
    '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p',
    '-profile:v', 'high', '-movflags', '+faststart', out,
  ]);
}

// Silent looping preview for the cards, joined from the picked preview parts.
function buildPreview(item, meta, cache, cuts) {
  const out = path.join(PREVIEW_DIR, `${item.id}.mp4`);
  const poster = path.join(POSTER_DIR, `${item.id}.jpg`);
  const key = JSON.stringify({ v: 3, src: item.src, cuts, posterAt: item.posterAt });
  const fresh = cache[item.id] === key && fs.existsSync(out) && fs.existsSync(poster);
  if (fresh && !FORCE && !REDO.has(item.id)) return false;

  const { scale, vf } = videoFilter(meta, PREVIEW_BOX);
  const src = path.join(VIDEOS_DIR, item.src);
  encodeSilentLoop(src, cuts, vf, 28, out);
  const [s, e] = cuts[0];
  const posterAt = item.posterAt ?? s + Math.min(1, (e - s) / 4);
  run(FFMPEG, ['-v', 'error', '-y', '-ss', String(posterAt), '-i', src, '-frames:v', '1', '-vf', scale, '-q:v', '4', poster]);
  cache[item.id] = key;
  return true;
}

// What plays on click: the picked full-watch parts joined, with sound, sharp but under Cloudflare's file limit.
function buildFull(item, meta, cache, cuts) {
  const out = path.join(FULL_DIR, `${item.id}.mp4`);
  const key = JSON.stringify({ v: 1, src: item.src, cuts });
  if (!FORCE && !REDO.has(item.id) && cache[`full:${item.id}`] === key && fs.existsSync(out)) return false;

  const { vf } = videoFilter(meta, FULL_BOX);
  const src = path.join(VIDEOS_DIR, item.src);
  const fade = 0.03; // tiny audio fades so the joins don't click
  const parts = cuts.map(([s, e], i) => {
    const len = e - s;
    return `[${i}:v]setpts=PTS-STARTPTS[v${i}];`
      + `[${i}:a]asetpts=PTS-STARTPTS,afade=t=in:d=${fade},afade=t=out:st=${Math.max(0, len - fade).toFixed(3)}:d=${fade}[a${i}]`;
  });
  const filter = `${parts.join(';')};${cuts.map((_, i) => `[v${i}][a${i}]`).join('')}`
    + `concat=n=${cuts.length}:v=1:a=1[vc][a];[vc]${vf}[v]`;

  let kbps = Math.min(FULL_MAX_KBPS, Math.floor(FULL_BUDGET_KBIT / cutsLength(cuts) - AUDIO_KBPS));
  for (let attempt = 0; attempt < 3; attempt++) {
    run(FFMPEG, [
      '-v', 'error', '-y', ...cutInputs(src, cuts), '-filter_complex', filter, '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`,
      '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-c:a', 'aac', '-b:a', `${AUDIO_KBPS}k`,
      '-movflags', '+faststart', out,
    ]);
    if (fs.statSync(out).size <= FULL_MAX_BYTES) break;
    kbps = Math.floor(kbps * 0.8);
  }
  if (fs.statSync(out).size > FULL_MAX_BYTES) throw new Error(`${item.id}: full-watch clip is still over 25 MB; pick a shorter part`);
  cache[`full:${item.id}`] = key;
  return true;
}

// Removes clips and posters of videos that are no longer published.
function removeStale(dir, keepIds) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (keepIds.has(path.parse(name).name)) continue;
    fs.unlinkSync(path.join(dir, name));
    console.log(`removed  ${path.relative(ROOT, path.join(dir, name))}`);
  }
}

// Hero tiles: small loops scattered around the headline, showing the same moments as the video's picked preview.
function buildTile(item, meta, cache, cuts) {
  const out = path.join(TILE_DIR, `${item.id}.mp4`);
  const poster = path.join(TILE_DIR, `${item.id}.jpg`);
  const key = JSON.stringify({ v: 2, src: item.src, cuts });
  if (!FORCE && cache[`tile:${item.id}`] === key && fs.existsSync(out) && fs.existsSync(poster)) return false;

  const { scale, vf } = videoFilter(meta, TILE_BOX);
  const src = path.join(VIDEOS_DIR, item.src);
  encodeSilentLoop(src, cuts, vf, 30, out);
  const [s, e] = cuts[0];
  run(FFMPEG, ['-v', 'error', '-y', '-ss', String(s + (e - s) / 2), '-i', src, '-frames:v', '1', '-vf', scale, '-q:v', '5', poster]);
  cache[`tile:${item.id}`] = key;
  return true;
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'videos.json'), 'utf8'));
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  fs.mkdirSync(POSTER_DIR, { recursive: true });
  fs.mkdirSync(path.join(SITE_DIR, 'data'), { recursive: true });

  const catIds = new Set(manifest.categories.map((c) => c.id));
  const byId = {};
  for (const item of manifest.videos) {
    if (byId[item.id]) throw new Error(`Duplicate id: ${item.id}`);
    if (!catIds.has(item.cat)) throw new Error(`${item.id}: unknown category "${item.cat}"`);
    if (!fs.existsSync(path.join(VIDEOS_DIR, item.src))) throw new Error(`${item.id}: missing file Videos/${item.src}`);
    byId[item.id] = item;
  }

  const picks = fs.existsSync(PICKS_FILE) ? JSON.parse(fs.readFileSync(PICKS_FILE, 'utf8')) : {};
  const published = manifest.videos.filter((item) => picks[item.id] && (picks[item.id].watch || []).length);
  const skipped = manifest.videos.filter((item) => !published.includes(item)).map((item) => item.id);
  fs.mkdirSync(FULL_DIR, { recursive: true });

  const cache = loadCache();
  const metaById = {};
  const previewCutsById = {};
  const out = [];
  let built = 0;
  for (const item of published) {
    const meta = probe(path.join(VIDEOS_DIR, item.src));
    metaById[item.id] = meta;
    const pick = picks[item.id];
    const fullCuts = cleanCuts(pick.watch, meta.duration);
    // No preview picked: keep the old preview window from videos.json.
    const pickedPreview = cleanCuts(pick.preview, meta.duration);
    const previewCuts = pickedPreview.length ? pickedPreview : cleanCuts([[item.start, item.start + item.dur]], meta.duration);
    previewCutsById[item.id] = previewCuts;
    if (buildPreview(item, meta, cache, previewCuts)) {
      built++;
      console.log(`preview  ${item.id}`);
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    }
    if (buildFull(item, meta, cache, fullCuts)) {
      built++;
      const mb = fs.statSync(path.join(FULL_DIR, `${item.id}.mp4`)).size / 1024 / 1024;
      console.log(`full     ${item.id} (${fmtTime(cutsLength(fullCuts))}, ${mb.toFixed(1)} MB)`);
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    }
    const size = fitBox(meta.w, meta.h, PREVIEW_BOX);
    out.push({
      id: item.id,
      cat: item.cat,
      title: item.title,
      tag: item.tag,
      client: item.client || '',
      featured: item.featured || 0,
      duration: fmtTime(cutsLength(fullCuts)),
      aspect: Number((size.w / size.h).toFixed(4)),
      preview: `media/previews/${item.id}.mp4`,
      poster: `media/posters/${item.id}.jpg`,
      full: `media/full/${item.id}.mp4`,
      youtube: youtubeId(item.youtube),
    });
  }

  const publishedIds = new Set(published.map((item) => item.id));
  [PREVIEW_DIR, POSTER_DIR, FULL_DIR].forEach((dir) => removeStale(dir, publishedIds));

  fs.mkdirSync(TILE_DIR, { recursive: true });
  const tileIds = new Set();
  const tiles = (manifest.heroTiles || []).flatMap((tile, i) => {
    const item = byId[tile.id];
    if (!item) throw new Error(`heroTiles[${i}]: unknown video id "${tile.id}"`);
    // Clicking a tile opens its video, so tiles of unpublished videos are dropped.
    if (!publishedIds.has(tile.id)) {
      console.log(`skip     hero tile ${i + 1} (${tile.id} is not published)`);
      return [];
    }
    // A tile shows the video's preview, so a second tile of the same video would be an exact repeat.
    if (tileIds.has(tile.id)) {
      console.log(`skip     hero tile ${i + 1} (${tile.id} is already a tile)`);
      return [];
    }
    tileIds.add(tile.id);
    const meta = metaById[tile.id];
    if (buildTile(item, meta, cache, previewCutsById[tile.id])) console.log(`tile     ${tile.id}`);
    const size = fitBox(meta.w, meta.h, TILE_BOX);
    return {
      id: tile.id,
      src: `media/tiles/${tile.id}.mp4`,
      poster: `media/tiles/${tile.id}.jpg`,
      aspect: Number((size.w / size.h).toFixed(4)),
    };
  });
  removeStale(TILE_DIR, tileIds);
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));

  const categories = manifest.categories.filter((c) => out.some((v) => v.cat === c.id));
  const data = { categories, videos: out, tiles };
  fs.writeFileSync(
    path.join(SITE_DIR, 'data', 'videos.js'),
    `// Generated by tools/build.mjs from tools/videos.json and tools/picks.json. Edit those, then re-run the build.\nwindow.CE_DATA = ${JSON.stringify(data, null, 2)};\n`,
  );
  console.log(`done: ${out.length} videos published, ${built} clips rebuilt`);
  if (skipped.length) console.log(`not published (no full-watch pick): ${skipped.join(', ')}`);
}

main();
