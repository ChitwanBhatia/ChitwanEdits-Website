# ChitwanEdits-Website
This repository contains my portfolio website, featuring a curated selection of my best video editing work and projects that I can showcase to prospective clients.

## How the project is organised
```
Videos/            original footage (kept on the PC, not in this repo)
site/              the website — this folder is what gets published
  data/site.js     contact links, client reviews, client names  ← edit by hand
  data/videos.js   generated — don't edit
  media/           preview clips, posters, hero tiles (generated)
tools/videos.json  categories, titles, preview timestamps, YouTube links, hero tiles  ← edit by hand
tools/build.mjs    turns videos.json into previews + site/data/videos.js
tools/serve.mjs    local preview server
_analysis/         contact sheets and the video catalog (kept on the PC, not in this repo)
```

## Preview on this PC
```
node tools/serve.mjs
```
Then open http://localhost:8080/site/ — clicking a video plays the original from `Videos/` until it has a YouTube link.

## Common changes
- **Add a YouTube link:** paste the link into that video's `"youtube": ""` in `tools/videos.json`, then run `node tools/build.mjs`.
- **Change a preview:** edit `"start"` (seconds) and `"dur"` for that video, then run the build. Only changed clips are re-encoded.
- **Change the clips scattered on the first screen:** edit `heroTiles` (video `id`, `at` seconds, `dur`) and run the build. The first 16 are used on desktop, 12 on phones.
- **Rename / recategorise / feature:** edit `title`, `cat`, or `featured` (1–3 = shown on the homepage, in that order).
- **Contact links, reviews, client names:** edit `site/data/site.js` and reload — no build needed.

## Publish
Upload only the `site/` folder (≈25 MB) to Netlify, Vercel, Cloudflare Pages or GitHub Pages.
Every video should have a YouTube link first; without one, the player falls back to the looping preview.
