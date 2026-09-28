import { test } from "node:test";
import assert from "node:assert/strict";
import { localOf, withLocal, editsOf, changeWords } from "../src/cualign/server/static/manual-math.js";

const fdi = (u) => { u = Number(u); return u <= 8 ? 19 - u : 12 + u; };
const s = Math.SQRT1_2;
const frame = { mesial: [s, s, 0], buccal: [-s, s, 0], occlusal: [0, 0, 1] };

test("a move reads in the crown's own axes and one axis is set without the others", () => {
  const d = [1, 2, -0.5];
  const loc = localOf(d, frame);
  assert.ok(Math.abs(loc.mesial - 3 * s) < 1e-9 && Math.abs(loc.buccal - s) < 1e-9 && loc.occlusal === -0.5);
  const e = withLocal(d, frame, "buccal", 0.3);
  const after = localOf(e, frame);
  assert.ok(Math.abs(after.buccal - 0.3) < 1e-9 && Math.abs(after.mesial - loc.mesial) < 1e-9 && after.occlusal === -0.5);
});

test("only the crowns that differ from the base are sent, and the transcript names the change", () => {
  const base = { d: { 8: [0, 0, 0], 9: [0.5, 0, 0] }, yaw: { 8: 0, 9: 1 } };
  const draft = { d: { 8: [s * 0.3, s * 0.3, 0], 9: [0.5, 0, 0] }, yaw: { 8: 2, 9: 1 } };
  assert.deepEqual(Object.keys(editsOf(draft, base)), ["8"]);
  assert.deepEqual(editsOf(base, base), {});
  assert.deepEqual(changeWords(draft, base, { 8: frame }, fdi), ["11번 근심 0.30mm · 회전 +2.0°"]);
});
