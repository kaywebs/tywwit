# tywwit.com

A plain static site with no build step. Audio is stored in Cloudflare R2 and the site is served by Cloudflare Pages.

```
index.html        home page (blank, nav only)
music/index.html  music page (track list + player)
other/index.html  other page (text / links, edit directly)
functions/api/tracks.js  lists the R2 bucket at /api/tracks (Pages Function)
tracks.json       optional overrides (titles, dates, notes, hidden)
player.js         renders the track list, text-only audio player
wrangler.toml     Pages config + the R2 bucket binding
style.css         layout + type
_headers          cache rules for Cloudflare Pages
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

## One-time Cloudflare setup

1. **R2 bucket**: go to Dashboard -> R2 -> Create bucket and name it `tywwit-audio`.
   Under Settings -> Public access, enable the **r2.dev subdomain**, then copy the URL into `R2_BASE` at the top of `player.js`. Keep the trailing `/`.
2. **Pages**: push this repo to GitHub, then go to Dashboard -> Workers & Pages -> Create -> Pages -> Connect to Git.
   Set the build command to nothing and the output directory to `/`. The site goes live at `<project>.pages.dev`.
   The R2 binding comes from `wrangler.toml` (binding `AUDIO` -> bucket `tywwit-audio`). If your bucket has a different name, change `bucket_name` there.
   (Or skip GitHub: `npx wrangler pages deploy . --project-name tywwit`.)
3. **Domain (later)**: add `tywwit.com` to Cloudflare and change the nameservers at your registrar. Then:
   - Pages project -> Custom domains -> add `tywwit.com`
   - R2 bucket -> Settings -> Custom domains -> add `audio.tywwit.com`, then set `R2_BASE = "https://audio.tywwit.com/"`. The r2.dev URL is rate-limited, so it's only good for the start.

## Local preview

**Quick (no R2):** run `python -m http.server 8000` and open http://localhost:8000.
`/api/tracks` doesn't exist on a plain server, so the music page lists `tracks.json` instead. The player reads audio from `./audio/` (gitignored).

**With the function:** run `npx wrangler pages dev .`. This runs `/api/tracks` against a local, empty copy of the bucket. To fill it, run `npx wrangler r2 object put tywwit-audio/test.mp3 --file ./test.mp3 --local`.
