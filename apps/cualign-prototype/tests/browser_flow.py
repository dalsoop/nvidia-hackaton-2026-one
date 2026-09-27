"""Browser acceptance using synthetic plans and a fake reviewer, never NIM.
Run: uv run --frozen --with playwright python tests/browser_flow.py
Requires installed Chrome or PLAYWRIGHT_CHROMIUM_EXECUTABLE. UI CDN access is required.
"""
import asyncio
import json
import math
import os
from pathlib import Path
import socket
import sys
import threading
import time

import httpx
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from playwright.async_api import async_playwright

from cualign.agent import register
from cualign.agent.context import CURRENT_RUN
from cualign.agent.reviewer import review_plan
from cualign.core import store as store_module
from cualign.core.constraints import ConstraintPatch
from cualign.server import api, plan_events

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_patients import _scan_files   # noqa: E402  synthetic per-tooth scans, as the API tests use


# the newest plan of 000131 whose mesh the server cuts (#22): the plan list is newest first, so the run's own IPR plan comes first
FIND_CUT_PLAN = """(async () => {
  const plans = (await (await fetch('/api/plans?case_id=poseidon-000131')).json()).plans;
  for (const p of plans.filter((p) => /ipr/.test(p.strategy))) {
    const m = await (await fetch(`/api/cases/poseidon-000131/mesh?plan_id=${p.plan_id}`)).json();
    if (Object.keys(m.teeth_cut).length) return p.plan_id;
  }
  return null;
})()"""


def document_has_plan(body_class: str) -> bool:
    return "has-plan" in body_class.split()


def write_scan(folder: Path, **kw) -> list[str]:
    """Synthetic scan files on disk for the file chooser: drop=(4,) leaves a gap, rename flips the numbering."""
    folder.mkdir(parents=True, exist_ok=True)
    paths = []
    for _, (name, data, _mime) in _scan_files(**kw):
        (folder / name).write_bytes(data)
        paths.append(str(folder / name))
    return paths

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out" / "browser-acceptance"
OUT.mkdir(parents=True, exist_ok=True)
store_module.OUT_DIR = api.OUT_DIR = OUT
app = FastAPI()


@app.get("/api/cases/{case_id}/mesh")
async def fake_mesh(case_id: str, plan_id: str | None = None, target_id: str | None = None):
    """The mesh route with `target_id` (server round 15, not on main yet): the target's cut dentition — shaped here as the
    case's latest plan's cut with plan_id None and the target_id. Without target_id it is the server's own route."""
    cid, case = store_module.STORE.load_case(case_id)
    data = case.viewer_json()
    data.update(api.gum_filled_view(cid, case, data["gum"]))
    if target_id:
        pid = next((pid for pid in reversed(list(store_module.STORE.plans)) if store_module.STORE._record(pid)["case_id"] == cid), None)
        data.update(api.ipr_cut_view(cid, case, pid))
        data.update({"plan_id": None, "target_id": target_id})
    else:
        data.update(api.ipr_cut_view(cid, case, plan_id))
    return data


async def fake_manual_review(plan_id):
    class Memo:
        async def ainvoke(self, messages):
            return "검토 메모 초안 (가짜 검토)"
    return await review_plan(plan_id, Memo(), manual=True)


api.add_api_routes(app, review=fake_manual_review)
app.add_middleware(plan_events.PlanEventsASGI)


def sse(name, obj):
    return f"event: {name}\ndata: {json.dumps(obj, ensure_ascii=False)}\n\n"


@app.post("/chat/stream")
async def fake_chat(request: Request):
    """The agent by step (#20 contract; the middleware already read the cualign block): setup → step_done with the
    constraints it read, target → step_done with a target id, stages → the real tools, so plan_selected comes from
    the middleware. The reviewer fails only on the 앞니 IPR turn."""
    body = json.loads(await request.body())
    step = body.get("step")
    text = next((m["content"] for m in reversed(body.get("messages", [])) if m.get("role") == "user"), "")
    run = CURRENT_RUN.get()
    async def generate():
        if step == "setup":
            yield sse("step_done", {"request_id": run.request_id, "step": "setup", "constraints": run.constraints.model_dump(mode="json")})
            yield 'data: {"value":"처방을 조건으로 옮겼습니다. 발치 14·24, IPR 면당 0.25 mm."}\n\n'
            return
        if step == "target":
            yield sse("step_done", {"request_id": run.request_id, "step": "target", "target_id": "t-fake",
                                    "summary": {"crowding_mm": 7.9, "space_mm": 15.8, "strategy": "extraction", "extraction": [14, 24], "ipr": []}})
            yield 'data: {"value":"목표 배열을 만들었습니다. 초기와 비교해 보세요."}\n\n'
            return
        async with register.cualign(register.CuAlignToolConfig(), None) as group:
            tools = await group.get_all_functions()
            def tool(name):
                return next(fn for key, fn in tools.items() if key.split("__")[-1] == name)
            # Exercise actual NAT tool functions, but no external LLM.
            await tool("set_constraints").ainvoke(ConstraintPatch(ipr_exclude=[7,8,9,10]))
            result = await tool("compare_strategies").ainvoke(register.CompareInput())
            selected = next((p for p in result["plans"] if p["passed"]), result["plans"][0])
            await tool("select_plan").ainvoke(register.PlanIdInput(plan_id=selected["plan_id"]))
            if "앞니 빼고" in text:
                class Empty:
                    async def ainvoke(self, messages):
                        return ""
                await review_plan(selected["plan_id"], Empty())
            yield sse("step_done", {"request_id": run.request_id, "step": "stages"})
            # An unrelated ID in text must not control selection.
            yield 'data: {"value":"단계를 만들었습니다. 이전 후보 plan_id: p999는 선택하지 않습니다."}\n\n'
    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/api/cases/{case_id}/targets/{target_id}")
