# tywwit.com

A plain static site with no build step, hosted on GitHub Pages. Audio is stored in Cloudflare R2. A small Cloudflare Worker answers `tywwit.com/api/tracks` by listing the bucket.

```
index.html        home page (blank, nav only)
music/index.html  music page (track list + player)
other/index.html  other page (text / links, edit directly)
worker/           Cloudflare Worker for /api/tracks (lists the R2 bucket)
tracks.json       optional overrides (titles, dates, notes, hidden)
player.js         renders the track list, text-only audio player
style.css         layout + type
_headers          cache rules (only used on Cloudflare Pages; GitHub Pages ignores it)
```

## Adding a track

Upload the audio file to the R2 bucket. That's all. It appears on the music page within about a minute.

- Dashboard: R2 -> `tywwit-audio` -> Upload, or
  `npx wrangler r2 object put tywwit-audio/demos/sketch-4.mp3 --file ./sketch-4.mp3 --remote`
- Files inside a `demos/` folder are listed under **demos**. Everything else goes under **releases**.
- The title comes from the filename: `late-night_sketch.mp3` becomes `late night sketch`.
- The date is the upload date. Tracks are sorted newest first.
- Only audio files are listed (mp3, m4a, aac, ogg, opus, wav, flac, webm).

### Changing a title, date or notes, or hiding a file (optional)

Add an entry to `tracks.json` matched by `file`, then commit and push:

```json
[
  { "file": "demos/late-night_sketch.mp3", "title": "Late Night", "date": "2025-03", "notes": "one take" },
  { "file": "old-thing.mp3", "hidden": true }
]
```

Only the fields you list are changed. Entries for files that aren't in the bucket are ignored.

## One-time setup

The site is on GitHub Pages (custom domain in `CNAME`), and tywwit.com's DNS is on Cloudflare with the proxy (orange cloud) on.

1. **R2 bucket** `tywwit-audio`: give it the custom domain `audio.tywwit.com` (Settings -> Custom domains). `R2_BASE` in `player.js` points there.
2. **Worker**: deploy it once from the `worker/` folder:
   ```
   cd worker
   npx wrangler login
   npx wrangler deploy
   ```
   This creates the `tywwit-api` Worker, connects it to the bucket, and routes `tywwit.com/api/*` to it. Every other path still goes to GitHub Pages.
   If your bucket has a different name, change `bucket_name` in `worker/wrangler.toml` first.
   You only need to redeploy when `worker/tracks.js` changes. New audio files don't need a redeploy.
3. **Check**: https://tywwit.com/api/tracks should return a JSON list of your files.

## Local preview

**Quick (no R2):** run `python -m http.server 8000` and open http://localhost:8000.
`/api/tracks` doesn't exist on a plain server, so the music page lists `tracks.json` instead. The player reads audio from `./audio/` (gitignored).

**Worker against the real bucket:** in `worker/`, run `npx wrangler dev --remote`, then open the URL it prints followed by `/api/tracks`.
