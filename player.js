// Where audio files live. Set R2_BASE to your bucket's public URL
// (e.g. https://pub-xxxxxxxx.r2.dev/ or https://audio.tywwit.com/).
// When running locally, files are read from ./audio/ instead.
const R2_BASE = "https://audio.tywwit.com/";
const LOCAL = ["localhost", "127.0.0.1", ""].includes(location.hostname);
const AUDIO_BASE = LOCAL ? "/audio/" : R2_BASE;

const BAR_WIDTH = 20; // characters in the [=====-----] progress bar

const audio = document.getElementById("audio");
const root = document.getElementById("tracks");
let current = null; // { li, toggle, time, bar }

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function fmtTime(s) {
  if (!isFinite(s)) return "--:--";
  s = Math.floor(s);
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

function fmtDate(d) {
  // "2026-06-01" or "2026-06" -> "2026.06"
  return (d || "").slice(0, 7).replace("-", ".") || "----.--";
}

function bar(fraction) {
  const filled = Math.round((fraction || 0) * BAR_WIDTH);
  return "[" + "=".repeat(filled) + "-".repeat(BAR_WIDTH - filled) + "]";
}

function updateDetail() {
  if (!current) return;
  const frac = audio.duration ? audio.currentTime / audio.duration : 0;
  current.bar.textContent = bar(frac);
  current.time.textContent = fmtTime(audio.currentTime) + " / " + fmtTime(audio.duration);
}

function updateToggle() {
  if (current) current.toggle.textContent = audio.paused ? "[play]" : "[pause]";
}

function select(track, refs) {
  if (current && current.li === refs.li) {
    audio.paused ? audio.play() : audio.pause();
    return;
  }
  if (current) {
    current.li.classList.remove("active");
    current.toggle.textContent = "[play]";
  }
  current = refs;
  refs.li.classList.add("active");
  // encode each path segment so names with spaces, #, ? etc. still work
  audio.src = AUDIO_BASE + track.file.split("/").map(encodeURIComponent).join("/");
  updateDetail();
  audio.play().catch(() => {});
}

function seekTo(fraction) {
  if (!audio.duration) return;
  audio.currentTime = Math.max(0, Math.min(1, fraction)) * audio.duration;
}

function renderTrack(track) {
  const li = el("li", "track");
  const row = el("div", "track-row");
  const toggle = el("button", "track-toggle", "[play]");
  toggle.type = "button";
  toggle.setAttribute("aria-label", "play " + track.title);
  const title = el("span", "track-title");
  const link = el("a", null, track.title);
  link.href = songUrl(track);
  title.append(link);
  row.append(el("span", "track-date", fmtDate(track.date)), title, toggle);

  const detail = el("div", "track-detail");
  const seek = el("button", "seek", bar(0));
  seek.type = "button";
  seek.setAttribute("aria-label", "seek (arrow keys skip 5s)");
  const time = el("span", "track-time", "--:-- / --:--");
  detail.append(seek, " ", time);
  if (track.notes) {
    detail.append(el("br"), el("span", "track-notes", track.notes));
  }

  const refs = { li, toggle, time, bar: seek };
  toggle.addEventListener("click", () => select(track, refs));
  seek.addEventListener("click", (e) => {
    const r = seek.getBoundingClientRect();
    if (e.detail === 0) return; // keyboard "click" (enter/space): ignore
    seekTo((e.clientX - r.left) / r.width);
  });
  seek.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { audio.currentTime += 5; e.preventDefault(); }
    if (e.key === "ArrowLeft") { audio.currentTime -= 5; e.preventDefault(); }
  });

  li.append(row, detail);
  return li;
}

function renderGroup(heading, tracks) {
  const frag = document.createDocumentFragment();
  if (!tracks.length) return frag;
  frag.append(el("h2", null, heading));
  const ul = el("ul");
  tracks.forEach((t) => ul.append(renderTrack(t)));
  frag.append(ul);
  return frag;
}

audio.addEventListener("timeupdate", updateDetail);
audio.addEventListener("loadedmetadata", updateDetail);
audio.addEventListener("play", updateToggle);
audio.addEventListener("pause", updateToggle);
audio.addEventListener("ended", updateToggle);
audio.addEventListener("error", () => {
  if (current) current.time.textContent = "[could not load file]";
});

