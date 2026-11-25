// Where audio files live. Set R2_BASE to your bucket's public URL
// (e.g. https://pub-xxxxxxxx.r2.dev/ or https://audio.tywwit.com/).
// When running locally, files are read from ./audio/ instead.
const R2_BASE = "https://audio.tywwit.com/";
const LOCAL = ["localhost", "127.0.0.1", ""].includes(location.hostname);
const AUDIO_BASE = LOCAL ? "/audio/" : R2_BASE;

const audio = document.getElementById("audio");
const root = document.getElementById("tracks");
const songRoot = document.getElementById("song");

// Each track row looks like:
//   2026.11 [pause] kehler is a weeb ======............ 00:42 / 02:56
// The dots are the progress bar: they fill with "=" as the song plays.
let current = null;     // the row whose song is loaded in <audio>
let pendingSeek = null; // 0..1, applied once the loading song's length is known

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

// encode each path segment so names with spaces, #, ? etc. still work
function audioUrl(track) {
  return AUDIO_BASE + track.file.split("/").map(encodeURIComponent).join("/");
}

// ---- volume: "vol [=======---]" on the heading line ----
// "vol" mutes/unmutes, the bar sets the level (click a cell, or arrow keys)

const VOL_CELLS = 10;
const volBox = el("span", "vol-box");
const volMute = el("button", "vol-mute", "vol");
volMute.type = "button";
volMute.setAttribute("aria-label", "mute");
const volBar = el("button", "vol-bar");
volBar.type = "button";
volBar.setAttribute("aria-label", "volume (arrow keys change it)");
volBox.append(volMute, " ", volBar);

let level = 1; // 0..1 as shown on the bar; the audio gets level² so steps sound even
try {
  const saved = parseFloat(localStorage.getItem("volume"));
  if (saved >= 0 && saved <= 1) level = saved;
} catch (e) {}

function setLevel(v) {
  level = Math.round(Math.max(0, Math.min(1, v)) * VOL_CELLS) / VOL_CELLS;
  audio.volume = level * level;
  audio.muted = false;
  try { localStorage.setItem("volume", String(level)); } catch (e) {}
  drawVolume();
}

function drawVolume() {
  const filled = audio.muted ? 0 : Math.round(level * VOL_CELLS);
  volBar.textContent = "[" + "=".repeat(filled) + "-".repeat(VOL_CELLS - filled) + "]";
  volBar.setAttribute("aria-valuetext", audio.muted ? "muted" : Math.round(level * 100) + "%");
  volMute.textContent = audio.muted ? "off" : "vol";
  volMute.setAttribute("aria-label", audio.muted ? "unmute" : "mute");
}

volMute.addEventListener("click", () => {
  audio.muted = !audio.muted;
  drawVolume();
});
volBar.addEventListener("click", (e) => {
  if (e.detail === 0) return; // keyboard "click": ignore
  const r = volBar.getBoundingClientRect();
  // which character was clicked: "[" = silent, "]" = full, cells in between = 10%..100%
  const ch = Math.floor(((e.clientX - r.left) / r.width) * (VOL_CELLS + 2));
  setLevel(Math.max(0, Math.min(VOL_CELLS, ch)) / VOL_CELLS);
});
volBar.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === "ArrowUp") { setLevel(level + 1 / VOL_CELLS); e.preventDefault(); }
  if (e.key === "ArrowLeft" || e.key === "ArrowDown") { setLevel(level - 1 / VOL_CELLS); e.preventDefault(); }
});

// some browsers (iPhone/iPad Safari) don't let pages change volume: hide the control there
audio.volume = 0.5;
if (audio.volume !== 0.5) volBox.hidden = true;
audio.volume = level * level;
drawVolume();

// ---- song lengths: remembered in this browser, measured in the background ----

const DUR_KEY = "durations-v1";
let durations = {};
try { durations = JSON.parse(localStorage.getItem(DUR_KEY)) || {}; } catch (e) {}

// a remembered length only counts if the track's date still matches (a re-upload gets re-measured)
function knownDuration(track) {
  const e = durations[track.file];
  return e && e.date === (track.date || "") ? e.d : null;
}

