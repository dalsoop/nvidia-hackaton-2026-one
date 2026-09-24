import { test } from "node:test";
import assert from "node:assert/strict";
import { PlanStream, matchesSelection } from "../src/cualign/server/static/plan-stream.js";

test("fragmented UTF-8, CRLF, multiline SSE, legacy NAT and DONE", () => {
  const parser = new PlanStream();
  const source = 'intermediate_data: {"name":"도구","payload":"p999"}\r\n\r\n' +
    'event: plan_selected\ndata: {"schema_version":1,\ndata: "request_id":"r1","case_id":"moderate","plan_id":"p8"}\n\n' +
    'data: [DONE]\n\n';
  const events = [];
  for (const byte of new TextEncoder().encode(source)) events.push(...parser.push(new Uint8Array([byte])));
  events.push(...parser.push(undefined,true));
  assert.equal(events.length, 2);
  assert.equal(events[0].type, "intermediate_data");
  assert.equal(events[0].data.name, "도구");
  assert.equal(events[1].type, "plan_selected");
  assert(matchesSelection(events[1].data, "r1", "moderate"));
  assert(!matchesSelection(events[1].data, "r2", "moderate"));
  assert(!matchesSelection(events[1].data, "r1", "severe"));
});

test("unframed NAT errors and trailing event are retained", () => {
  const parser = new PlanStream();
  const events = parser.push(new TextEncoder().encode('{"code":"workflow_error","message":"503"}'), true);
  assert.equal(events[0].type, "error");
});
