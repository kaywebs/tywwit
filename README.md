# tywwit.com

A plain static site with no build step. Audio is stored in Cloudflare R2 and the site is served by Cloudflare Pages.

```
index.html        home page (blank, nav only)
music/index.html  music page (track list + player)
other/index.html  other page (text / links, edit directly)
tracks.json       the track list
player.js         renders tracks.json, text-only audio player
style.css         layout + type
_headers          cache rules for Cloudflare Pages
```

## Adding a track

1. Upload the audio file to the R2 bucket, either in the dashboard (R2 -> `tywwit-audio` -> Upload) or with:
   `npx wrangler r2 object put tywwit-audio/demos/sketch-4.mp3 --file ./sketch-4.mp3 --remote`
2. Add an entry to `tracks.json`:
   ```json
   { "title": "sketch 4", "date": "2026-11-03", "type": "demo", "file": "demos/sketch-4.mp3", "notes": "optional" }
   ```
   `type` is `"release"` or `"demo"`. `file` is the object's path inside the bucket. Tracks are sorted newest first.
3. Commit and push. Pages redeploys on its own.

## One-time Cloudflare setup

1. **R2 bucket**: go to Dashboard -> R2 -> Create bucket and name it `tywwit-audio`.
   Under Settings -> Public access, enable the **r2.dev subdomain**, then copy the URL into `R2_BASE` at the top of `player.js`. Keep the trailing `/`.
2. **Pages**: push this repo to GitHub, then go to Dashboard -> Workers & Pages -> Create -> Pages -> Connect to Git.
   Set the build command to nothing and the output directory to `/`. The site goes live at `<project>.pages.dev`.
   (Or skip GitHub: `npx wrangler pages deploy . --project-name tywwit`.)
3. **Domain (later)**: add `tywwit.com` to Cloudflare and change the nameservers at your registrar. Then:
   - Pages project -> Custom domains -> add `tywwit.com`
   - R2 bucket -> Settings -> Custom domains -> add `audio.tywwit.com`, then set `R2_BASE = "https://audio.tywwit.com/"`. The r2.dev URL is rate-limited, so it's only good for the start.

## Local preview

Put test mp3s in `./audio/` (gitignored) at the same paths as in `tracks.json`, then run:

```
python -m http.server 8000
```

Open http://localhost:8000. When the site runs on localhost, the player reads from `/audio/` instead of R2.
