// Local preview server with HTTP range support (needed for video seeking).
// Serves the project root so site/ can reach the original files in Videos/.
//   node tools/serve.mjs   ->  http://localhost:8080/site/
// The clip picker (http://localhost:8080/tools/picker.html) saves to tools/picks.json via POST /api/picks.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const PICKS_FILE = path.join(ROOT, 'tools', 'picks.json');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

// Stores one video's chosen time ranges: { id, preview: [[start, end], ...], watch: [[start, end], ...] }.
function savePicks(req, res) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 100000) req.destroy();
  });
  req.on('end', () => {
    const reply = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    try {
      const { id, preview, watch } = JSON.parse(body);
      if (!/^[\w-]+$/.test(id || '')) throw new Error('Bad video id');
      const ranges = (list) => (Array.isArray(list) ? list : [])
        .map(([s, e]) => [Math.round(s * 100) / 100, Math.round(e * 100) / 100])
        .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && s >= 0 && e > s);
      const picks = fs.existsSync(PICKS_FILE) ? JSON.parse(fs.readFileSync(PICKS_FILE, 'utf8')) : {};
      picks[id] = { preview: ranges(preview), watch: ranges(watch), saved: new Date().toISOString() };
      fs.writeFileSync(PICKS_FILE, `${JSON.stringify(picks, null, 2)}\n`);
      reply(200, { ok: true, saved: picks[id] });
    } catch (err) {
      reply(400, { ok: false, error: err.message });
    }
  });
}

http
  .createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (req.method === 'POST' && rel === '/api/picks') return savePicks(req, res);
    if (rel === '/') {
      res.writeHead(302, { Location: '/site/' });
      return res.end();
    }
    let file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end();
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!rel.endsWith('/')) {
        res.writeHead(301, { Location: `${rel}/` });
        return res.end();
      }
      file = path.join(file, 'index.html');
    }
    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }

    const size = fs.statSync(file).size;
    // The originals in Videos/ include MP4s saved without an extension.
    const type = TYPES[path.extname(file).toLowerCase()]
      || (file.includes(`${path.sep}Videos${path.sep}`) ? 'video/mp4' : 'application/octet-stream');
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);

    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, '127.0.0.1', () => console.log(`Serving ${ROOT} at http://localhost:${PORT}/site/`));
