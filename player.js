// Where audio files live. Set R2_BASE to your bucket's public URL
// (e.g. https://pub-xxxxxxxx.r2.dev/ or https://audio.tywwit.com/).
// When running locally, files are read from ./audio/ instead.
const R2_BASE = "https://audio.tywwit.com/";
const LOCAL = ["localhost", "127.0.0.1", ""].includes(location.hostname);
const AUDIO_BASE = LOCAL ? "/audio/" : R2_BASE;

const BAR_WIDTH = 20; // characters in the [=====-----] progress bar

const audio = document.getElementById("audio");
const root = document.getElementById("tracks");
const songRoot = document.getElementById("song");
let current = null; // { track, toggle } for the track that's loaded

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

// ---- now-playing line, fixed to the bottom of the page ----
// [pause] title ............ [=======-------------] 00:02 / 02:56

const np = el("div", "now-playing");
np.hidden = true;
np.setAttribute("aria-label", "now playing");
const npToggle = el("button", "track-toggle", "[play]");
npToggle.type = "button";
const npTitle = el("a", "np-title");
const npSeek = el("button", "seek", bar(0));
npSeek.type = "button";
npSeek.setAttribute("aria-label", "seek (arrow keys skip 5s)");
const npTime = el("span", "track-time", "--:-- / --:--");
const npTitleWrap = el("span", "np-title-wrap");
npTitleWrap.append(npTitle);
np.append(npToggle, npTitleWrap, npSeek, npTime);
document.body.append(np);

npToggle.addEventListener("click", () => {
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
});
npSeek.addEventListener("click", (e) => {
  if (e.detail === 0) return; // keyboard "click" (enter/space): ignore
  const r = npSeek.getBoundingClientRect();
  seekTo((e.clientX - r.left) / r.width);
});
npSeek.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") { audio.currentTime += 5; e.preventDefault(); }
  if (e.key === "ArrowLeft") { audio.currentTime -= 5; e.preventDefault(); }
});

function updateProgress() {
  if (!current) return;
  const frac = audio.duration ? audio.currentTime / audio.duration : 0;
  npSeek.textContent = bar(frac);
  npTime.textContent = fmtTime(audio.currentTime) + " / " + fmtTime(audio.duration);
}

function updateToggle() {
  if (!current) return;
  const label = audio.paused ? "[play]" : "[pause]";
  current.toggle.textContent = label;
  npToggle.textContent = label;
}

function select(track, toggle) {
  if (current && current.toggle === toggle) {
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
    return;
  }
  if (current) current.toggle.textContent = "[play]";
  current = { track, toggle };
  // encode each path segment so names with spaces, #, ? etc. still work
  audio.src = AUDIO_BASE + track.file.split("/").map(encodeURIComponent).join("/");
  npTitle.textContent = track.title;
  npTitle.href = songUrl(track);
  npToggle.setAttribute("aria-label", "play/pause " + track.title);
  np.hidden = false;
  document.body.classList.add("has-player");
  updateProgress();
  audio.play().catch(() => {});
}

function seekTo(fraction) {
  if (!audio.duration) return;
  audio.currentTime = Math.max(0, Math.min(1, fraction)) * audio.duration;
}

audio.addEventListener("timeupdate", updateProgress);
audio.addEventListener("loadedmetadata", updateProgress);
audio.addEventListener("play", updateToggle);
audio.addEventListener("pause", updateToggle);
audio.addEventListener("ended", updateToggle);
audio.addEventListener("error", () => {
  if (current) npTime.textContent = "[could not load file]";
});

// ---- music page list ----

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
  toggle.addEventListener("click", () => select(track, toggle));
  li.append(row);
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

// ---- single song page (song.html) ----

function renderSong(track) {
  const box = el("div", "song");
  box.append(el("h2", null, track.title));
  box.append(el("p", "song-meta", fmtDate(track.date) + " " + (track.type === "demo" ? "demo" : "release")));

  const toggle = el("button", "track-toggle", "[play]");
  toggle.type = "button";
  toggle.setAttribute("aria-label", "play " + track.title);
  toggle.addEventListener("click", () => select(track, toggle));
  const line = el("p", "song-player");
  line.append(toggle);
  box.append(line);

  if (track.notes) box.append(el("p", "track-notes", track.notes));

  const back = el("a", null, "<- all music");
  back.href = "/music/";
  const p = el("p", "song-back");
  p.append(back);
  box.append(p);
  return box;
}

// ---- data ----

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
