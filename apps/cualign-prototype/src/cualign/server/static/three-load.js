// three.js comes from the CDN (the import map in index.html). A static import would take the whole app down with it when
// the CDN is out of reach (offline), so app.js imports it from here: on a failed load THREE and the CSS2D classes are an
// inert stand-in that takes every call, `threeError` is set, and app.js shows the no-3D card over the 3D area only.
export let THREE, CSS2DRenderer, CSS2DObject, threeError = null;

// Any property is itself, any call or `new` returns itself; as a number it is 0, as an iterable it is empty.
function inert() {
  const p = new Proxy(function () {}, {
    get: (_, k) => k === Symbol.toPrimitive ? () => 0 : k === Symbol.iterator ? function* () {} : k === Symbol.hasInstance ? () => false : k === "then" ? undefined : p,
    set: () => true,
    apply: () => p,
    construct: () => p,
  });
  return p;
}

try {
  THREE = await import("three");
  ({ CSS2DRenderer, CSS2DObject } = await import("three/addons/renderers/CSS2DRenderer.js"));
} catch (e) {
  threeError = e;
  THREE = CSS2DRenderer = CSS2DObject = inert();
}
