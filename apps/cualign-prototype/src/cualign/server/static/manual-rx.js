// 직접 이동 on 셋업: a right-click on a crown opens a small menu — 발치 / IPR… and, when prescribed, 발치 취소 / IPR 취소.
// IPR… asks which face of that tooth (근심 · 원심) and how much (0.05 mm steps, at most 0.25 mm off a face). The change
// goes to the server as the case's prescription (POST …/setup/conditions, manual_api.py); the app redraws the setup
// from the answer (ctx.setupChanged: marks, the cut crowns, the 스캔·조건 tabs) and manual.js rebases the edit on it.
// Only manual.js opens it, only in the 셋업 edit.

const EXTRACTABLE = new Set(["4", "5", "12", "13"]);   // Universal premolars, core constraints.EXTRACTABLE
const PER_FACE = 0.25, STEP = 0.05;                    // limits.IPR_PER_SURFACE, the form's step
const LIFT_MM = 3, FADE = 0.7;                         // the extracted crown lifts and fades as in scan-reveal.js

const mesialOf = (t) => (t <= 8 ? t + 1 : t - 1);      // Universal upper arch: 1..8 right (8 = FDI 11), 9..16 left
export const neighbourOf = (t, face) => (face === "mesial" ? mesialOf(t) : 2 * t - mesialOf(t));

// {"tooth-neighbour": mm off that face} of the prescription (Constraints.face_amounts): a split contact as listed, else half each
export function faceAmounts(rx) {
  const out = {}, split = new Set((rx?.ipr_amounts ?? []).map(([t, n]) => `${Math.min(t, n)}-${Math.max(t, n)}`));
  for (const [t, n, mm] of rx?.ipr_amounts ?? []) out[`${t}-${n}`] = +mm;
  for (const [a, b, mm] of rx?.ipr_surfaces ?? []) {
    if (split.has(`${a}-${b}`)) { out[`${a}-${b}`] ??= 0; out[`${b}-${a}`] ??= 0; } else out[`${a}-${b}`] = out[`${b}-${a}`] = mm / 2;
  }
  return out;
}

export function createSetupMenu(ctx, { rx, onChanged }) {
  const { THREE, state, fdi, api, canvas, toast } = ctx;
  let box = null;

  function close() { box?.remove(); box = null; }
  function panel(e, cls) {
    close();
    box = document.createElement("div");
    box.className = "rx-menu " + cls;
    box.addEventListener("contextmenu", (ev) => ev.preventDefault());
    const r = canvas.parentElement.getBoundingClientRect();
    box.style.left = `${Math.min(e.clientX - r.left, r.width - 200)}px`;
    box.style.top = `${Math.min(e.clientY - r.top, r.height - 180)}px`;
    canvas.parentElement.append(box);
    return box;
  }
  const faceFree = (t, face, gone) => { const n = neighbourOf(t, face); return !!state.teeth[n] && !gone.has(n); };

  function open(e, id) {
    const c = rx(), t = +id, gone = new Set((c.extraction ?? []).map(Number)), faces = faceAmounts(c);
    const el = panel(e, "menu");
    el.setAttribute("role", "menu");
    el.append(Object.assign(document.createElement("p"), { className: "rx-title", textContent: `${fdi(t)}번` }));
    const item = (label, act, why = "") => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = label; b.dataset.act = act; b.disabled = !!why; b.setAttribute("role", "menuitem");
      el.append(b);
      if (why) el.append(Object.assign(document.createElement("p"), { className: "rx-why", textContent: why }));
      b.addEventListener("click", () => {
        if (act === "ipr") iprForm(e, t, gone, faces);
        else change({ op: act, tooth: fdi(t) }, act === "extract" ? String(t) : null);
      });
    };
    if (gone.has(t)) { item("발치 취소", "unextract"); return; }
    item("발치", "extract", EXTRACTABLE.has(String(t)) ? "" : "소구치(14·15·24·25)만 발치할 수 있습니다");
    item("IPR…", "ipr", faceFree(t, "mesial", gone) || faceFree(t, "distal", gone) ? "" : "IPR 할 이웃 치아가 없습니다");
    if (Object.entries(faces).some(([k, mm]) => k.startsWith(`${t}-`) && mm > 0)) item("IPR 취소", "unipr");
  }

  function iprForm(e, t, gone, faces) {
    const el = panel(e, "form");
    const amount = (face) => faces[`${t}-${neighbourOf(t, face)}`] || PER_FACE;
    const free = ["mesial", "distal"].filter((f) => faceFree(t, f, gone));
    el.innerHTML = `<p class="rx-title">${fdi(t)}번 IPR</p>
      <div class="rx-faces">${["mesial", "distal"].map((f) => `<label><input type="radio" name="rxFace" value="${f}"${free.includes(f) ? "" : " disabled"}${f === free[0] ? " checked" : ""}> ${f === "mesial" ? "근심" : "원심"}</label>`).join("")}</div>
      <label class="rx-mm">양 <input type="number" id="rxMm" min="${STEP}" max="${PER_FACE}" step="${STEP}" value="${amount(free[0]).toFixed(2)}"> mm <span>면당 최대 ${PER_FACE}</span></label>
      <div class="rx-acts"><button type="button" class="btn ghost small" data-act="close">취소</button><button type="button" class="btn primary small" data-act="ok">확인</button></div>`;
    const mm = el.querySelector("#rxMm");
    for (const r of el.querySelectorAll("input[name=rxFace]")) r.addEventListener("change", () => { mm.value = amount(r.value).toFixed(2); });
    el.querySelector("[data-act=close]").addEventListener("click", close);
    el.querySelector("[data-act=ok]").addEventListener("click", () => {
      const face = el.querySelector("input[name=rxFace]:checked")?.value;
      const v = Math.min(PER_FACE, Math.max(STEP, Math.round(Number(mm.value) / STEP) * STEP));
      if (!face || !Number.isFinite(v)) return;
      change({ op: "ipr", tooth: fdi(t), face, mm: +v.toFixed(2) });
    });
    mm.focus();
  }

  async function change(body, fadeId) {
    close();
    try {
      const done = await api(`/api/cases/${encodeURIComponent(state.meshCase)}/setup/conditions`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (fadeId) liftAway(fadeId);
      ctx.setupChanged(done);
      await onChanged(done);
    } catch (err) { toast(err.message); }
  }

  // the extracted crown: a copy lifts and fades where it stood (the crown itself is hidden by the setup redraw)
  function liftAway(id) {
    const m = state.teeth[id];
    if (!m?.visible || !m.parent) return;
    const mat = m.material.clone(); mat.transparent = true; mat.depthWrite = false; mat.emissive.setHex(0);
    const c = new THREE.Mesh(m.geometry, mat); c.position.copy(m.position); c.rotation.copy(m.rotation);
    m.parent.add(c);
    const z = c.position.z, t0 = performance.now();
    (function step() {
      const p = Math.min(1, (performance.now() - t0) / (FADE * 1000)), k = 1 - (1 - p) ** 3;
      c.position.z = z + LIFT_MM * k; mat.opacity = 1 - k;
      if (p < 1) requestAnimationFrame(step); else { c.parent?.remove(c); mat.dispose(); }
    })();
  }

  return { open, close, get isOpen() { return !!box; } };
}