function saveDuration(track, d) {
  if (!isFinite(d) || d <= 0) return;
  durations[track.file] = { d: Math.round(d * 10) / 10, date: track.date || "" };
  try { localStorage.setItem(DUR_KEY, JSON.stringify(durations)); } catch (e) {}
  (rowsByFile.get(track.file) || []).forEach(drawTime);
}

// reads just enough of a file to learn its length; null if it fails or takes >15s
function probeDuration(track) {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = "metadata";
    a.muted = true;
    let done = false;
    const finish = (d) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      a.removeAttribute("src"); // stop downloading
      try { a.load(); } catch (e) {}
      resolve(d);
    };
    const timer = setTimeout(() => finish(null), 15000);
    a.addEventListener("loadedmetadata", () => finish(isFinite(a.duration) ? a.duration : null));
    a.addEventListener("error", () => finish(null));
    a.src = audioUrl(track);
  });
}

let measureGen = 0; // bumped on every re-render, so an old queue stops
function measureDurations(tracks) {
  const gen = ++measureGen;
  const todo = tracks.filter((t) => knownDuration(t) == null);
  let i = 0;
  const next = () => {
    if (gen !== measureGen || i >= todo.length) return;
    const t = todo[i++];
    probeDuration(t)
      .then((d) => { if (d) saveDuration(t, d); })
      .finally(next);
  };
  next(); next(); // two at a time
}

// ---- drawing the dots / progress bar ----

let chPx = 0; // width of one character in the row font

function measureCh() {
  const probe = el("span", null, "0000000000");
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
  (root || songRoot || document.body).append(probe);
  chPx = probe.getBoundingClientRect().width / 10 || 9.6;
  probe.remove();
}

const rowsByFile = new Map(); // file -> [row refs], for filling in lengths
const rowByBar = new WeakMap();
const resizeObs = typeof ResizeObserver !== "undefined"
  ? new ResizeObserver((entries) => entries.forEach((e) => {
      const r = rowByBar.get(e.target);
      if (r) drawBar(r);
    }))
  : null;

function allRows() {
  return [].concat(...rowsByFile.values());
}

function drawBar(r) {
  if (!chPx) measureCh();
  const n = Math.max(0, Math.floor(r.bar.clientWidth / chPx + 0.01));
  const filled = Math.min(n, Math.round(r.frac * n));
  r.played.textContent = "=".repeat(filled);
  r.rest.textContent = ".".repeat(n - filled);
}

function drawTime(r) {
  const before = r.time.textContent.length;
  if (r === current) {
    const d = isFinite(audio.duration) ? audio.duration : knownDuration(r.track);
    // until the new file has loaded, audio.currentTime can still be the previous song's
    const t = audio.readyState > 0 ? audio.currentTime : (pendingSeek && d ? pendingSeek * d : 0);
    r.time.textContent = fmtTime(t) + " / " + fmtTime(d);
  } else {
    const d = knownDuration(r.track);
    r.time.textContent = d ? fmtTime(d) : "--:--";
  }
  // "03:12" <-> "00:42 / 03:12" changes how much room the dots have: redraw them now
  if (r.time.textContent.length !== before) drawBar(r);
}

// the real font (IBM Plex Mono) arrives after the fallback, with a different width
if (document.fonts && document.fonts.ready) {
  const remeasure = () => { measureCh(); allRows().forEach(drawBar); };
  document.fonts.ready.then(remeasure);
  document.fonts.addEventListener && document.fonts.addEventListener("loadingdone", remeasure);
}
window.addEventListener("resize", () => allRows().forEach(drawBar));

// ---- playback ----

function updateToggle() {
  if (!current) return;
  current.toggle.textContent = audio.paused ? "[play]" : "[pause]";
  current.toggle.setAttribute("aria-label", (audio.paused ? "play " : "pause ") + current.track.title);
}

function resetRow(r) {
  r.li.classList.remove("playing");
  r.frac = 0;
  r.toggle.textContent = "[play]";
  r.toggle.setAttribute("aria-label", "play " + r.track.title);
  drawBar(r);
  drawTime(r);
}

function play() {
  audio.play().catch(() => {});
}

// start (or pause/resume) a row's song; seekFrac (0..1) jumps to that point
function select(r, seekFrac) {
  if (current === r) {
    if (seekFrac != null) {
      seekTo(seekFrac);
      if (audio.paused) play();
    } else if (audio.paused) {
      play();
    } else {
      audio.pause();
    }
    return;
  }
  if (current) {
    const prev = current;
    current = null;
    resetRow(prev);
  }
  current = r;
  r.li.classList.add("playing");
  pendingSeek = seekFrac != null ? seekFrac : null;
  audio.src = audioUrl(r.track);
  r.frac = seekFrac || 0;
  drawBar(r);
  drawTime(r);
  play();
}

