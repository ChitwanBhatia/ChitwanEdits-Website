# ChitwanEdits-Website
This repository contains my portfolio website, featuring a curated selection of my best video editing work and projects that I can showcase to prospective clients.

## How the project is organised
```
Videos/            original footage (kept on the PC, not in this repo)
site/              the website — this folder is what gets published
  data/site.js     contact links, client reviews, client names  ← edit by hand
  data/videos.js   generated — don't edit
  media/           previews, full-watch clips, posters, hero tiles (generated)
tools/videos.json  categories, titles, YouTube links, hero tiles  ← edit by hand
tools/picks.json   preview + full-watch parts per video, saved by the clip picker
tools/build.mjs    turns those into clips + site/data/videos.js
tools/picker.html  clip picker (open through the local server)
tools/serve.mjs    local preview server
_analysis/         contact sheets and the video catalog (kept on the PC, not in this repo)
```

## Preview on this PC
```
node tools/serve.mjs
```
Then open http://localhost:8080/site/.

## Pick preview and full-watch parts
With the preview server running, open http://localhost:8080/tools/picker.html.
For each video, drag on the **Preview** lane (4–5 s, silent loop) and the **Full watch** lane (20–30 s, with sound), then **Save & next**.
Picks are saved to `tools/picks.json`; run `node tools/build.mjs` afterwards.
Only videos with a full-watch pick go on the site. Skipped videos are left off, along with their clips.
Full-watch clips are 1080p with sound and kept under 25 MB each (Cloudflare's file limit).

## Common changes
- **Add a YouTube link:** paste the link into that video's `"youtube": ""` in `tools/videos.json`, then run `node tools/build.mjs`.
- **Change a preview or full-watch clip:** re-pick it in the clip picker, then run the build. Only changed clips are re-encoded. (`"start"`/`"dur"` in videos.json are only used when no preview was picked.)
- **Change the clips scattered on the first screen:** edit the video `id`s in `heroTiles` and run the build. Each one shows that video's picked preview. The first 16 are used on desktop and the first 12 on phones.
- **Rename / recategorise / feature:** edit `title`, `cat`, or `featured` (1–3 = shown on the homepage, in that order).
- **Contact links, reviews, client names:** edit `site/data/site.js` and reload — no build needed.

## Publish
Live at https://chitwanedits.com (and www), hosted free on Cloudflare. Settings are in `wrangler.jsonc`; it uploads only `site/`.
```
npx wrangler deploy
```
The first run on a new PC asks you to log in to Cloudflare (`npx wrangler login`) and click Allow.
Clicking a video plays its full-watch clip (or its YouTube video, if a link is set).
