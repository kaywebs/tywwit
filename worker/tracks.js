// Cloudflare Worker: answers https://tywwit.com/api/tracks by listing every
// audio file in the R2 bucket bound as AUDIO (see worker/wrangler.toml).
// The rest of the site is static on GitHub Pages; this only handles /api/*.
//
// Each file becomes a track automatically:
//   key  "demos/late-night_sketch.mp3"
//   ->   { file: "demos/late-night_sketch.mp3", title: "late night sketch",
//          type: "demo", date: <upload date> }
// Anything inside a "demos/" folder is a demo; everything else is a release.
//
// /tracks.json is optional and only overrides fields, matched by "file":
//   [{ "file": "demos/late-night_sketch.mp3", "title": "Late Night", "date": "2025-03", "notes": "..." },
//    { "file": "old-thing.mp3", "hidden": true }]

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.replace(/\/$/, "") !== "/api/tracks") {
      return json({ error: "not found" }, 404);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "method not allowed" }, 405);
    }
    return listTracks(request, env);
  },
};

async function listTracks(request, env) {
  if (!env.AUDIO) {
    return json({ error: "R2 binding AUDIO is not configured" }, 500);
  }

  // list the whole bucket (R2 returns up to 1000 keys per page)
  const objects = [];
  let cursor;
  do {
    const page = await env.AUDIO.list({ cursor, include: ["customMetadata"] });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const overrides = await loadOverrides(request, env);

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
    tracks.push(track);
  }

  return json(tracks, 200, { "Cache-Control": "public, max-age=60" });
}

function titleFromKey(key) {
  return key
    .split("/").pop()
    .replace(AUDIO_EXT, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

async function loadOverrides(request, env) {
  const map = new Map();
  try {
    // /tracks.json isn't under /api/*, so this goes to GitHub Pages, not back to this Worker
    const res = await fetch(new URL("/tracks.json", request.url), {
      cf: { cacheTtl: 60 },
    });
    if (!res.ok) return map;
    const list = await res.json();
    for (const t of list) if (t && t.file) map.set(t.file, t);
  } catch (e) {
    // no overrides file, or it's invalid JSON: just use what's in the bucket
  }
  return map;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}
