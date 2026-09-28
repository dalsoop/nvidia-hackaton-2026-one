// 직접 이동의 순수 계산: 치아 자신의 축(core/manual.frames)으로 본 이동, 서버에 보낼 편집, 대화에 남길 변경 요약.
// DOM·three.js 없이 node --test 로 검사한다 (tests/manual-move.test.mjs).

export const STEP_MM = 0.05, STEP_DEG = 0.5, MAX_MM = 10, MAX_DEG = 45;   // snap of a drag; bounds as core/manual.py
export const AXES = ["mesial", "buccal", "occlusal"];
export const DEFAULT_FRAME = { mesial: [1, 0, 0], buccal: [0, 1, 0], occlusal: [0, 0, 1] };
export const AXIS_KO = { mesial: "근원심", buccal: "협설", occlusal: "수직", yaw: "회전" };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const snap = (x, step) => Math.round(x / step) * step;
export const clamp = (x, max) => Math.max(-max, Math.min(max, x));

// the crown's total move d (world mm) in its own axes: {mesial, buccal, occlusal}
export function localOf(d, frame = DEFAULT_FRAME) {
  return Object.fromEntries(AXES.map((k) => [k, dot(d, frame[k])]));
}
// d with its component along one axis set to `value` (the others kept)
export function withLocal(d, frame, key, value) {
  const a = (frame ?? DEFAULT_FRAME)[key], k = value - dot(d, a);
  return [d[0] + a[0] * k, d[1] + a[1] * k, d[2] + a[2] * k];
}
// a deep copy of a draft {d: {tooth: [x, y, z]}, yaw: {tooth: deg}}
export const copyDraft = (s) => ({ d: Object.fromEntries(Object.entries(s.d).map(([k, v]) => [k, [...v]])), yaw: { ...s.yaw } });
// the teeth whose pose differs from the base target's, as the API takes them: {tooth: {d, yaw}}
export function editsOf(draft, base) {
  const out = {};
  for (const [id, d] of Object.entries(draft.d)) {
    const b = base.d[id] ?? [0, 0, 0];
    if (Math.hypot(d[0] - b[0], d[1] - b[1], d[2] - b[2]) > 1e-4 || Math.abs((draft.yaw[id] ?? 0) - (base.yaw[id] ?? 0)) > 1e-3)
      out[id] = { d: d.map((x) => +x.toFixed(4)), yaw: +(draft.yaw[id] ?? 0).toFixed(3) };
  }
  return out;
}
// the server's overlaps as collision violations of the one-stage target view (red crowns, mm³ labels)
export const overlapViolations = (overlaps) => overlaps.map((o) => ({ stage: 1, type: "collision", teeth: o.teeth, overlap_mm3: o.overlap_mm3 }));
const signed = (x, digits) => (x > 0 ? "+" : "") + x.toFixed(digits);
// one line per edited crown for the transcript: 「11번 근심 0.30mm · 회전 +2.0°」 (the change from the base)
export function changeWords(draft, base, frames, fdi) {
  const words = { mesial: ["근심", "원심"], buccal: ["협측", "설측"], occlusal: ["정출", "함입"] };
  return Object.keys(editsOf(draft, base)).sort((a, b) => fdi(a) - fdi(b)).map((id) => {
    const f = frames[id] ?? DEFAULT_FRAME, d = draft.d[id], b = base.d[id] ?? [0, 0, 0];
    const delta = [d[0] - b[0], d[1] - b[1], d[2] - b[2]], parts = [];
    for (const k of AXES) {
      const v = dot(delta, f[k]);
      if (Math.abs(v) >= 0.005) parts.push(`${words[k][v > 0 ? 0 : 1]} ${Math.abs(v).toFixed(2)}mm`);
    }
    const y = (draft.yaw[id] ?? 0) - (base.yaw[id] ?? 0);
    if (Math.abs(y) >= 0.05) parts.push(`회전 ${signed(y, 1)}°`);
    return `${fdi(id)}번 ${parts.join(" · ")}`;
  });
}
