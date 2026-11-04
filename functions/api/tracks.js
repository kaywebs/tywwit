// GET /api/tracks — lists every audio file in the R2 bucket bound as AUDIO.
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

export async function onRequestGet({ request, env }) {
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
    const res = await env.ASSETS.fetch(new URL("/tracks.json", request.url));
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