function getJSON(url) {
  return fetch(url, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  });
}

// "Like me too" -> "like-me-too". Keep in sync with slugify() in worker/tracks.js.
function slugify(s) {
  return String(s)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "track";
}

// The Worker serves /song/<slug>. A plain local server can't, so use song.html?t=<slug>.
function songUrl(track) {
  return LOCAL ? "/song.html?t=" + encodeURIComponent(track.slug) : "/song/" + encodeURIComponent(track.slug);
}

// one song, with its player line always open (song.html)
function renderSong(track) {
  const box = el("div", "song active");
  box.append(el("h2", null, track.title));
  box.append(el("p", "song-meta", fmtDate(track.date) + " " + (track.type === "demo" ? "demo" : "release")));

  const line = el("p", "song-player");
  const toggle = el("button", "track-toggle", "[play]");
  toggle.type = "button";
  toggle.setAttribute("aria-label", "play " + track.title);
  const seek = el("button", "seek", bar(0));
  seek.type = "button";
  seek.setAttribute("aria-label", "seek (arrow keys skip 5s)");
  const time = el("span", "track-time", "--:-- / --:--");
  line.append(toggle, " ", seek, " ", time);
  box.append(line);

  if (track.notes) box.append(el("p", "track-notes", track.notes));

  const back = el("a", null, "<- all music");
  back.href = "/music/";
  const p = el("p", "song-back");
  p.append(back);
  box.append(p);

  const refs = { li: box, toggle, time, bar: seek };
  toggle.addEventListener("click", () => select(track, refs));
  seek.addEventListener("click", (e) => {
    if (e.detail === 0) return;
    const r = seek.getBoundingClientRect();
    seekTo((e.clientX - r.left) / r.width);
  });
  seek.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { audio.currentTime += 5; e.preventDefault(); }
    if (e.key === "ArrowLeft") { audio.currentTime -= 5; e.preventDefault(); }
  });
  return box;
}

// /api/tracks lists the R2 bucket (Cloudflare Worker in worker/). When that isn't
// available (e.g. a plain local server), fall back to tracks.json as the list.
function loadTracks() {
  return getJSON("/api/tracks")
    .then((t) => (Array.isArray(t) ? t : Promise.reject()))
    .catch(() => getJSON("/tracks.json"))
    .then((tracks) => {
      tracks = tracks.filter((t) => t && t.file && !t.hidden);
      // same order as the Worker (by file), so duplicate titles get the same suffixes
      const used = new Set();
      [...tracks].sort((a, b) => a.file.localeCompare(b.file)).forEach((t) => {
        if (!t.slug) {
          let s = slugify(t.title), base = s;
          for (let n = 2; used.has(s); n++) s = base + "-" + n;
          t.slug = s;
        }
        used.add(t.slug);
      });
      tracks.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      return tracks;
    });
}

const songRoot = document.getElementById("song");

if (root) {
  loadTracks()
    .then((tracks) => {
      root.textContent = "";
      root.append(
        renderGroup("releases", tracks.filter((t) => t.type !== "demo")),
        renderGroup("demos", tracks.filter((t) => t.type === "demo"))
      );
      if (!tracks.length) root.textContent = "nothing here yet.";
    })
    .catch(() => {
      root.textContent = "could not load tracks.";
    });
}

if (songRoot) {
  const m = location.pathname.match(/^\/song\/([^/]+)/);
  const slug = (m ? decodeURIComponent(m[1]) : new URLSearchParams(location.search).get("t") || "").toLowerCase();
  loadTracks()
    .then((tracks) => {
      const track = tracks.find((t) => t.slug === slug);
      songRoot.textContent = "";
      if (!track) {
        songRoot.append(el("p", null, "song not found."));
        const back = el("a", null, "<- all music");
        back.href = "/music/";
        songRoot.append(back);
        return;
      }
      document.title = track.title + " - tywwit.com";
      songRoot.append(renderSong(track));
    })
    .catch(() => {
      songRoot.textContent = "could not load song.";
    });
}
