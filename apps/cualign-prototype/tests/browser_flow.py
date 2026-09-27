"""Browser acceptance using synthetic plans and a fake reviewer, never NIM.
Run: uv run --frozen --with playwright python tests/browser_flow.py
Requires installed Chrome or PLAYWRIGHT_CHROMIUM_EXECUTABLE. UI CDN access is required.
"""
import asyncio
import json
import os
from pathlib import Path
import socket
import sys
import threading

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


async def fake_manual_review(plan_id):
    class Memo:
        async def ainvoke(self, messages):
            return "검토 메모 초안 (가짜 검토)"
    return await review_plan(plan_id, Memo(), manual=True)


api.add_api_routes(app, review=fake_manual_review)
app.add_middleware(plan_events.PlanEventsASGI)


@app.post("/chat/stream")
async def fake_chat(request: Request):
    async def generate():
        async with register.cualign(register.CuAlignToolConfig(), None) as group:
            tools = await group.get_all_functions()
            def tool(name):
                return next(fn for key, fn in tools.items() if key.split("__")[-1] == name)
            # Exercise actual NAT tool functions, but no external LLM.
            await tool("set_constraints").ainvoke(ConstraintPatch(ipr_exclude=[7,8,9,10]))
            result = await tool("compare_strategies").ainvoke(register.CompareInput())
            selected = next((p for p in result["plans"] if p["passed"]), result["plans"][0])
            await tool("select_plan").ainvoke(register.PlanIdInput(plan_id=selected["plan_id"]))
            class Empty:
                async def ainvoke(self, messages):
                    return ""
            await review_plan(selected["plan_id"], Empty())
            # An unrelated ID in text must not control selection.
            yield 'data: {"value":"검토 실패. 이전 후보 plan_id: p999는 선택하지 않습니다."}\n\n'
    return StreamingResponse(generate(), media_type="text/event-stream")


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
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("dialog", lambda dialog: dialog.accept())
            # ?case=<id> is the documented dev/test hook; "moderate" is a synthetic preset with no start-screen
            # card (#90 — the start screen only offers Poseidon3D samples), so it opens the workspace deterministically.
            await page.goto(url + "/ui/?case=moderate")
            await page.wait_for_function("!document.body.classList.contains('start')")

            # Rule-based plan from the sidebar's 조건 tab (no model). The plan on screen is the canvas's data-plan-id;
            # the cards on the panel top mark it 보는 중 (#111). Helpers read the test hook, not the removed result card.
            plan_on_screen = "(window.__cualign.state.plan?.plan_id ?? '')"
            async def on_screen():
                return await page.evaluate(plan_on_screen)
            async def approval():
                return await page.evaluate("window.__cualign.state.plan?.approval ?? null")
            await page.locator("#tabCond").click()
            await page.locator("#fallbackBtn").click()
            await page.wait_for_function(f"{plan_on_screen}.startsWith('p') && !document.querySelector('#fallbackBtn').disabled"
                f" && document.querySelector('#viewCanvas').dataset.planId === {plan_on_screen}")
            parent = await on_screen()
            assert await page.locator("#viewCanvas").get_attribute("data-plan-id") == parent
            assert await page.locator(f'#plans .plan-row.current[data-plan="{parent}"] .viewing').is_visible()
            assert await page.locator("#stlLink").get_attribute("href") is None
            parent_detail = store_module.STORE.plan_json(parent)
            assert parent_detail["passed"] and parent_detail["review"]["status"] == "skipped"
            assert "미실행 (규칙 폴백)" in await page.locator("#reviewLine").inner_text()
            assert int(await page.locator("#stageSlider").get_attribute("max")) == parent_detail["info"]["n_stages"]
            await page.locator("#stageSlider").fill(str(parent_detail["info"]["n_stages"]))
            await page.locator("#stageSlider").dispatch_event("input")
            before = await page.locator("#viewCanvas").screenshot()

            # Export is gated on a passing, reviewed plan; approving happens through the export popover, which then
            # clicks the hidden download link itself.
            assert await page.locator("#exportBtn").is_enabled()
            await page.locator("#exportBtn").click()
            await page.wait_for_selector("#exportPop:not([hidden])")
            async with page.expect_download() as download:
                await page.locator("#exportGo").click()
            await page.wait_for_function("!!window.__cualign.state.plan?.approval")
            assert await page.locator('#plans .plan-row.current .pill').inner_text() == "승인됨"
            assert parent in await page.locator("#stlLink").get_attribute("href")
            assert (await page.locator("#exportBtn").inner_text()) == "STL 내려받기"
            await (await download.value).save_as(OUT / "approved-stages.zip")

            # Revoke the approval (the 검토 fold under the plan cards) and confirm export gates again.
            await page.locator("#planReview").evaluate("(el) => { el.open = true; }")
            await page.locator("#revokeBtn").click()
            await page.wait_for_function("!window.__cualign.state.plan?.approval")
            assert (await page.locator("#exportBtn").inner_text()) == "내보내기"
            assert await page.locator("#stlLink").get_attribute("href") is None
            # Re-approve so the plan is on screen as approved again before the next edit invalidates it.
            await page.locator("#exportBtn").click()
            await page.wait_for_selector("#exportPop:not([hidden])")
            await page.locator("#exportGo").click()
            await page.wait_for_function("!!window.__cualign.state.plan?.approval")

            # Editing the conditions makes the on-screen (approved) plan stale for export until replanned.
            await page.locator("#cLock").fill("13")
            assert await page.locator("#exportBtn").is_disabled()
            assert "조건이 바뀜" in await page.locator("#condState").inner_text()
            await page.locator("#fallbackBtn").click()
            await page.wait_for_function(f"(p) => {plan_on_screen} !== p && !document.querySelector('#fallbackBtn').disabled"
                f" && document.querySelector('#viewCanvas').dataset.planId === {plan_on_screen}", arg=parent)
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
            assert "검토 실패" in await page.locator("#reviewLine").inner_text()
            assert await page.locator("#cLock").input_value() == "13"
            assert await page.locator("#cExclude").input_value() == "7, 8, 9, 10"
            assert await page.locator("#exportBtn").is_disabled()
            assert await page.locator("#stlLink").get_attribute("href") is None
            # a comparison turn adds one card per plan it made; the selected one is 보는 중
            assert await page.locator("#planList .plan-row").count() >= 3
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
            assert "메모 생성 완료" in await page.locator("#reviewLine").inner_text()
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
            assert (await page.evaluate("location.hash")) == f"#case=moderate&plan={child}"
            case_name_before = await page.locator("#caseName").inner_text()
            await page.reload()
            await page.wait_for_function("!document.body.classList.contains('start')")
            await page.wait_for_function(f"(p) => {plan_on_screen} === p", arg=child, timeout=120000)
            assert await page.locator(f'#plans .plan-row.current[data-plan="{child}"]').count() == 1
            assert await page.locator("#caseName").inner_text() == case_name_before
            assert await page.locator("#stlLink").get_attribute("href") is None   # approval was revoked above

            # Going home and opening a different (real) sample card: the case opens with its own rule-based preview
            # plan (#92), never the previous case's plan.
            await page.locator("#homeBtn").click()
            await page.wait_for_function("document.body.classList.contains('start')")
            await page.locator('#clRows .case-row[data-id="poseidon-000097"]').click()      # row → detail panel
            assert await page.locator("#clDetail").is_visible() and await page.locator("#dArch circle").count() == 14
            await page.locator("#dOpen").click()
            await page.wait_for_function(f"(p) => !document.body.classList.contains('start') && document.body.classList.contains('has-plan') && {plan_on_screen} !== p", arg=child)
            assert (await page.evaluate("location.hash")).startswith("#case=poseidon-000097")
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
            assert "결손" in facts and "4" in facts, facts
            assert await page.locator("#startPlan").is_disabled()
            assert await page.locator("#checkBar").evaluate("e => e.classList.contains('fail')")
            await page.screenshot(path=str(OUT / "check-unsupported.png"))
            await page.set_input_files("#scanInput", flipped)   # a second scan for the same patient
            await page.wait_for_function("document.querySelector('#checkFacts').textContent.includes('좌우 반대') && !document.querySelector('#mirrorBtn').hidden", timeout=120000)
            await page.screenshot(path=str(OUT / "check-reversed.png"))
            await page.locator("#mirrorBtn").click()
            await page.wait_for_function("document.querySelector('#mirrorBtn').hidden && !document.querySelector('#startPlan').disabled", timeout=120000)
            facts = await page.locator("#checkFacts").inner_text()
            assert "좌우 반대" not in facts and "문제 없음" in facts, facts
            pid = await page.evaluate("window.__cualign.state.patient.patient_id")
            await page.evaluate("(pid) => fetch('/api/patients/' + pid, { method: 'DELETE' }).then((r) => r.ok)", pid)   # reruns start empty
            assert not errors, errors
            print("PASS: browser rule-based plan, export/approval, revision, plan cards (보기 switches the plan), reviewer failure, manual re-review, "
                  "stale response, reload keeps case and plan, case switch opens its own preview plan, "
                  "my scan: unsupported gap and reversed numbering → mirror")
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
