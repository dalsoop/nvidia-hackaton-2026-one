// Decode standard SSE plus NAT's intermediate_data/error fields across arbitrary chunks.
export class PlanStream {
  constructor() { this.buffer = ""; this.decoder = new TextDecoder(); }
  push(bytes, final = false) {
    this.buffer += this.decoder.decode(bytes, { stream: !final });
    const frames = this.buffer.split(/\r?\n\r?\n/);
    this.buffer = frames.pop();
    if (final && this.buffer.trim()) { frames.push(this.buffer); this.buffer = ""; }
    const result = [];
    for (const frame of frames) {
      let name = "data", parts = [], legacy = null;
      for (const line of frame.split(/\r?\n/)) {
        const colon = line.indexOf(":");
        if (colon < 0) continue;
        const key = line.slice(0, colon), value = line.slice(colon + 1).replace(/^ /, "");
        if (key === "event") name = value;
        else if (key === "data") parts.push(value);
        else if (key === "intermediate_data" || key === "error") legacy = { type: key, raw: value };
      }
      if (legacy) { name = legacy.type; parts = [legacy.raw]; }
      const raw = parts.join("\n");
      if (raw === "[DONE]" || !raw) {
        // NAT may end with an unframed JSON error.
        if (frame.trim().startsWith("{")) {
          try { result.push({ type: "error", data: JSON.parse(frame) }); } catch {}
        }
        continue;
      }
      try { result.push({ type: name, data: JSON.parse(raw) }); }
      catch { if (name.startsWith("plan_")) throw new Error("잘못된 계획 이벤트"); }
    }
    return result;
  }
}

export function matchesSelection(event, requestId, caseId) {
  return event.schema_version === 1 && event.request_id === requestId &&
    event.case_id === caseId && typeof event.plan_id === "string" && !!event.plan_id;
}
