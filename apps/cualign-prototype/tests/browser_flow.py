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
            await page.locator("#tabCond").click()
            await page.locator("#fallbackBtn").click()
            await page.wait_for_function(f"{plan_on_screen}.startsWith('p') && !document.querySelector('#fallbackBtn').disabled"
                f" && document.querySelector('#viewCanvas').dataset.planId === {plan_on_screen}")
            parent = await on_screen()
            # The design flow (#15): the rule-based plan lands on 단계; 초기 → 셋업 → 목표 → 단계 by the next button, the step
            # in the address, a reload and the strip's buttons keep it.
            assert await page.locator("body").evaluate("b => b.classList.contains('step-stages')")
            await page.locator('#flow button[data-step="initial"]').click()
            await page.wait_for_function("document.body.classList.contains('step-initial') && window.__cualign.state.stage === 0")
            assert not await page.locator(".stage-bar").is_visible()
            assert "&step=" not in await page.evaluate("location.hash")
            await page.locator("#stepNext").click()      # 셋업 보기
            await page.wait_for_function("document.body.classList.contains('step-setup')")
            assert (await page.evaluate("location.hash")).endswith("&step=setup")
            await page.locator("#stepNext").click()      # 목표 배열 보기
            await page.wait_for_function("document.body.classList.contains('step-target') && window.__cualign.state.stage === window.__cualign.state.plan.stages.length")
            await page.locator("#stepNext").click()      # 단계 만들기
            await page.wait_for_function("document.body.classList.contains('step-stages') && window.__cualign.state.stage === 0")
            assert await page.locator(".stage-bar").is_visible()
            await page.reload()
            await page.wait_for_function("document.body.classList.contains('step-stages') && document.body.classList.contains('has-plan')", timeout=120000)
            assert await on_screen() == parent
            assert await page.locator("#viewCanvas").get_attribute("data-plan-id") == parent
            assert await page.locator(f'#plans .plan-row.current[data-plan="{parent}"] .viewing').is_visible()
            assert await page.locator("#stlLink").get_attribute("href") is None
            parent_detail = store_module.STORE.plan_json(parent)
            assert parent_detail["passed"] and parent_detail["review"]["status"] == "skipped"
            assert "규칙 통과 · 검토 전" in await page.locator("#plans .plan-row.current .pill").inner_text()
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
            async with page.expect_download() as download:
                await page.locator("#exportGo").click()
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

            # Going home and opening a different (real) sample card: the case opens with its own rule-based preview
            # plan (#92), never the previous case's plan.
            await page.locator("#homeBtn").click()
            await page.wait_for_function("document.body.classList.contains('start')")
            await page.locator('#sampleCards .case-card[data-id="poseidon-000001"]').click()      # card → detail under it
            assert await page.locator("#clDetail").is_visible() and await page.locator("#dArch circle:not(.ipr-dot)").count() == 14   # crowns only: 000001 also draws IPR-exclusion dots
            assert await page.locator('#sampleCards > #clDetail.in-cards').count() == 1      # under the card row
            assert await page.locator("#intro").is_visible()   # the intro panel is back on the left (③)
            await page.locator("#dOpen").click()
            await page.wait_for_function(f"(p) => !document.body.classList.contains('start') && document.body.classList.contains('has-plan') && {plan_on_screen} !== p", arg=child)
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
            assert "결손" in facts and "4" in facts, facts
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
            await page.locator("#planFailRetry").click()
            await page.wait_for_function("document.querySelector('#planFail').hidden && document.body.classList.contains('has-plan')", timeout=120000)
            assert await page.locator("#planList .plan-row").count() >= 1
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
            await page.goto(url + "/ui/#case=poseidon-000131")
            await page.wait_for_function("document.body.classList.contains('has-plan') && !document.querySelector('#sendBtn').disabled", timeout=120000)
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
            # a sample case offers 건너뛰기 instead of 에이전트 없이 계산 on a failed turn (#15): the plan on screen is adopted
            assert await page.locator("#skipBtn").is_visible() and await page.locator("#retryFallback").is_hidden()
            await page.locator("#skipBtn").click()
            await page.wait_for_function("document.body.classList.contains('step-stages') && document.querySelector('#retryBar').hidden")
            assert "건너뜀" in await page.locator("#plans .plan-row.current .pill").inner_text()
            assert await page.locator(".msg.system", has_text="건너뛰었습니다").count() == 1
            # with a recorded answer (contract 12-replay.md, shaped here until the server ships it): the answer plays in
            # the agent's place, grey with its date, and its plan_selected lands like an agent turn
            recorded_plan = await on_screen()
            async def replay_route(route):
                assert route.request.post_data_json["step"] == "plan", route.request.post_data_json
                await route.fulfill(status=200, content_type="application/json", body=json.dumps({
                    "recorded": True, "answer_md": "녹화된 답입니다 (가짜). 처방대로 발치 계획을 짰습니다.",
                    "plan_selected": {"plan_id": recorded_plan, "parent_plan_id": None, "review": {"status": "skipped"}},
                    "plans": [], "recorded_at": "2026-09-28T10:00:00"}))
            await page.route("**/api/cases/poseidon-000131/replay", replay_route)
            await page.locator("#chatInput").fill("처방대로 계획 짜줘")      # a new failed turn (건너뛰기 hid the retry bar)
            await page.locator("#sendBtn").click()
            await page.wait_for_function("!document.querySelector('#retryBar').hidden && !document.querySelector('#sendBtn').disabled", timeout=60000)
            await page.locator("#skipBtn").click()
            await page.wait_for_selector(".msg.assistant.recorded")
            assert "녹화된 답 · 2026-09-28" in await page.locator(".msg.assistant.recorded .recorded-tag").inner_text()
            assert "녹화된 답입니다" in await page.locator(".msg.assistant.recorded").inner_text()
            assert await on_screen() == recorded_plan and await page.locator("body").evaluate("b => b.classList.contains('step-stages')")
            await page.unroute("**/api/cases/poseidon-000131/replay")
            await page.unroute("**/chat/stream")

            assert not errors, errors
            print("PASS: browser rule-based plan, export/approval, revision, plan cards (보기 switches the plan), reviewer failure, manual re-review, "
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
