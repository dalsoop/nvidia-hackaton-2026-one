// Drawers on narrower screens (from #145 v2): ≤1280 the sidebar, ≤1024 the chat panel float over the 3D. Which widths
// make a drawer is style.css's; this only flips body.side-open / body.chat-open. The splitter at the panel's edge is the
// handle: a click or Enter opens and closes it, and dragging is off while it is a handle (captured before app.js's own
// splitter listeners). A press on the 3D or Esc closes the open drawers. A plain script: it works even if app.js fails.
(() => {
  const HANDLES = [
    { id: "sideSplitter", cls: "side-open", mq: matchMedia("(max-width: 1280px) and (min-width: 769px)"), label: "사이드바 열기·닫기" },
    { id: "splitter", cls: "chat-open", mq: matchMedia("(max-width: 1024px) and (min-width: 769px)"), label: "대화 패널 열기·닫기" },
  ];
  const body = document.body;
  const handleOf = (el) => HANDLES.find((h) => h.mq.matches && el?.id === h.id);
  const setOpen = (h, open) => { body.classList.toggle(h.cls, open); document.getElementById(h.id).setAttribute("aria-expanded", String(open)); };

  function sync() {   // a handle while its breakpoint holds; the drag splitter (its own title and role) otherwise
    for (const h of HANDLES) {
      const el = document.getElementById(h.id);
      el.dataset.splitTitle ??= el.title;
      if (h.mq.matches) { el.setAttribute("role", "button"); el.title = h.label; el.setAttribute("aria-expanded", String(body.classList.contains(h.cls))); }
      else { body.classList.remove(h.cls); el.setAttribute("role", "separator"); el.title = el.dataset.splitTitle; el.removeAttribute("aria-expanded"); }
    }
  }
  for (const h of HANDLES) h.mq.addEventListener("change", sync);
  sync();

  let swallowClick = false;
  document.addEventListener("pointerdown", (e) => {
    if (handleOf(e.target)) { e.stopImmediatePropagation(); return; }   // no drag
    if (e.target.closest?.("#viewCanvas, #no3d") && HANDLES.some((h) => body.classList.contains(h.cls))) {
      for (const h of HANDLES) setOpen(h, false);
      swallowClick = true;   // the press only closes: no tooth pick, no rotation
      e.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener("click", (e) => {
    if (swallowClick) { swallowClick = false; if (e.target.closest?.("#viewCanvas, #no3d")) { e.stopImmediatePropagation(); return; } }
    const h = handleOf(e.target);
    if (h) { e.stopImmediatePropagation(); setOpen(h, !body.classList.contains(h.cls)); }
  }, true);
  document.addEventListener("dblclick", (e) => { if (handleOf(e.target)) e.stopImmediatePropagation(); }, true);   // no width reset
  document.addEventListener("keydown", (e) => {
    const h = handleOf(e.target);
    if (h && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopImmediatePropagation(); setOpen(h, !body.classList.contains(h.cls)); }
    else if (h && (e.key === "ArrowLeft" || e.key === "ArrowRight")) e.stopImmediatePropagation();   // no width change
    else if (e.key === "Escape") for (const x of HANDLES) if (x.mq.matches && body.classList.contains(x.cls)) setOpen(x, false);
  }, true);
})();