function seekTo(fraction) {
  fraction = Math.max(0, Math.min(1, fraction));
  if (isFinite(audio.duration) && audio.duration > 0) audio.currentTime = fraction * audio.duration;
  else pendingSeek = fraction;
}

function updateProgress() {
  if (!current) return;
  if (isFinite(audio.duration) && audio.duration > 0) current.frac = audio.currentTime / audio.duration;
  drawBar(current);
  drawTime(current);
}

audio.addEventListener("loadedmetadata", () => {
  if (!current) return;
  saveDuration(current.track, audio.duration);
  if (pendingSeek != null) {
    const f = pendingSeek;
    pendingSeek = null;
    seekTo(f);
  }
  updateProgress();
});
audio.addEventListener("durationchange", () => {
  if (current) saveDuration(current.track, audio.duration);
});
audio.addEventListener("timeupdate", updateProgress);
audio.addEventListener("play", updateToggle);
audio.addEventListener("pause", updateToggle);
audio.addEventListener("ended", updateToggle);
audio.addEventListener("error", () => {
  if (current && audio.getAttribute("src")) current.time.textContent = "[error]";
});

// ---- track rows ----

// compact: no date or title (used on a song's own page)
function renderTrack(track, compact) {
  const li = el("li", "track");
  const row = el("div", "track-row");
  if (!compact) row.append(el("span", "track-date", fmtDate(track.date)));

  const cell = el("span", "toggle-cell");
  const toggle = el("button", "track-toggle", "[play]");
  toggle.type = "button";
  toggle.setAttribute("aria-label", "play " + track.title);
  cell.append(toggle);
  row.append(cell);

  if (!compact) {
    const title = el("span", "track-title");
    const link = el("a", null, track.title);
    link.href = songUrl(track);
    title.append(link);
    row.append(title);
  }

  const bar = el("button", "track-bar");
  bar.type = "button";
  bar.setAttribute("aria-label", "progress of " + track.title + " (click to jump, arrow keys skip 5s)");
  const played = el("span", "played");
  const rest = el("span", "rest");
  bar.append(played, rest);
  const time = el("span", "track-time", "--:--");
  row.append(bar, time);
  li.append(row);

  const r = { track, li, toggle, bar, played, rest, time, frac: 0 };
  if (!rowsByFile.has(track.file)) rowsByFile.set(track.file, []);
  rowsByFile.get(track.file).push(r);
  rowByBar.set(bar, r);
  if (resizeObs) resizeObs.observe(bar);
  drawTime(r);

  toggle.addEventListener("click", () => select(r));
  bar.addEventListener("click", (e) => {
    if (e.detail === 0) return; // keyboard "click" (enter/space): ignore
    const rect = bar.getBoundingClientRect();
    select(r, (e.clientX - rect.left) / rect.width);
  });
  bar.addEventListener("keydown", (e) => {
    if (current !== r) return;
    if (e.key === "ArrowRight") { audio.currentTime += 5; e.preventDefault(); }
    if (e.key === "ArrowLeft") { audio.currentTime -= 5; e.preventDefault(); }
  });
  return li;
}

// forget the old rows before drawing new ones
function clearRows() {
  rowsByFile.clear();
  if (resizeObs) resizeObs.disconnect();
}

// ---- music page list ----

function renderList(tracks) {
  clearRows();
  root.textContent = "";
  if (!tracks.length) {
    root.textContent = "nothing here yet.";
    return;
  }
  const head = el("h2", "list-head");
  head.append(el("span", null, "demos & releases"), volBox);
  const ul = el("ul");
  tracks.forEach((t) => ul.append(renderTrack(t, false)));
  root.append(head, ul);
  allRows().forEach(drawBar);
  measureDurations(tracks);
}

// ---- single song page (song.html) ----

