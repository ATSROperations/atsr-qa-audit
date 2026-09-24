/* Light / dark toggle. First visit follows the device setting; clicking the button saves a choice. */
(() => {
  const KEY = "atsr_qa_theme";
  const root = document.documentElement;
  const current = () => root.getAttribute("data-theme") ||
    (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const btn = document.getElementById("theme-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem(KEY, next); } catch (e) {}
  });
})();
