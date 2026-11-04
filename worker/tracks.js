// Cloudflare Worker for tywwit.com (see worker/wrangler.toml). The rest of the
// site is static on GitHub Pages; this Worker only handles two paths:
//
//   /api/tracks    JSON list of every audio file in the R2 bucket bound as AUDIO
//   /song/<slug>   a page for one song (the static /song.html, with that song's
//                  title filled into <title> and the share-preview tags)
//
// Each file becomes a track automatically:
//   key  "demos/late-night_sketch.mp3"
//   ->   { file: "demos/late-night_sketch.mp3", title: "late night sketch",
//          slug: "late-night-sketch", type: "demo", date: <upload date> }
// Anything inside a "demos/" folder is a demo; everything else is a release.
//
// /tracks.json is optional and only overrides fields, matched by "file":
//   [{ "file": "demos/late-night_sketch.mp3", "title": "Late Night", "date": "2025-03", "notes": "..." },
//    { "file": "Smoke.mp3", "slug": "smoke" },          <- pin a song's link
//    { "file": "old-thing.mp3", "hidden": true }]

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;

const FRESH_MS = 60 * 1000;        // rebuild the list in the background once it's older than this
const OVERRIDES_TIMEOUT_MS = 3000; // give up on GitHub Pages' /tracks.json after this

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return text("method not allowed", 405);
    }
    if (url.pathname.replace(/\/$/, "") === "/api/tracks") {
      if (!env.AUDIO) return json({ error: "R2 binding AUDIO is not configured" }, 500);
      return json(await getTracks(request, env, ctx), 200, { "Cache-Control": "public, max-age=60" });
    }
    const song = url.pathname.match(/^\/song\/([^/]+)\/?$/);
    if (song) return songPage(request, env, ctx, decodeURIComponent(song[1]).toLowerCase());
    return json({ error: "not found" }, 404);
  },
};

// The finished list is kept in Cloudflare's edge cache, so a visitor almost never
// waits on R2 or GitHub: a cached copy is returned at once, and if it's more than
// a minute old it's rebuilt in the background for the next visitor
// (stale-while-revalidate). Only the very first request (or one after the cache
// was evicted) builds the list while the visitor waits.
async function getTracks(request, env, ctx) {
  const cache = caches.default;
  const key = new Request(new URL("/__cache/tracks-v1", request.url));
  const hit = await cache.match(key);
  if (hit) {
    const age = Date.now() - Number(hit.headers.get("x-built-at") || 0);
    if (age > FRESH_MS) ctx.waitUntil(rebuild(request, env, cache, key, true).catch(() => {}));
    return hit.json();
  }
  return rebuild(request, env, cache, key, false);
}

async function rebuild(request, env, cache, key, haveOld) {
  const { tracks, complete } = await listTracks(request, env);
  // if /tracks.json couldn't be fetched, don't replace a good cached list with one missing its overrides
  if (!complete && haveOld) return tracks;
  const res = json(tracks, 200, {
    "Cache-Control": "public, max-age=86400",
    // an incomplete list is marked as already stale, so the next request retries it
    "x-built-at": String(complete ? Date.now() : 0),
  });
  await cache.put(key, res);
  return tracks;
}

async function listTracks(request, env) {
  // list the whole bucket (R2 returns up to 1000 keys per page)
  const objects = [];
  let cursor;
  do {
    const page = await env.AUDIO.list({ cursor, include: ["customMetadata"] });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  // stable order, so duplicate titles always get the same "-2", "-3" suffixes
  objects.sort((a, b) => a.key.localeCompare(b.key));

  const { map: overrides, ok: complete } = await loadOverrides(request);
  const used = new Set();
  const tracks = [];
  for (const obj of objects) {
    if (!AUDIO_EXT.test(obj.key)) continue;
    const meta = obj.customMetadata || {};
    const base = {
      file: obj.key,
      title: meta.title || titleFromKey(obj.key),
      type: /^demos\//i.test(obj.key) ? "demo" : "release",
      date: meta.date || obj.uploaded.toISOString().slice(0, 10),
    };
    if (meta.notes) base.notes = meta.notes;
    const track = { ...base, ...(overrides.get(obj.key) || {}) };
    if (track.hidden) continue;
    track.slug = uniqueSlug(slugify(track.slug || track.title), used);
    tracks.push(track);
  }
  return { tracks, complete };
}

async function songPage(request, env, ctx, slug) {
  const [page, tracks] = await Promise.all([
    fetch(new URL("/song.html", request.url), { cf: { cacheTtl: 300 } }),
    env.AUDIO ? getTracks(request, env, ctx) : Promise.resolve(null),
  ]);
  if (!page.ok || !tracks) return page;

  const track = tracks.find((t) => t.slug === slug);
  const title = track ? track.title + " - tywwit.com" : "not found - tywwit.com";
  const desc = track
    ? (track.notes || (track.type === "demo" ? "demo" : "release") + " by Tyler Witkowski")
    : "song not found";
  const set = (attr, value) => ({ element: (el) => el.setAttribute(attr, value) });

  const res = new HTMLRewriter()
    .on("title", { element: (el) => el.setInnerContent(title) })
    .on('meta[property="og:title"]', set("content", title))
    .on('meta[name="description"], meta[property="og:description"]', set("content", desc))
    .on('meta[property="og:url"]', set("content", new URL(request.url).href))
    .transform(page);

  return new Response(res.body, {
    status: track ? 200 : 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" },
  });
}

function titleFromKey(key) {
  return key
    .split("/").pop()
    .replace(AUDIO_EXT, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

// "Like me too" -> "like-me-too". Keep in sync with slugify() in player.js.
function slugify(s) {
  return String(s)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "track";
}

function uniqueSlug(slug, used) {
  let s = slug;
  for (let n = 2; used.has(s); n++) s = slug + "-" + n;
  used.add(s);
  return s;
}

// Returns { map, ok }. ok is false when GitHub Pages was slow or failing, so the
// caller knows the list may be missing overrides. A missing file (404) is fine.
async function loadOverrides(request) {
  const map = new Map();
  try {
    // /tracks.json isn't under this Worker's routes, so this goes to GitHub Pages
    const res = await fetch(new URL("/tracks.json", request.url), {
      cf: { cacheTtl: 60 },
      signal: AbortSignal.timeout(OVERRIDES_TIMEOUT_MS),
    });
    if (res.status === 404) return { map, ok: true };
    if (!res.ok) return { map, ok: false };
    const list = await res.json();
    for (const t of list) if (t && t.file) map.set(t.file, t);
    return { map, ok: true };
  } catch (e) {
    // timed out, network error, or invalid JSON: use what's in the bucket for now
    return { map, ok: false };
  }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function text(body, status) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
