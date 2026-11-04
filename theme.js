// Light/dark mode. Loaded in <head> so the saved theme applies before first paint.
(function () {
  var KEY = "theme";
  var root = document.documentElement;
  var fadeTimer;

  function saved() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function initial() {
    var s = saved();
    if (s === "light" || s === "dark") return s;
    return "dark"; // default for first-time visitors
  }
  function apply(theme) {
    root.setAttribute("data-theme", theme);
    var btn = document.querySelector(".theme-toggle");
    // label names the mode you'd switch TO
    if (btn) btn.textContent = theme === "dark" ? "[light]" : "[dark]";
  }

  apply(initial());

  document.addEventListener("DOMContentLoaded", function () {
    apply(root.getAttribute("data-theme"));
    var btn = document.querySelector(".theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.classList.add("theme-fading");
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(function () { root.classList.remove("theme-fading"); }, 550);
      apply(next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
    });
  });
})();

// Current page indicator: the active nav item scrolls right-to-left inside its own width.
document.addEventListener("DOMContentLoaded", function () {
  var link = document.querySelector('.site-nav a[aria-current="page"]');
  if (!link || link.classList.contains("site-title")) return; // the site title never scrolls
  var text = link.textContent;
  // dashed labels loop seamlessly; plain ones (tywwit.com) get a space between repeats
  var unit = /^-|-$/.test(text) ? text : text + " ";
  link.setAttribute("aria-label", text);
  link.classList.add("marquee");
  link.textContent = "";
  var cells = document.createElement("span");
  cells.setAttribute("aria-hidden", "true");
  cells.textContent = text;
  link.appendChild(cells);

  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  // step one whole character to the left at a time, like a terminal ticker
  var STEP_MS = 250;
  var pos = 0;
  setInterval(function () {
    pos = (pos + 1) % unit.length;
    var loop = unit.slice(pos) + unit.slice(0, pos);
    cells.textContent = loop.slice(0, text.length);
  }, STEP_MS);
});
