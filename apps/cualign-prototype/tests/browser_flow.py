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

            # Rule-based plan via the folded conditions panel (no model): open the details, then the fallback button.
            # Also open the result panel's "자세히" details so #rPlan/#rParent/#rReview/... are visible (inner_text
            # needs layout; their contents are correct but invisible while the <details> is closed).
            await page.locator("#condBox").evaluate("(el) => { el.open = true; }")
            await page.locator(".plan-meta").evaluate("(el) => { el.open = true; }")
            await page.locator("#fallbackBtn").click()
            await page.wait_for_function("document.querySelector('#rPlan').textContent.startsWith('p') && !document.querySelector('#fallbackBtn').disabled"
                " && document.querySelector('#viewCanvas').dataset.planId === document.querySelector('#rPlan').textContent")
            parent = await page.locator("#rPlan").inner_text()
            assert await page.locator("#viewCanvas").get_attribute("data-plan-id") == parent
            assert await page.locator("#stlLink").get_attribute("href") is None
            parent_detail = store_module.STORE.plan_json(parent)
            assert parent_detail["passed"] and parent_detail["review"]["status"] == "skipped"
            assert await page.locator("#rReview").inner_text() == "미실행 (규칙 폴백)"
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
            await page.wait_for_function("document.querySelector('#rApproval').textContent.startsWith('의사 승인됨')")
            assert parent in await page.locator("#stlLink").get_attribute("href")
            assert (await page.locator("#exportBtn").inner_text()) == "STL 내려받기"
            await (await download.value).save_as(OUT / "approved-stages.zip")

            # Revoke the approval (「자세히」 details, next to the review fields) and confirm export gates again.
            await page.locator("#revokeBtn").click()
            await page.wait_for_function("document.querySelector('#rApproval').textContent === '미승인'")
            assert (await page.locator("#exportBtn").inner_text()) == "내보내기"
            assert await page.locator("#stlLink").get_attribute("href") is None
            # Re-approve so the plan is on screen as approved again before the next edit invalidates it.
            await page.locator("#exportBtn").click()
            await page.wait_for_selector("#exportPop:not([hidden])")
            await page.locator("#exportGo").click()
            await page.wait_for_function("document.querySelector('#rApproval').textContent.startsWith('의사 승인됨')")

            # Editing the folded conditions makes the on-screen (approved) plan stale for export until replanned.
            await page.locator("#cLock").fill("13")
            assert await page.locator("#exportBtn").is_disabled()
            await page.locator("#fallbackBtn").click()
            await page.wait_for_function("(p) => document.querySelector('#rPlan').textContent !== p && !document.querySelector('#fallbackBtn').disabled"
                " && document.querySelector('#viewCanvas').dataset.planId === document.querySelector('#rPlan').textContent", arg=parent)
            child = await page.locator("#rPlan").inner_text()
            assert await page.locator("#rParent").inner_text() == parent
            assert await page.locator("#rApproval").inner_text() == "미승인"
            assert await page.locator("#stlLink").get_attribute("href") is None
            assert await page.locator("#viewCanvas").get_attribute("data-plan-id") == child
            await page.locator("#stageSlider").evaluate("(el) => { el.value=el.max; el.dispatchEvent(new Event('input')); }")
            after = await page.locator("#viewCanvas").screenshot()
            assert before != after
            await page.screenshot(path=str(OUT / "revision.png"))

            # The decision bar for this revision lets the dentist undo it; revert, then pick the child plan again
            # through #planSelect so the rest of the script continues from it.
            await page.locator(".decision").last.locator('[data-act="revert"]').click()
            await page.wait_for_function("(p) => document.querySelector('#rPlan').textContent === p", arg=parent)
            await page.locator("#planSelect").evaluate("(el,p)=>{el.value=p;el.dispatchEvent(new Event('change'));}", child)
            await page.wait_for_function("(p) => document.querySelector('#rPlan').textContent === p", arg=child)

            # Send a real HTTP stream through PlanEventsASGI and the actual tool group. The fake reviewer fails and
            # the streamed text carries an unrelated plan id that must not steer selection.
            await page.locator("#chatInput").fill("IPR은 앞니 빼고 다시 짜줘")
            await page.locator("#sendBtn").click()
            await page.wait_for_function("document.querySelector('#rReview').textContent === '검토 실패' && !document.querySelector('#sendBtn').disabled")
            selected = await page.locator("#rPlan").inner_text()
            assert selected != "p999" and selected != child
            assert await page.locator("#rParent").inner_text() == child
            assert await page.locator("#cLock").input_value() == "13"
            assert await page.locator("#cExclude").input_value() == "7, 8, 9, 10"
            assert await page.locator("#exportBtn").is_disabled()
            assert await page.locator("#stlLink").get_attribute("href") is None
            assert await page.locator(".plan-card").last.is_visible()
            assert await page.locator(".msg.error").last.is_visible()
            decision2 = page.locator(".decision").last
            assert await decision2.is_visible()
            assert await decision2.locator('[data-act="revert"]').count() == 1   # keeping needs no button
            assert await decision2.locator('[data-act="keep"]').count() == 0
            await page.screenshot(path=str(OUT / "review-failure.png"))

            # The dentist asks for the failed review again on the same plan.
            assert await page.locator("#reviewBtn").is_visible()
            await page.locator("#reviewBtn").click()
            await page.wait_for_function("document.querySelector('#rReview').textContent === '메모 생성 완료' && !document.querySelector('#sendBtn').disabled")
            assert await page.locator("#rPlan").inner_text() == selected
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
            await page.locator("#planSelect").evaluate("(el,p)=>{el.value=p;el.dispatchEvent(new Event('change'));}", parent)
            await pending.wait()
            await page.locator("#planSelect").evaluate("(el,p)=>{el.value=p;el.dispatchEvent(new Event('change'));}", child)
            await page.wait_for_function("(p)=>document.querySelector('#rPlan').textContent===p", arg=child)
            release.set()
            await page.wait_for_timeout(100)
            assert await page.locator("#rPlan").inner_text() == child
            assert await page.locator("#viewCanvas").get_attribute("data-plan-id") == child

            # Reload keeps the case and the plan on screen via the #case=…&plan=… address (#90).
            assert (await page.evaluate("location.hash")) == f"#case=moderate&plan={child}"
            case_name_before = await page.locator("#caseName").inner_text()
            await page.reload()
            await page.wait_for_function("!document.body.classList.contains('start')")
            await page.wait_for_function("(p) => document.querySelector('#rPlan').textContent === p", arg=child, timeout=120000)
            assert await page.locator("#caseName").inner_text() == case_name_before
            assert await page.locator("#stlLink").get_attribute("href") is None   # approval was revoked above

            # Going home and opening a different (real) sample card: the case opens with its own rule-based preview
            # plan (#92), never the previous case's plan.
            await page.locator("#homeBtn").click()
            await page.wait_for_function("document.body.classList.contains('start')")
            await page.locator('#clRows .case-row[data-id="poseidon-000097"]').click()      # row → detail panel
            assert await page.locator("#clDetail").is_visible() and await page.locator("#dArch circle").count() == 14
            await page.locator("#dOpen").click()
            await page.wait_for_function("(p) => !document.body.classList.contains('start') && document.body.classList.contains('has-plan') && document.querySelector('#rPlan').textContent !== p", arg=child)
            assert (await page.evaluate("location.hash")).startswith("#case=poseidon-000097")
            assert await page.locator("#stlLink").get_attribute("href") is None
            assert not errors, errors
            print("PASS: browser rule-based plan, export/approval, revision, reviewer failure, manual re-review, "
                  "stale response, reload keeps case and plan, case switch opens its own preview plan")
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