async def fake_target(case_id: str, target_id: str):
    """#20 contract, shaped here until the server ships it: the target state in the plan's shape with one stage (the final one)."""
    pid = next((pid for pid in reversed(list(store_module.STORE.plans)) if store_module.STORE._record(pid)["case_id"] == case_id), None)
    if pid is None:
        pid = api.rule_based_plan(case_id)["chosen"]["plan_id"]
    plan = store_module.STORE.plan_json(pid)
    return {**plan, "target_id": target_id, "plan_id": None, "stages": plan["stages"][-1:], "rotations": (plan.get("rotations") or [])[-1:],
            "violations": []}


async def main():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level="error"))
    thread = threading.Thread(target=server.run, kwargs={"sockets":[sock]}, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{port}"
    browser = None
    try:
        for _ in range(200):
            if server.started:
                break
            await asyncio.sleep(0.05)
        else:
            raise AssertionError("test server did not start")
        async with async_playwright() as pw:
            executable = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
            browser = await pw.chromium.launch(executable_path=executable, headless=True,
                args=["--enable-unsafe-swiftshader", "--use-angle=swiftshader"])
            page = await browser.new_page(viewport={"width":1500,"height":1000})
            errors = []
            page.on("pageerror", lambda error: (errors.append(str(error)), print("PAGEERROR:", error, file=sys.stderr)))   # visible when a step times out
            page.on("dialog", lambda dialog: dialog.accept())
            # ?case=<id> is the documented dev/test hook; the base sample is 000097 「심한 덧니, 발치 필요」 (#15).
            await page.goto(url + "/ui/?case=poseidon-000097")
            await page.wait_for_function("!document.body.classList.contains('start')")

            # Rule-based plan from the sidebar's 조건 tab (no model). The plan on screen is the canvas's data-plan-id;
            # the cards on the panel top mark it 보는 중 (#111). Helpers read the test hook, not the removed result card.
            plan_on_screen = "(window.__cualign.state.plan?.plan_id ?? '')"
            async def on_screen():
                return await page.evaluate(plan_on_screen)
            async def approval():
                return await page.evaluate("window.__cualign.state.plan?.approval ?? null")
            # The agent drives the steps (#20). The case opens as the scan: no plan, the strip at 초기 with the rest closed,
            # the 스캔 tab with the facts, and the agent's first word with the sample's prescription as one chip.
            assert not document_has_plan(await page.evaluate("document.body.className"))
            assert await page.locator("body").evaluate("b => b.classList.contains('step-initial')")
            assert await page.locator('#flow button[data-step="setup"]').is_disabled() and await page.locator('#flow button[data-step="stages"]').is_disabled()
            assert await page.locator("#tabScan").get_attribute("aria-selected") == "true"
            assert "치아" in await page.locator("#scanFacts").inner_text() and "총생" in await page.locator("#scanFacts").inner_text()
            assert await page.locator("#tabCond").evaluate("b => getComputedStyle(b).pointerEvents") == "none"
            assert "처방을 적어 주세요" in await page.locator(".msg.assistant").last.inner_text()
            next_chip = lambda label: page.locator(".next:not(.done) button", has_text=label)
            assert await next_chip("이 케이스의 처방 넣기").count() == 1
            # turn 1 (setup): the chip sends the prescription; step_done{setup} fills the conditions, the extracted crowns flash
            # red and go, the strip opens 셋업, the next chips ask for the target
            await next_chip("이 케이스의 처방 넣기").click()
            await page.wait_for_function("document.body.classList.contains('step-setup') && !document.querySelector('#sendBtn').disabled", timeout=60000)
            assert await page.locator("#cExtract").input_value() == "14, 24"
            assert await page.locator("#tabCond").get_attribute("aria-selected") == "true"
            removed_crown = "() => { const s = window.__cualign.state; return s.teeth[String(s.setup.extraction[0])].visible; }"
            await page.wait_for_function(f"!({removed_crown})()", timeout=5000)      # red for a moment, then gone (#20)
            assert (await page.evaluate("location.hash")).endswith("&step=setup")
            assert await page.locator('#flow button[data-step="setup"]').is_enabled() and await page.locator('#flow button[data-step="target"]').is_disabled()
            assert await next_chip("목표 배열 만들기").count() == 1 and await next_chip("조건 바꾸기").count() == 1
            # turn 2 (target): step_done{target_id} → GET /targets → the 3D shows the target state (one stage); 초기 ↔ 목표 look back
            await next_chip("목표 배열 만들기").click()
            await page.wait_for_function("document.body.classList.contains('step-target') && window.__cualign.state.targetId === 't-fake' && !document.querySelector('#sendBtn').disabled", timeout=60000)
            assert await page.evaluate("window.__cualign.state.stage") == 1 and not document_has_plan(await page.evaluate("document.body.className"))
            assert await page.locator('#flow button[data-step="stages"]').is_disabled()
            await page.locator('#flow button[data-step="initial"]').click()
            await page.wait_for_function("document.body.classList.contains('step-initial') && window.__cualign.state.stage === 0")
            assert "&step=" not in await page.evaluate("location.hash")
            await page.locator('#flow button[data-step="target"]').click()
            await page.wait_for_function("document.body.classList.contains('step-target') && window.__cualign.state.stage === 1")
            assert await next_chip("단계 만들기").count() == 1 and await next_chip("8개월 안에").count() == 1
            assert await next_chip("비발치안과 비교").count() == 0      # an extraction prescription: no comparison chip
            # turn 3 (stages): the real tools make the plan; plan_selected lands it on 단계 with the slider
            await next_chip("단계 만들기").click()
            await page.wait_for_function(f"{plan_on_screen}.startsWith('p') && document.body.classList.contains('step-stages') && !document.querySelector('#sendBtn').disabled"
                f" && document.querySelector('#viewCanvas').dataset.planId === {plan_on_screen}", timeout=120000)
            parent = await on_screen()
            assert await next_chip("승인하고 내보내기").count() == 1
            # the strip is open end to end now: the step in the address, a reload and the strip's buttons keep it
            await page.locator('#flow button[data-step="initial"]').click()
            await page.wait_for_function("document.body.classList.contains('step-initial') && window.__cualign.state.stage === 0")
            assert not await page.locator(".stage-bar").is_visible()
            await page.locator('#flow button[data-step="setup"]').click()
            await page.wait_for_function("document.body.classList.contains('step-setup')")
            assert (await page.evaluate("location.hash")).endswith("&step=setup")
            await page.locator('#flow button[data-step="target"]').click()
            await page.wait_for_function("document.body.classList.contains('step-target') && window.__cualign.state.stage === 1")
            await page.locator('#flow button[data-step="stages"]').click()
            await page.wait_for_function("document.body.classList.contains('step-stages') && window.__cualign.state.stage === 0")
            assert await page.locator(".stage-bar").is_visible()
            # 치료 전 (stage 0) is the scan with every crown (#18 decision); the extracted crowns turn into silhouettes from stage 1
            crown = "() => { const s = window.__cualign.state, id = String(s.plan.target.removed[0]), m = s.teeth[id]; return [m.material.opacity, m.userData.shell.visible]; }"
            assert await page.evaluate(crown) == [1, False]
            await page.locator("#stageSlider").fill("1")
            await page.wait_for_function("window.__cualign.state.stage === 1")
            assert await page.evaluate(crown) == [0.45, True]
            await page.locator("#firstBtn").click(); await page.wait_for_function("window.__cualign.state.stage === 0")
            # the 3D turns without a pole clamp (#18): a 720° vertical drag comes back to the start, the distance never changes,
            # and a horizontal drag afterwards keeps the arch plane level (no roll drift)
            await page.locator('.view-rail [data-view="frontal"]').click()
            cam = "() => { const c = window.__cualign.camera, t = window.__cualign.controls.target; return { p: c.position.toArray(), d: c.position.distanceTo(t), rz: new c.position.constructor(1, 0, 0).applyQuaternion(c.quaternion).z }; }"
            start = await page.evaluate(cam)
            px = 4 * math.pi / await page.evaluate("window.__cualign.controls.speed")
            for _ in range(8):
                await page.mouse.move(960, 300); await page.mouse.down(); await page.mouse.move(960, 300 + px / 8, steps=15)
                await page.wait_for_timeout(120); await page.mouse.up()      # a still pointer at release: no inertia
                await page.wait_for_timeout(120)
            end = await page.evaluate(cam)
            assert math.dist(start["p"], end["p"]) < 8 and abs(start["d"] - end["d"]) < 1e-3, (start, end)
            await page.mouse.move(960, 500); await page.mouse.down(); await page.mouse.move(1260, 500, steps=10); await page.wait_for_timeout(120); await page.mouse.up()
            assert abs((await page.evaluate(cam))["rz"]) < 1e-3
            await page.mouse.dblclick(960, 500)
            await page.wait_for_function("document.querySelector('.view-rail [data-view=\"occlusal\"]').getAttribute('aria-pressed') === 'true'")
            await page.reload()
            await page.wait_for_function("document.body.classList.contains('step-stages') && document.body.classList.contains('has-plan')", timeout=120000)
            assert await on_screen() == parent
            assert await page.locator("#viewCanvas").get_attribute("data-plan-id") == parent
            assert await page.locator(f'#plans .plan-row.current[data-plan="{parent}"] .viewing').is_visible()
            assert await page.locator("#stlLink").get_attribute("href") is None
            parent_detail = store_module.STORE.plan_json(parent)
            assert parent_detail["passed"] and parent_detail["review"]["status"] == "passed"      # the server reviewed what the agent did not
            assert "규칙 통과 · 검토 완료" in await page.locator("#plans .plan-row.current .pill").inner_text()
            assert int(await page.locator("#stageSlider").get_attribute("max")) == parent_detail["info"]["n_stages"]
            await page.locator("#stageSlider").fill(str(parent_detail["info"]["n_stages"]))
            await page.locator("#stageSlider").dispatch_event("input")
            before = await page.locator("#viewCanvas").screenshot()

            # Export is gated on a passing, reviewed plan; approving happens through the export popover, which then
            # clicks the hidden download link itself.
            assert await page.locator("#exportBtn").is_enabled()
            assert await page.locator('#rail button[data-go="export"]').is_enabled()      # the rail item is the visible 내보내기
            await page.locator('#rail button[data-go="export"]').click()
            await page.wait_for_selector("#exportPop:not([hidden])")
            t0 = time.monotonic()
            async with page.expect_download(timeout=180000) as download:      # a real scan's zip takes a while (#119; 000097 with the filled gum)
                await page.locator("#exportGo").click()
            print(f"STL download started after {time.monotonic() - t0:.1f}s")
            await page.wait_for_function("!!window.__cualign.state.plan?.approval")
            assert await page.locator('#plans .plan-row.current .pill').inner_text() == "승인됨"
            assert parent in await page.locator("#stlLink").get_attribute("href")
            assert (await page.locator("#exportBtn").text_content()) == "STL 내려받기"
            assert (await page.locator('#rail button[data-go="export"] span').inner_text()) == "STL 받기"
            await (await download.value).save_as(OUT / "approved-stages.zip")

            # Revoke the approval (the 검토 fold under the plan cards) and confirm export gates again.
            await page.locator("#planReview").evaluate("(el) => { el.open = true; }")
            await page.locator("#revokeBtn").click()
            await page.wait_for_function("!window.__cualign.state.plan?.approval")
            assert (await page.locator("#exportBtn").text_content()) == "내보내기"
            assert await page.locator("#stlLink").get_attribute("href") is None
            # Re-approve so the plan is on screen as approved again before the next edit invalidates it.
            await page.locator('#rail button[data-go="export"]').click()
            await page.wait_for_selector("#exportPop:not([hidden])")
            await page.locator("#exportGo").click()
            await page.wait_for_function("!!window.__cualign.state.plan?.approval")

            # Editing the conditions makes the on-screen (approved) plan stale for export until replanned.
            await page.locator("#tabCond").click()      # the flow moved the sidebar to 단계 표 (#15)
            await page.locator("#cLock").fill("13")
            assert await page.locator("#exportBtn").is_disabled()
            assert await page.locator('#rail button[data-go="export"]').is_disabled()
            assert "조건이 바뀜" in await page.locator("#condState").inner_text()
            assert await page.locator("#condApply").is_visible()      # a hand edit re-runs the setup turn (#20); here the stages turn takes the form as it is
            await page.locator("#chatInput").fill("13번은 움직이지 말고 다시 짜줘")
            await page.locator("#sendBtn").click()
            await page.wait_for_function(f"(p) => {plan_on_screen} !== p && !document.querySelector('#sendBtn').disabled"
                f" && document.querySelector('#viewCanvas').dataset.planId === {plan_on_screen}", arg=parent, timeout=120000)
            child = await on_screen()
            assert await page.evaluate("window.__cualign.state.plan.parent_plan_id") == parent
            assert await approval() is None
            assert "조건과 같음" in await page.locator("#condState").inner_text()
            assert await page.locator("#stlLink").get_attribute("href") is None
            assert await page.locator("#viewCanvas").get_attribute("data-plan-id") == child
            await page.locator("#stageSlider").evaluate("(el) => { el.value=el.max; el.dispatchEvent(new Event('input')); }")
            after = await page.locator("#viewCanvas").screenshot()
            assert before != after
            await page.screenshot(path=str(OUT / "revision.png"))

            # The decision bar for this revision lets the dentist undo it; revert, then pick the child plan again
            # with the 보기 button of its card (#111) so the rest of the script continues from it.
            await page.locator(".decision").last.locator('[data-act="revert"]').click()
            await page.wait_for_function(f"(p) => {plan_on_screen} === p", arg=parent)
            assert await page.locator(f'#plans .plan-row.current[data-plan="{parent}"]').count() == 1
            await page.locator(f'#plans .plan-row[data-plan="{child}"] button[data-act="view"]').click()
            await page.wait_for_function(f"(p) => {plan_on_screen} === p", arg=child)
            assert await page.locator("#viewCanvas").get_attribute("data-plan-id") == child
            assert await page.locator(f'#plans .plan-row.current[data-plan="{child}"] .viewing').is_visible()
            assert await page.locator(f'#plans .plan-row[data-plan="{parent}"] button[data-act="view"]').is_visible()
            # the sidebar follows the card: its 규칙 tab names the plan on screen
            await page.locator("#tabRules").click()
            assert (await page.locator("#rulesFor").inner_text()).startswith("계획 ")
            assert await page.locator("#ruleCards .rule").count() >= 4
            await page.screenshot(path=str(OUT / "plan-cards.png"))

            # Send a real HTTP stream through PlanEventsASGI and the actual tool group. The fake reviewer fails and
            # the streamed text carries an unrelated plan id that must not steer selection.
            await page.locator("#chatInput").fill("IPR은 앞니 빼고 다시 짜줘")
            await page.locator("#sendBtn").click()
            await page.wait_for_function("window.__cualign.state.plan?.review?.status === 'failed' && !document.querySelector('#sendBtn').disabled")
            selected = await on_screen()
            assert selected != "p999" and selected != child
            assert await page.evaluate("window.__cualign.state.plan.parent_plan_id") == child
            assert "검토 실패" in await page.locator("#plans .plan-row.current .pill").inner_text()
            assert await page.locator("#cLock").input_value() == "13"
            assert await page.locator("#cExclude").input_value() == "11, 12, 21, 22"      # Universal 7,8,9,10 in FDI (#113)
            assert await page.locator("#exportBtn").is_disabled()
            assert await page.locator("#stlLink").get_attribute("href") is None
            # a comparison turn adds one card per plan it made (an extraction prescription makes one, #56); the selected one is
            # 보는 중. Both lists count: the reload in the flow walk above folded the preview into 지난 계획
            assert await page.locator("#plans .plan-row").count() >= 3
            assert await page.locator(f'#plans .plan-row.current[data-plan="{selected}"] .viewing').is_visible()
            assert await page.locator(".msg.error").last.is_visible()
            decision2 = page.locator(".decision").last
            assert await decision2.is_visible()
            assert await decision2.locator('[data-act="revert"]').count() == 1   # keeping needs no button
            assert await decision2.locator('[data-act="keep"]').count() == 0
            await page.screenshot(path=str(OUT / "review-failure.png"))

            # The dentist asks for the failed review again on the same plan.
            assert await page.locator("#reviewBtn").is_visible()
            await page.locator("#reviewBtn").click()
            await page.wait_for_function("window.__cualign.state.plan?.review?.status === 'passed' && !document.querySelector('#sendBtn').disabled")
            assert await on_screen() == selected
            assert "검토 완료" in await page.locator("#plans .plan-row.current .pill").inner_text()
            assert await page.locator("#reviewBtn").is_hidden()
            if store_module.STORE.plan_json(selected)["passed"]:
                assert await page.locator("#exportBtn").is_enabled()

            # A stale HTTP response must not overwrite a later manual selection.
            pending = asyncio.Event()
            release = asyncio.Event()
            # Obtain the payload before routing, then release the first selection last.
            async with httpx.AsyncClient() as client:
                parent_payload = (await client.get(url + "/api/plans/" + parent)).json()
            async def delayed_parent(route):
                pending.set()
                await release.wait()
                await route.fulfill(json=parent_payload)
            await page.route("**/api/plans/" + parent, delayed_parent)
            # the cards' buttons are disabled while a load runs, so the second choice goes through the test hook
            await page.locator(f'#plans .plan-row[data-plan="{parent}"] button[data-act="view"]').click()
            await pending.wait()
            await page.evaluate("(p) => { window.__cualign.loadPlan(p).catch(() => {}); }", child)
            await page.wait_for_function(f"(p) => {plan_on_screen} === p", arg=child)
            release.set()
            await page.wait_for_timeout(100)
            assert await on_screen() == child
            assert await page.locator("#viewCanvas").get_attribute("data-plan-id") == child

            # Reload keeps the case and the plan on screen via the #case=…&plan=… address (#90).
            assert (await page.evaluate("location.hash")) == f"#case=poseidon-000097&plan={child}&step=stages"
            case_name_before = await page.locator("#caseName").inner_text()
            await page.reload()
            await page.wait_for_function("!document.body.classList.contains('start')")
            await page.wait_for_function(f"(p) => {plan_on_screen} === p", arg=child, timeout=120000)
            assert await page.locator(f'#plans .plan-row.current[data-plan="{child}"]').count() == 1
            assert await page.locator("#caseName").inner_text() == case_name_before
            assert await page.locator("#stlLink").get_attribute("href") is None   # approval was revoked above

            # Going home and opening a different (real) sample card: the case opens as its scan (#20), never with the
            # previous case's plan, the strip back at 초기.
            await page.locator("#homeBtn").click()
            await page.wait_for_function("document.body.classList.contains('start')")
            await page.locator('#sampleCards .case-card[data-id="poseidon-000001"]').click()      # card → detail under it
            assert await page.locator("#clDetail").is_visible() and await page.locator("#dArch circle").count() == 14 and await page.locator("#dArch line.ipr").count() == 9   # 000001: IPR on the 9 contacts between 15…25
            assert await page.locator('#sampleCards > #clDetail.in-cards').count() == 1      # under the card row
            assert await page.locator("#intro").is_visible()   # the intro panel is back on the left (③)
            await page.locator("#dOpen").click()
            await page.wait_for_function("!document.body.classList.contains('start') && document.body.classList.contains('step-initial') && window.__cualign.state.activeCase === 'poseidon-000001'")
            assert not document_has_plan(await page.evaluate("document.body.className")) and await on_screen() == ""
            assert await page.locator('#flow button[data-step="setup"]').is_disabled()
            assert (await page.evaluate("location.hash")).startswith("#case=poseidon-000001")
            assert await page.locator("#stlLink").get_attribute("href") is None

            # My scan, the two blocking states of 입력 확인 (#104): a gap in the arch is unsupported (no planning),
            # numbers running the other way get the 좌우 번호 뒤집기 button, and after it the scan is ready.
            missing = write_scan(OUT / "scans" / "missing", drop=(4,), gum=True)
            flipped = write_scan(OUT / "scans" / "flipped", gum=True, rename=lambda u: 17 - u)
            await page.evaluate("location.hash = '#patients'")
            await page.wait_for_selector("#patientForm:visible")
            await page.fill("#pAlias", "인수 스캔")
            await page.set_input_files("#pScans", missing)
            await page.locator("#patientForm button[type=submit]").click()
            await page.wait_for_function("!document.querySelector('#checkBar').hidden && document.querySelector('#checkFacts .bad')", timeout=120000)
            facts = await page.locator("#checkFacts").inner_text()
            assert "결손" in facts and "15번" in facts, facts      # Universal 4 = FDI 15 (core writes FDI)
            assert await page.locator("#startPlan").is_hidden()      # a blocked scan cannot start a plan (#112)
            assert await page.locator("#checkBar").evaluate("e => e.classList.contains('fail')")
            assert await page.locator("#checkTitle").inner_text() == "계획할 수 없는 스캔입니다"
            assert await page.locator("#deleteScan").is_visible()
            await page.screenshot(path=str(OUT / "check-unsupported.png"))
            # 스캔 삭제 asks once in place, then the patient's scan list comes back without it
            await page.locator("#deleteScan").click()
            await page.wait_for_selector("#deleteScanPop:not([hidden])")
            await page.locator("#deleteScanGo").click()
            await page.wait_for_function("!document.querySelector('#caseGate').hidden && document.querySelector('#checkBar').hidden", timeout=60000)
            assert await page.locator("#scanList .scan-row").count() == 0
            # an upload the server refuses (#112, 보드 08): lower-arch numbers → 400 with the reason; the card shows the
            # files, the sentence as it came, and 다시 고르기
            lower = write_scan(OUT / "scans" / "lower", rename=lambda u: u + 16)
            await page.set_input_files("#scanInput", lower)
            await page.wait_for_selector("#uploadStatus .upload-fail", timeout=60000)
            why = await page.locator("#uploadStatus .upload-fail .why").inner_text()
            assert "하악" in why and "상악 스캔만" in why, why
            assert "올린 파일" in await page.locator("#uploadStatus .upload-fail .files").inner_text()
            assert await page.locator('#uploadStatus [data-act="repick"]').is_visible()
            await page.screenshot(path=str(OUT / "upload-rejected.png"))
            # a scan whose orientation cannot be decided (#104, 보드 09-c): closed synthetic crowns, no gum → basis none,
            # yet plannable; the title says so and the button asks to confirm the numbers first
            unoriented = write_scan(OUT / "scans" / "unoriented")
            await page.set_input_files("#scanInput", unoriented)
            await page.wait_for_function("!document.querySelector('#checkBar').hidden && !document.querySelector('#checkTitle').hidden", timeout=120000)
            assert await page.locator("#checkTitle").inner_text() == "방향을 정하지 못했습니다"
            assert "방향을 정할 수 없어 입력 방향 그대로 둠" in await page.locator("#checkFacts").inner_text()
            assert await page.locator("#startPlan").is_enabled() and await page.locator("#startPlan").inner_text() == "번호 확인 — 계획 시작"
            await page.screenshot(path=str(OUT / "check-unoriented.png"))
            await page.set_input_files("#scanInput", flipped)   # a second scan for the same patient
            await page.wait_for_function("document.querySelector('#checkFacts').textContent.includes('좌우 반대') && !document.querySelector('#mirrorBtn').hidden", timeout=120000)
            await page.screenshot(path=str(OUT / "check-reversed.png"))
            await page.locator("#mirrorBtn").click()
            await page.wait_for_function("document.querySelector('#mirrorBtn').hidden && !document.querySelector('#startPlan').disabled", timeout=120000)
            facts = await page.locator("#checkFacts").inner_text()
            assert "좌우 반대" not in facts and "문제 없음" in facts, facts
            pid = await page.evaluate("window.__cualign.state.patient.patient_id")
            await page.evaluate("(pid) => fetch('/api/patients/' + pid, { method: 'DELETE' }).then((r) => r.ok)", pid)   # reruns start empty

            # A case that opens with no plan because the calculation failed (#112, 보드 07). The server contract for
            # this state is not there yet, so the responses are shaped here: /activate carries plan_error, the plan
            # list is empty. The card shows the sentence, the conditions, and 이 조건으로 다시 계산 brings a plan.
            async def no_plan_activate(route):
                r = await route.fetch(); body = await r.json(); body["plan_error"] = "규칙 계산 실패 (가짜): 접촉 폭을 맞출 수 없습니다."
                await route.fulfill(json=body)
            async def empty_plans(route):
                await route.fulfill(json={"plans": []})
            await page.route("**/api/cases/poseidon-000131/activate", no_plan_activate)
            await page.route("**/api/plans?case_id=poseidon-000131", empty_plans)
            await page.locator("#homeBtn").click()
            await page.wait_for_function("document.body.classList.contains('start')")
            await page.locator('#sampleCards .case-card[data-id="poseidon-000131"]').click()
            await page.locator("#dOpen").click()
            await page.wait_for_selector("#planFail:not([hidden])", timeout=60000)
            assert "규칙 계산 실패 (가짜)" in await page.locator("#planFailMsg").inner_text()
            assert await page.locator("#planFailCond .tag").count() >= 3
            assert not document_has_plan(await page.evaluate("document.body.className"))
            await page.screenshot(path=str(OUT / "plan-failed.png"))
            await page.unroute("**/api/plans?case_id=poseidon-000131")
            # POST /api/plan converts the prescription's FDI pairs twice (RulePlanRequest, then ConstraintPatch again) and
            # answers 400 「not an upper-arch FDI number: 7」 with a prescription in the form (server, #143 follow-up, .report/24).
            # Until it is fixed the retry runs without the per-contact prescription; put the line back then.
            await page.evaluate("document.querySelector('#cSurf').value = ''")   # the 조건 pane is not the visible tab here
            await page.locator("#planFailRetry").click()
            await page.wait_for_function("document.querySelector('#planFail').hidden && document.body.classList.contains('has-plan')", timeout=120000)
            assert await page.locator("#planList .plan-row").count() >= 1
            plan131 = await on_screen()
            await page.unroute("**/api/cases/poseidon-000131/activate")
            # The 3D shows FDI numbers, never Universal (#113): the input-check screen's tooth-number labels.
            # This sample's prescription extracts Universal 5·12 = FDI 14·24.
            await page.goto(url + "/ui/#check=poseidon-000097")
            await page.wait_for_function("document.querySelectorAll('.num-label').length > 0")
            labels = await page.locator(".num-label").all_inner_texts()
            assert "14" in labels and "24" in labels, labels     # FDI for this sample's extraction (Universal 5·12)
            assert "5" not in labels, labels                     # never the bare Universal number

            # A final answer with no Korean in it: the server swaps it for a notice and sends plan_error kind=no_answer.
            # The notice shows as the server wrote it, with 다시 보내기 like an overload (server fix 2026-09-28).
            await page.goto(url + f"/ui/#case=poseidon-000131&plan={plan131}&step=stages")      # a case opens as its scan (#20); the plan and step in the address bring the stages back
            await page.wait_for_function("document.body.classList.contains('has-plan') && document.body.classList.contains('step-stages') && !document.querySelector('#sendBtn').disabled", timeout=120000)
            # IPR faces (#22): an IPR plan of this case cuts crowns (000131 prescribes IPR on the anterior; the fallback's
            # chosen plan is 확장, so pick one of the case's plans the server cuts). In the stages the cut teeth carry the cut
            # geometry with their planes blue and the legend says IPR 면; 초기 shows the scan's crowns again
            ipr_plan = await page.evaluate(FIND_CUT_PLAN)
            assert ipr_plan, "no plan of 000131 with teeth_cut"
            await page.evaluate(f"window.__cualign.loadPlan('{ipr_plan}')")
            await page.wait_for_function(f"window.__cualign.state.plan?.plan_id === '{ipr_plan}' && !window.__cualign.state.loading", timeout=60000)
            cut_set = f"window.__cualign.state.cutSets['plan:{ipr_plan}']"
            cut_ids = await page.evaluate(f"Object.keys({cut_set} ?? {{}})")
            assert cut_ids and await page.evaluate("window.__cualign.cutKeyNow()") == f"plan:{ipr_plan}", cut_ids
            assert await page.evaluate(f"Object.entries({cut_set}).every(([id, c]) => window.__cualign.state.teeth[id].geometry === c.geo && window.__cualign.state.teeth[id].userData.cutMesh.visible && c.faces.index.count > 0)")
            assert await page.locator('.legend [data-key="ipr_face"]').is_visible()
            await page.locator('#flow button[data-step="initial"]').click()
            assert await page.evaluate("Object.values(window.__cualign.state.teeth).every((m) => m.geometry === m.userData.full && !m.userData.cutMesh.visible)")
            await page.locator('#flow button[data-step="stages"]').click()
            assert await page.evaluate(f"Object.entries({cut_set}).every(([id, c]) => window.__cualign.state.teeth[id].geometry === c.geo)")
            await page.evaluate(f"window.__cualign.loadPlan('{plan131}')")     # back to the fallback's plan for the steps below
            await page.wait_for_function(f"window.__cualign.state.plan?.plan_id === '{plan131}' && !window.__cualign.state.loading", timeout=60000)
            # each crown is that plan's cut geometry where it cuts, the scan's where it does not (확장 cuts nothing; since #143 the retry may pick IPR)
            assert await page.evaluate(f"Object.entries(window.__cualign.state.teeth).every(([id, m]) => m.geometry === (window.__cualign.state.cutSets['plan:{plan131}']?.[id]?.geo ?? m.userData.full))")
            async def no_answer_stream(route):
                rid = route.request.post_data_json["cualign"]["request_id"]
                nl = chr(10)
                body = ('event: plan_error' + nl + 'data: {"request_id":"' + rid + '","case_id":"poseidon-000131","kind":"no_answer",'
                        '"message":"모델이 답을 만들지 못했습니다 (가짜 안내문)."}' + nl + nl
                        + 'data: {"value":"모델이 답을 만들지 못했습니다 (가짜 안내문)."}' + nl + nl)
                await route.fulfill(status=200, content_type="text/event-stream", body=body)
            await page.route("**/chat/stream", no_answer_stream)
            await page.locator("#chatInput").fill("발치 없이 다시 짜줘")
            await page.locator("#sendBtn").click()
            await page.wait_for_function("!document.querySelector('#retryBar').hidden && !document.querySelector('#sendBtn').disabled", timeout=60000)
            assert "가짜 안내문" in await page.locator(".msg.error").last.inner_text()
            assert await page.locator("#resendBtn").is_visible()
            # a sample case offers 건너뛰기 instead of 에이전트 없이 계산 on a failed turn (#15). Without a recording (404, faked
            # here: every sample has one since #134) the plan on screen is adopted
            assert await page.locator("#skipBtn").is_visible() and await page.locator("#retryFallback").is_hidden()
            await page.route("**/api/cases/poseidon-000131/replay", lambda route: route.fulfill(status=404, content_type="application/json", body='{"detail":"녹화된 답이 없습니다"}'))
            before_skip = await on_screen()
            await page.locator("#skipBtn").click()
            await page.wait_for_selector(".msg.system:has-text('건너뛰었습니다')")      # the retry bar hides before the 404 comes back
            assert await page.locator("body").evaluate("b => b.classList.contains('step-stages')") and await page.evaluate("document.querySelector('#retryBar').hidden")
            assert "건너뜀" in await page.locator("#plans .plan-row.current .pill").inner_text()
            assert await page.locator(".msg.system", has_text="건너뛰었습니다").count() == 1
            await page.unroute("**/api/cases/poseidon-000131/replay")
            # the five recorded steps (#20 contract; the route is shaped here until the server knows these names): each
            # failed turn offers 건너뛰기, the recording lands like the agent's step_done / plan_selected
            seen = []
            async def replay_route(route):
                req = route.request.post_data_json; seen.append(req["step"])
                rec = {"recorded": True, "recorded_at": "2026-09-28T10:00:00", "answer_md": f"녹화된 {req['step']} 답입니다 (가짜).", "plan_selected": None, "plans": []}
                if req["step"] == "setup": rec["constraints"] = {"extraction": [], "lock": [2], "ipr_exclude": [], "ipr_limit_mm": 0.2, "stage_cap": None, "order": "simultaneous",
                                                                  "ipr_surfaces": [[7, 8, 0.4], [8, 9, 0.4], [9, 10, 0.4]]}   # 000131's prescription (#57): 12-11 · 11-21 · 21-22
                elif req["step"] == "target": rec.update(target_id="t-fake", summary={"crowding_mm": 4.2, "space_mm": 4.4, "strategy": "expansion_ipr", "extraction": [], "ipr": []})
                elif req["step"] in ("stages", "cap"): rec["plan_selected"] = {"plan_id": before_skip, "parent_plan_id": None, "review": {"status": "skipped"}}
                await route.fulfill(status=200, content_type="application/json", body=json.dumps(rec))
            await page.route("**/api/cases/poseidon-000131/replay", replay_route)
            async def skip_turn(n):
                await page.wait_for_function("!document.querySelector('#retryBar').hidden && !document.querySelector('#sendBtn').disabled", timeout=60000)
                await page.locator("#skipBtn").click()
                await page.wait_for_function(f"document.querySelectorAll('.msg.assistant.recorded').length === {n} && !window.__cualign.state.streaming", timeout=60000)
            await page.locator("#tabCond").click(); await page.locator("#condApply").click()      # setup again, by hand-edited conditions
            await skip_turn(1)
            assert await page.evaluate("window.__cualign.state.setup.lock") == [2] and await page.locator("#cLock").input_value() == "17"      # Universal 2 = FDI 17
            assert await page.locator("body").evaluate("b => b.classList.contains('step-setup')") and await page.locator('#flow button[data-step="stages"]').is_disabled()
            # the per-contact prescription (#57): the 조건 tab shows it in FDI, the 3D marks exactly those three contacts,
            # and the patch carries it back in FDI
            assert await page.locator("#cSurf").input_value() == "12-11 0.4, 11-21 0.4, 21-22 0.4"
            assert await page.locator(".ipr-mark").count() == 3
            assert await page.evaluate("window.__cualign.readConstraints().ipr_surfaces") == [[12, 11, 0.4], [11, 21, 0.4], [21, 22, 0.4]]
            await next_chip("목표 배열 만들기").click()
            await skip_turn(2)
            assert await page.locator("body").evaluate("b => b.classList.contains('step-target')") and await page.evaluate("window.__cualign.state.targetId") == "t-fake"
            assert await next_chip("비발치안과 비교").count() == 1      # 000131 is a non-extraction case
            await next_chip("단계 만들기").click()
            await skip_turn(3)
            await page.wait_for_function(f"document.body.classList.contains('step-stages') && {plan_on_screen} === '{before_skip}' && !window.__cualign.state.loading", timeout=60000)   # the plan (and its cut, #22) load after the recorded bubble
            await page.locator("#chatInput").fill("8개월 안에 끝나게 다시 짜줘."); await page.locator("#sendBtn").click()
            await skip_turn(4)
            await page.locator("#chatInput").fill("확장안이랑 IPR안 둘 다 만들어서 비교해줘."); await page.locator("#sendBtn").click()
            await skip_turn(5)
            assert await on_screen() == before_skip and await page.locator("#planNotice").inner_text() == ""
            assert seen == ["setup", "target", "stages", "cap", "compare"], seen
            assert "녹화된 답 · 2026-09-28" in await page.locator(".msg.assistant.recorded .recorded-tag").last.inner_text()
            await page.unroute("**/api/cases/poseidon-000131/replay")
            await page.unroute("**/chat/stream")

            # The server may keep the case's step state and send it with /activate (#20 decision 1, shaped here until it
            # does): setup → the strip opens to 셋업 with the conditions, target_id → to 목표, plan_id → to 단계
            async def activate_with_state(route):
                r = await route.fetch(); body = await r.json()
                body["state"] = {"setup": {"extraction": [5, 12], "lock": [], "ipr_exclude": [], "ipr_limit_mm": 0.2, "stage_cap": None, "order": "simultaneous"}, "target_id": "t-fake", "plan_id": None}
                await route.fulfill(json=body)
            await page.route("**/api/cases/poseidon-000097/activate", activate_with_state)
            await page.goto(url + "/ui/#case=poseidon-000097&step=target")
            await page.wait_for_function("document.body.classList.contains('step-target') && window.__cualign.state.targetId === 't-fake' && window.__cualign.state.activeCase === 'poseidon-000097'", timeout=120000)
            assert await page.locator("#cIpr").input_value() == "0.2" and await page.locator('#flow button[data-step="stages"]').is_disabled()
            assert await page.locator(".next:not(.done) button", has_text="단계 만들기").count() == 1      # the chips continue from the restored step
            assert "목표 배열까지" in await page.locator(".msg.assistant").last.inner_text()
            assert await page.evaluate("window.__cualign.cutKeyNow() === 'target:t-fake'")   # #22: the target's cut comes after it, under its key
            await page.wait_for_function("'target:t-fake' in window.__cualign.state.cutSets", timeout=60000)
            await page.unroute("**/api/cases/poseidon-000097/activate")

            assert not errors, errors
            print("PASS: agent-driven steps (setup → target → stages, look back, five replay steps), export/approval, revision, plan cards (보기 switches the plan), reviewer failure, manual re-review, "
                  "stale response, reload keeps case and plan, case switch opens its own preview plan, "
                  "my scan: unsupported gap → 스캔 삭제, rejected upload card, unoriented scan, reversed numbering → mirror, "
                  "no-plan failure card → 이 조건으로 다시 계산, no_answer notice → 다시 보내기")
            await browser.close()
            browser = None
    finally:
        if browser is not None:
            await browser.close()
        server.should_exit = True
        thread.join(timeout=5)
        sock.close()


if __name__ == "__main__":
    asyncio.run(main())