function renderSong(track) {
  clearRows();
  const box = el("div", "song");
  box.append(el("h2", null, track.title));

  const meta = el("p", "song-meta");
  meta.append(el("span", null, fmtDate(track.date) + " " + (track.type === "demo" ? "demo" : "release")), volBox);
  box.append(meta);

  const ul = el("ul", "song-track");
  ul.append(renderTrack(track, true));
  box.append(ul);

  if (track.notes) box.append(el("p", "track-notes", track.notes));

  const back = el("a", null, "<- all music");
  back.href = "/music/";
  const p = el("p", "song-back");
  p.append(back);
  box.append(p);
  return box;
}

// ---- data ----

// Gives up after timeoutMs, so one stalled connection can't leave the page on
// "loading..." for ages; loadTracks() then retries on a fresh request.
function getJSON(url, timeoutMs = 4000) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl && setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { cache: "no-cache", signal: ctrl && ctrl.signal })
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .finally(() => clearTimeout(timer));
}

function getTrackList() {
  const api = () => getJSON("/api/tracks").then((t) => (Array.isArray(t) ? t : Promise.reject(new Error("bad list"))));
  return api()
    .catch(() => api()) // one retry
    // tracks.json is only a real list on a plain local server; live, it's just overrides
    .catch((e) => (LOCAL ? getJSON("/tracks.json") : Promise.reject(e)));
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

function prepare(tracks) {
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
}

// The last list we saw is kept in this browser, so the page can show it
// instantly instead of "loading...". A fresh copy is always fetched too.
const CACHE_KEY = "tracks-cache-v1";

function readCacheRaw() {
  try { return localStorage.getItem(CACHE_KEY); } catch (e) { return null; }
}

function writeCache(raw) {
  try { localStorage.setItem(CACHE_KEY, raw); } catch (e) {}
}

// Calls show(tracks, { fresh, changed }):
//   - right away with the remembered list, if there is one (fresh: false)
//   - then with the list from the server (fresh: true; changed: false if it
//     matches what was already shown)
// Calls fail() if nothing could be shown at all.
//
// /api/tracks lists the R2 bucket (Cloudflare Worker in worker/). When that isn't
// available (e.g. a plain local server), fall back to tracks.json as the list.
function loadTracks(show, fail) {
  const cachedRaw = readCacheRaw();
  let cached = null;
  try { cached = JSON.parse(cachedRaw); } catch (e) {}
  if (!Array.isArray(cached)) cached = null;
  if (cached) show(prepare(cached), { fresh: false, changed: true });

  getTrackList()
    .then((list) => {
      const raw = JSON.stringify(list);
      const changed = raw !== cachedRaw;
      if (changed) writeCache(raw);
      show(prepare(list), { fresh: true, changed });
    })
    .catch(() => {
      if (!cached) fail();
    });
}

// stop and forget the loaded song (before the rows it belongs to are replaced)
function unload() {
  if (!current) return;
  current = null;
  pendingSeek = null;
  audio.pause();
  audio.removeAttribute("src");
  try { audio.load(); } catch (e) {}
}

if (root) {
  loadTracks(
    (tracks, { changed }) => {
      if (!changed) return; // the remembered list was already right: leave the page alone
      // don't rebuild the list under someone who's listening; the new list shows next visit
      if (current && !audio.paused) return;
      unload();
      renderList(tracks);
    },
    () => { root.textContent = "could not load tracks."; }
  );
}

if (songRoot) {
  const m = location.pathname.match(/^\/song\/([^/]+)/);
  const slug = (m ? decodeURIComponent(m[1]) : new URLSearchParams(location.search).get("t") || "").toLowerCase();
  let shown = null;
  loadTracks(
    (tracks, { fresh }) => {
      const track = tracks.find((t) => t.slug === slug);
      if (track && shown && JSON.stringify(track) === JSON.stringify(shown)) return; // same song, keep the page as is
      // a remembered list can be out of date (e.g. a brand-new song): keep "loading..." until the fresh one
      if (!track && !fresh) return;
      if (current && !audio.paused) return;
      unload();
      songRoot.textContent = "";
      if (!track) {
        songRoot.append(el("p", null, "song not found."));
        const back = el("a", null, "<- all music");
        back.href = "/music/";
        songRoot.append(back);
        return;
      }
      shown = track;
      document.title = track.title + " - tywwit.com";
      songRoot.append(renderSong(track));
      allRows().forEach(drawBar);
      measureDurations([track]);
    },
    () => { songRoot.textContent = "could not load song."; }
  );
}
