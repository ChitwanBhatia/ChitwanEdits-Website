// Builds preview clips, posters, the homepage hero tiles and site/data/videos.js
// from tools/videos.json. Unchanged entries are skipped on re-runs.
//
//   node tools/build.mjs                 build everything that changed
//   node tools/build.mjs --force         rebuild every clip
//   node tools/build.mjs --redo=id1,id2  rebuild these previews even if unchanged
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
const CACHE_FILE = path.join(ROOT, 'tools', '.build-cache.json');

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

function buildPreview(item, meta, cache) {
  const out = path.join(PREVIEW_DIR, `${item.id}.mp4`);
  const poster = path.join(POSTER_DIR, `${item.id}.jpg`);
  const key = JSON.stringify({ v: 2, src: item.src, start: item.start, dur: item.dur, posterAt: item.posterAt });
  const fresh = cache[item.id] === key && fs.existsSync(out) && fs.existsSync(poster);
  if (fresh && !FORCE && !REDO.has(item.id)) return false;

  const size = fitBox(meta.w, meta.h, PREVIEW_BOX);
  const scale = `scale=${size.w}:${size.h}:flags=lanczos,setsar=1`;
  const vf = meta.fps > 31 ? `fps=30,${scale}` : scale;
  const src = path.join(VIDEOS_DIR, item.src);

  run(FFMPEG, [
    '-v', 'error', '-y', '-ss', String(item.start), '-t', String(item.dur), '-i', src,
    '-vf', vf, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-pix_fmt', 'yuv420p',
    '-profile:v', 'high', '-movflags', '+faststart', out,
  ]);
  const posterAt = item.posterAt ?? item.start + Math.min(1, item.dur / 4);
  run(FFMPEG, ['-v', 'error', '-y', '-ss', String(posterAt), '-i', src, '-frames:v', '1', '-vf', scale, '-q:v', '4', poster]);
  cache[item.id] = key;
  return true;
}

// Hero tiles: short, small loops of the strongest moments, scattered around the headline.
function buildTile(tile, name, item, meta, cache) {
  const out = path.join(TILE_DIR, `${name}.mp4`);
  const poster = path.join(TILE_DIR, `${name}.jpg`);
  const key = JSON.stringify({ v: 1, src: item.src, at: tile.at, dur: tile.dur });
  if (!FORCE && cache[`tile:${name}`] === key && fs.existsSync(out) && fs.existsSync(poster)) return false;

  const size = fitBox(meta.w, meta.h, TILE_BOX);
  const scale = `scale=${size.w}:${size.h}:flags=lanczos,setsar=1`;
  const vf = meta.fps > 31 ? `fps=30,${scale}` : scale;
  const src = path.join(VIDEOS_DIR, item.src);
  run(FFMPEG, [
    '-v', 'error', '-y', '-ss', String(tile.at), '-t', String(tile.dur), '-i', src,
    '-vf', vf, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p',
    '-profile:v', 'high', '-movflags', '+faststart', out,
  ]);
  run(FFMPEG, ['-v', 'error', '-y', '-ss', String(tile.at + tile.dur / 2), '-i', src, '-frames:v', '1', '-vf', scale, '-q:v', '5', poster]);
  cache[`tile:${name}`] = key;
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

  const cache = loadCache();
  const metaById = {};
  const out = [];
  let built = 0;
  for (const item of manifest.videos) {
    const meta = probe(path.join(VIDEOS_DIR, item.src));
    metaById[item.id] = meta;
    if (buildPreview(item, meta, cache)) {
      built++;
      console.log(`preview  ${item.id}`);
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
      duration: fmtTime(meta.duration),
      aspect: Number((size.w / size.h).toFixed(4)),
      preview: `media/previews/${item.id}.mp4`,
      poster: `media/posters/${item.id}.jpg`,
      youtube: youtubeId(item.youtube),
      // Local fallback for the full video until a YouTube link is added.
      // Only works while the site sits next to the Videos folder.
      local: `../Videos/${item.src.split('/').map(encodeURIComponent).join('/')}`,
    });
  }

  fs.mkdirSync(TILE_DIR, { recursive: true });
  const tiles = (manifest.heroTiles || []).map((tile, i) => {
    const item = byId[tile.id];
    if (!item) throw new Error(`heroTiles[${i}]: unknown video id "${tile.id}"`);
    const name = `tile-${String(i + 1).padStart(2, '0')}`;
    const meta = metaById[tile.id];
    if (buildTile(tile, name, item, meta, cache)) console.log(`tile     ${name} (${tile.id})`);
    const size = fitBox(meta.w, meta.h, TILE_BOX);
    return {
      id: tile.id,
      src: `media/tiles/${name}.mp4`,
      poster: `media/tiles/${name}.jpg`,
      aspect: Number((size.w / size.h).toFixed(4)),
    };
  });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));

  const data = { categories: manifest.categories, videos: out, tiles };
  fs.writeFileSync(
    path.join(SITE_DIR, 'data', 'videos.js'),
    `// Generated by tools/build.mjs from tools/videos.json. Edit that file, then re-run the build.\nwindow.CE_DATA = ${JSON.stringify(data, null, 2)};\n`,
  );
  console.log(`done: ${out.length} videos, ${built} previews rebuilt`);
}

main();
