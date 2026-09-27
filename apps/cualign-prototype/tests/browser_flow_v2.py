"""Value-based browser acceptance test for cuAlign UI v2.

Run only when a full browser acceptance run is wanted::

    uv run --frozen --with playwright python tests/browser_flow_v2.py

The C5 worker only syntax-checks this file.  The flow deliberately contains
strict assertions for every defect listed in J9.md; the current UI may fail
several of them until the integration and responsive workers finish.
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import re
import shutil
import socket
import sys
import tempfile
import threading
import zipfile

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from playwright.async_api import Page, async_playwright

from cualign.core import store as store_module
from cualign.server import api, plan_events


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "out" / "browser-acceptance" / "v2"
SAMPLE_DIR = ROOT / "src" / "cualign" / "core" / "samples" / "poseidon-000131"
SAMPLE_CASE_000001 = "poseidon-000001"
SAMPLE_CASE_000131 = "poseidon-000131"
LOWER_ARCH_ERROR = (
    "18.stl: 하악(Universal 17~32) 번호입니다. 지금은 상악 스캔만 받습니다."
)
VIEWPORTS = (
    (1920, 1080),
    (1440, 900),
    (1280, 800),
    (1024, 768),
    (390, 844),
)


async def fake_manual_review(plan_id: str) -> dict:
    """Return a deterministic reviewer result without NIM or another model."""
    return {"status": "passed", "message": "가짜 검토 통과", "manual": True}


def make_app() -> FastAPI:
    """Build the real API with a local synthetic chat stream."""
    app = FastAPI()
    api.add_api_routes(app, review=fake_manual_review)

    @app.post("/chat/stream")
    async def fake_chat(request: Request):
        # PlanEventsASGI validates and rewrites the ChatContext before this
        # handler is reached. Reading the body also proves the request is a
        # valid JSON stream request, while never invoking an external model.
        await request.json()

        async def generate():
            yield 'data: {"value":"가짜 스트림 응답"}\n\n'

        return StreamingResponse(generate(), media_type="text/event-stream")

    app.add_middleware(plan_events.PlanEventsASGI)
    return app


def get_chromium_executable() -> str | None:
    env_path = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")
    if env_path and os.path.exists(env_path):
        return env_path
    candidates = (
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    )
    return next((path for path in candidates if os.path.exists(path)), None)


class AcceptanceChecks:
    """Collect independent contract failures so one defect does not hide others."""

    def __init__(self) -> None:
        self.assertions: list[dict] = []

    def check(self, condition: bool, source: str, message: str, actual=None) -> None:
        item = {"source": source, "passed": bool(condition), "message": message}
        if actual is not None:
            item["actual"] = actual
        self.assertions.append(item)
        status = "PASS" if condition else "FAIL"
        print(f"  [{status}] {source}: {message}")

    def raise_if_failed(self) -> None:
        failures = [item for item in self.assertions if not item["passed"]]
        if failures:
            details = "\n".join(
                f"- {item['source']}: {item['message']} (actual={item.get('actual')!r})"
                for item in failures
            )
            raise AssertionError(f"{len(failures)} browser contract assertion(s) failed:\n{details}")


class BrowserTelemetry:
    """Record unhandled page errors and browser-observed 4xx responses."""

    def __init__(self, page: Page) -> None:
        self.page_errors: list[dict] = []
        self.http_4xx: list[dict] = []
        self.screen = "startup"
        page.on("pageerror", self._on_page_error)
        page.on("response", self._on_response)

    def _on_page_error(self, error) -> None:
        self.page_errors.append({"screen": self.screen, "message": str(error)})

    def _on_response(self, response) -> None:
        if 400 <= response.status < 500:
            self.http_4xx.append({
                "screen": self.screen,
                "status": response.status,
                "method": response.request.method,
                "url": response.url,
            })

    def mark(self) -> tuple[int, int]:
        return len(self.page_errors), len(self.http_4xx)

    def assert_clean(
        self,
        checks: AcceptanceChecks,
        mark: tuple[int, int],
        source: str,
        *,
        allow_4xx: bool = False,
    ) -> None:
        error_index, http_index = mark
        new_errors = self.page_errors[error_index:]
        new_4xx = self.http_4xx[http_index:]
        checks.check(
            not new_errors,
            source,
            "pageerror가 0개여야 한다",
            new_errors,
        )
        if not allow_4xx:
            checks.check(
                not new_4xx,
                source,
                "의도하지 않은 4xx 응답이 0개여야 한다",
                new_4xx,
            )


async def wait_for_settled(page: Page) -> None:
    await page.wait_for_load_state("domcontentloaded")
    await page.wait_for_timeout(250)


async def document_metrics(page: Page) -> dict:
    return await page.evaluate(
        """() => ({
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
            bodyScrollWidth: document.body.scrollWidth,
            bodyScrollHeight: document.body.scrollHeight
        })"""
    )


async def screenshot(page: Page, name: str) -> str:
    path = OUT_DIR / name
    await page.screenshot(path=str(path), full_page=False)
    return path.name


async def open_route(page: Page, base_url: str, route: str, selector: str) -> None:
    await page.goto(f"{base_url}/ui/v2/{route}")
    await page.wait_for_selector(selector, timeout=20_000)
    await wait_for_settled(page)


async def select_plan_three(page: Page, checks: AcceptanceChecks):
    plan_three = page.locator(".plan-card").filter(has_text=re.compile(r"계획\s*3(?:\D|$)")).first
    checks.check(
        await plan_three.count() == 1,
        "J9-2",
        "000131 작업대에 계획 3 카드가 있어야 한다",
        await page.locator(".plan-card-title").all_inner_texts(),
    )
    if await plan_three.count() == 0:
        return page.locator(".plan-card-viewing").first
    if "plan-card-viewing" not in ((await plan_three.get_attribute("class")) or ""):
        view_button = plan_three.locator(".plan-card-view-btn")
        if await view_button.count() and await view_button.is_enabled():
            await view_button.click()
            await page.wait_for_timeout(350)
    return page.locator(".plan-card-viewing").first


async def assert_cases_and_detail(
    page: Page,
    base_url: str,
    checks: AcceptanceChecks,
    telemetry: BrowserTelemetry,
    screenshots: list[str],
) -> None:
    telemetry.screen = "cases"
    mark = telemetry.mark()
    await open_route(page, base_url, "#/cases", ".screen-cases")
    row = page.locator(".cases-table-row").filter(has_text="000131").first
    await row.wait_for(state="visible", timeout=10_000)
    row_text = await row.inner_text()
    checks.check("000131" in row_text, "J9-10", "케이스 행은 샘플 번호 000131을 표시한다", row_text)
    checks.check(
        SAMPLE_CASE_000131 not in row_text,
        "J9-10",
        "케이스 행은 내부 id를 노출하지 않는다",
        row_text,
    )
    checks.check(
        len([line for line in row_text.splitlines() if line.strip()]) >= 2,
        "J9-10",
        "케이스 행은 번호와 제목을 함께 표시한다",
        row_text,
    )
    checks.check(
        "(FDI" not in row_text and "앱 번호" not in row_text,
        "J9-11",
        "케이스 표 처방 칸에 FDI·앱 번호 덧붙임이 없어야 한다",
        row_text,
    )
    telemetry.assert_clean(checks, mark, "cases")
    screenshots.append(await screenshot(page, "01_cases_list_1920x1080.png"))

    telemetry.screen = "case-detail"
    mark = telemetry.mark()
    await open_route(page, base_url, f"#/cases/{SAMPLE_CASE_000131}", ".cases-detail-header")
    await page.wait_for_selector(".cases-check-grid", timeout=10_000)
    detail = page.locator(".cases-panel-detail, .cases-detail-panel").first
    if await detail.count() == 0:
        detail = page.locator(".cases-detail-header").locator("xpath=..").first
    detail_box = await detail.bounding_box()
    checks.check(detail_box is not None, "J9-9", "#/cases/:caseId 상세 패널이 보여야 한다")
    if detail_box:
        checks.check(
            470 <= detail_box["width"] <= 490,
            "J9-9",
            "상세 패널 폭은 설계값 480px이어야 한다",
            detail_box["width"],
        )
    for selector, label in (
        (".cases-chart-box", "치아 차트"),
        (".cases-check-grid", "스캔 확인"),
        (".cases-detail-rx-main", "처방"),
        (".cases-cta-btn", "작업대 열기"),
    ):
        checks.check(await page.locator(selector).count() > 0, "J9-9", f"상세 패널에 {label}이 있어야 한다")
    prescription = await page.locator(".cases-detail-rx-main").inner_text()
    checks.check(
        "(FDI" not in prescription and "앱 번호" not in prescription,
        "J9-11",
        "처방에 FDI·앱 번호 덧붙임이 없어야 한다",
        prescription,
    )
    topbar_text = await page.locator("#topbar").inner_text()
    checks.check(
        SAMPLE_CASE_000131 not in topbar_text,
        "J9-10",
        "상단 막대는 내부 case id를 노출하지 않는다",
        topbar_text,
    )
    telemetry.assert_clean(checks, mark, "case-detail")
    screenshots.append(await screenshot(page, "02_case_detail_1920x1080.png"))


async def assert_workspace_contracts(
    page: Page,
    base_url: str,
    checks: AcceptanceChecks,
    telemetry: BrowserTelemetry,
    screenshots: list[str],
) -> None:
    # J9-1 specifically names the 000001 summary-plan crash.
    telemetry.screen = "workspace-000001"
    mark = telemetry.mark()
    await open_route(
        page,
        base_url,
        f"#/workspace/{SAMPLE_CASE_000001}",
        ".screen-workspace-layout",
    )
    telemetry.assert_clean(checks, mark, "J9-1 workspace-000001")

    telemetry.screen = "workspace-000131"
    mark = telemetry.mark()
    await open_route(
        page,
        base_url,
        f"#/workspace/{SAMPLE_CASE_000131}",
        ".screen-workspace-layout",
    )
    viewing_card = await select_plan_three(page, checks)
    await viewing_card.wait_for(state="visible", timeout=10_000)

    slider = page.locator(".stage-slider")
    stage_bars = page.locator(".screen-workspace-layout .stage-bar")
    checks.check(
        await stage_bars.count() == 1,
        "J9-3",
        "작업대 단계 막대는 정확히 1개여야 한다",
        await stage_bars.count(),
    )
    # Plans are numbered in creation order, so the stage count of 계획 3 comes
    # from its own card (server summary n_stages) instead of a fixed number.
    stages_badge = await viewing_card.locator(".plan-badge-stages").inner_text()
    badge_match = re.search(r"([0-9]+)", stages_badge)
    expected_stages = int(badge_match.group(1)) if badge_match else None
    checks.check(
        bool(expected_stages),
        "J9-2",
        "계획 3 카드는 단계 수를 표시해야 한다",
        stages_badge,
    )
    slider_max = await slider.first.get_attribute("max") if await slider.count() else None
    checks.check(
        slider_max == str(expected_stages),
        "J9-2",
        "계획 3의 단계 막대 max는 getPlan 단계 수(카드의 n_stages)와 같아야 한다",
        {"slider_max": slider_max, "card": stages_badge},
    )
    stage_rows = await page.locator(".sidebar-staging-panel .staging-row").count()
    stage_bars = await page.locator(".sidebar-staging-panel .staging-bar").count()
    checks.check(
        stage_bars > 0,
        "J9-2",
        "계획 3의 오른쪽 단계 표는 치아별 이동 막대를 그려야 한다",
        {"bars": stage_bars},
    )
    checks.check(
        expected_stages is not None and stage_rows >= int(expected_stages),
        "J9-2",
        "계획 3의 오른쪽 단계 표는 계획의 단계 수만큼 행을 보여야 한다",
        {"rows": stage_rows, "expected": expected_stages},
    )
    sidebar_text = await page.locator(".workspace-panel-sidebar").inner_text()
    checks.check(
        "0장 · 0개월" not in sidebar_text and "표시할 단계 계획이 없습니다" not in sidebar_text,
        "J9-2",
        "사이드바는 전체 getPlan 값으로 렌더링되어야 한다",
        sidebar_text,
    )

    review_text = await viewing_card.locator(".plan-review-row").inner_text()
    checks.check(
        "규칙 폴백" in review_text,
        "J9-5",
        "skipped 검토는 규칙 폴백임을 표시해야 한다",
        review_text,
    )
    checks.check(
        await viewing_card.locator(".plan-review-retry-btn").count() == 0,
        "J9-5",
        "skipped 계획에는 검토 다시 요청 버튼이 없어야 한다",
    )

    arch_chip = page.locator(".workspace-viewer-container .viewer-arch-info")
    chip_text = await arch_chip.inner_text() if await arch_chip.count() else ""
    checks.check(
        bool(re.fullmatch(r"상악 · 치아 14개 · 계획 3 · 단계 [0-9]+", chip_text.strip())),
        "J9-6",
        "3D 칩은 상악·치아 수·계획·단계 값만 표시해야 한다",
        chip_text,
    )
    checks.check(
        "에서 본 모습" not in chip_text and "교합면" not in chip_text,
        "J9-6",
        "3D 칩에 시점 안내 문구가 없어야 한다",
        chip_text,
    )
    visible_empty_chips = await page.locator(
        ".workspace-viewer-container .viewer-overlay-chips-bar:visible"
    ).count()
    checks.check(visible_empty_chips == 0, "J9-6", "3D 칩 옆 빈 네모 요소가 없어야 한다", visible_empty_chips)

    await viewing_card.scroll_into_view_if_needed()
    bounds = await page.evaluate(
        """() => {
            const card = document.querySelector('.plan-card-viewing');
            const panel = document.querySelector('.workspace-plans-container');
            if (!card || !panel) return null;
            const c = card.getBoundingClientRect();
            const p = panel.getBoundingClientRect();
            return {
                cardLeft: c.left, cardRight: c.right, cardTop: c.top, cardBottom: c.bottom,
                panelLeft: p.left, panelRight: p.right, panelTop: p.top, panelBottom: p.bottom,
                panelScrollWidth: panel.scrollWidth, panelClientWidth: panel.clientWidth
            };
        }"""
    )
    unclipped = bool(
        bounds
        and bounds["cardLeft"] >= bounds["panelLeft"] - 1
        and bounds["cardRight"] <= bounds["panelRight"] + 1
        and bounds["cardTop"] >= bounds["panelTop"] - 1
        and bounds["cardBottom"] <= bounds["panelBottom"] + 1
        and bounds["panelScrollWidth"] <= bounds["panelClientWidth"]
    )
    checks.check(unclipped, "J9-4", "보는 계획 카드와 승인 영역이 380px 열 안에서 잘리지 않아야 한다", bounds)

    # The real middleware validates ChatContext; the final route is a fake SSE
    # handler, so this checks the null-constraints regression without NIM.
    textarea = page.locator(".agent-textarea")
    await textarea.fill("현재 조건을 유지해 주세요")
    async with page.expect_response(lambda r: r.url.endswith("/chat/stream"), timeout=10_000) as response_info:
        await page.locator(".btn-send").click()
    chat_response = await response_info.value
    checks.check(
        chat_response.status != 400,
        "J9-12",
        "채팅 전송은 ChatContext constraints 검증에서 400이 아니어야 한다",
        chat_response.status,
    )
    await page.wait_for_timeout(250)

    telemetry.assert_clean(checks, mark, "workspace-000131")
    screenshots.append(await screenshot(page, "03_workspace_000131_1920x1080.png"))


async def approve_and_download(
    page: Page,
    checks: AcceptanceChecks,
    telemetry: BrowserTelemetry,
    temp_out: Path,
) -> dict:
    telemetry.screen = "approval-and-download"
    mark = telemetry.mark()
    viewing_card = page.locator(".plan-card-viewing")
    pre_link = viewing_card.locator(".plan-download-btn, a[href*='stl.zip']")
    pre_disabled = (
        await pre_link.count() == 1
        and await pre_link.get_attribute("href") is None
        and await pre_link.get_attribute("aria-disabled") == "true"
    )
    checks.check(
        pre_disabled,
        "J9 download",
        "승인 전 STL 링크가 보이되 href 없이 비활성이어야 한다",
    )

    approve_button = viewing_card.locator(".plan-approve-btn")
    await approve_button.wait_for(state="visible", timeout=10_000)
    await approve_button.click()
    confirm = viewing_card.locator(".plan-approve-confirm-step")
    await confirm.wait_for(state="visible", timeout=5_000)
    await viewing_card.locator(".plan-confirm-execute-btn").click()
    await viewing_card.locator(".plan-approved-meta").wait_for(state="visible", timeout=10_000)
    locked_after_approval = await page.locator("#rail .rail-step-locked").all_inner_texts()
    checks.check(
        not any("승인" in text or "내보내기" in text for text in locked_after_approval),
        "J9 approval",
        "승인 뒤 레일의 승인·내보내기 단계는 잠기지 않아야 한다",
        locked_after_approval,
    )

    download_link = viewing_card.locator(".plan-download-btn")
    async with page.expect_download(timeout=20_000) as download_info:
        await download_link.click()
    download = await download_info.value
    target = temp_out / download.suggested_filename
    await download.save_as(target)
    with zipfile.ZipFile(target) as archive:
        stl_members = [name for name in archive.namelist() if name.lower().endswith(".stl")]
    checks.check(bool(stl_members), "J9 download", "승인한 ZIP에는 STL이 1개 이상 있어야 한다", stl_members)
    telemetry.assert_clean(checks, mark, "approval-and-download")
    return {"zip": download.suggested_filename, "stl_count": len(stl_members)}


async def assert_patient_and_upload(
    page: Page,
    base_url: str,
    checks: AcceptanceChecks,
    telemetry: BrowserTelemetry,
    temp_out: Path,
    screenshots: list[str],
) -> None:
    telemetry.screen = "patients-new"
    mark = telemetry.mark()
    await open_route(page, base_url, "#/patients/new", ".intake-patient-form")
    body_text = await page.locator(".screen-intake").inner_text()
    checks.check(
        "등록된 환자가 없습니다" in body_text,
        "J9-8",
        "빈 환자 상태는 등록된 환자가 없다는 한 줄을 표시해야 한다",
        body_text,
    )
    forbidden_guidance = (
        "환자를 선택하거나 새로 등록하세요",
        "왼쪽 목록에서 환자를 선택하면",
    )
    checks.check(
        not any(text in body_text for text in forbidden_guidance),
        "J9-8",
        "환자 빈 화면에 삭제 대상 안내 문구가 없어야 한다",
        body_text,
    )
    telemetry.assert_clean(checks, mark, "J9-7 patients-new")

    alias = page.locator('.intake-patient-form input[name="alias"]')
    await alias.fill("테스트환자01")
    await page.locator('.intake-patient-form button[type="submit"]').click()
    await page.wait_for_selector(".upload-container", timeout=10_000)
    telemetry.assert_clean(checks, mark, "patient-create")
    screenshots.append(await screenshot(page, "04_patient_intake_1920x1080.png"))

    telemetry.screen = "intentional-lower-arch-error"
    lower_mark = telemetry.mark()
    mixed_dir = temp_out / "upload_mixed_lower"
    mixed_dir.mkdir(parents=True, exist_ok=True)
    mixed_files = []
    for tooth in range(2, 16):
        target = mixed_dir / f"{tooth}.stl"
        shutil.copyfile(SAMPLE_DIR / f"{tooth}.stl", target)
        mixed_files.append(str(target))
    lower_file = mixed_dir / "18.stl"
    shutil.copyfile(SAMPLE_DIR / "2.stl", lower_file)
    mixed_files.append(str(lower_file))

    file_input = page.locator('input[type="file"].upload-file-input')
    await file_input.set_input_files(mixed_files)
    error_card = page.locator(".upload-error-card")
    await error_card.wait_for(state="visible", timeout=8_000)
    error_text = await error_card.inner_text()
    checks.check(
        LOWER_ARCH_ERROR in error_text,
        "J9 upload",
        "하악 파일 오류 상자는 서버 문구를 그대로 표시해야 한다",
        error_text,
    )
    telemetry.assert_clean(
        checks,
        lower_mark,
        "intentional-lower-arch-error",
        allow_4xx=True,
    )
    screenshots.append(await screenshot(page, "05_lower_arch_error_1920x1080.png"))

    telemetry.screen = "valid-upload"
    mark = telemetry.mark()
    valid_files = [str(SAMPLE_DIR / f"{tooth}.stl") for tooth in range(2, 16)]
    await file_input.set_input_files(valid_files)
    summary = page.locator(".upload-summary-card")
    await summary.wait_for(state="visible", timeout=8_000)
    summary_text = await summary.inner_text()
    checks.check(
        "검사 통과" in summary_text and "14개" in summary_text,
        "J9 upload",
        "정상 파일 선택 요약은 검사 통과와 치아 14개를 표시해야 한다",
        summary_text,
    )
    await page.locator(".upload-submit-btn").click()
    await page.wait_for_selector(".screen-check", timeout=20_000)
    await page.wait_for_selector(".check-dl", timeout=15_000)
    check_text = await page.locator(".check-panel").inner_text()
    checks.check("14개" in check_text, "J9 upload", "입력 확인 화면은 치아 14개를 표시해야 한다", check_text)
    telemetry.assert_clean(checks, mark, "valid-upload-and-check")
    screenshots.append(await screenshot(page, "06_scan_check_1920x1080.png"))


async def assert_responsive_contracts(
    page: Page,
    base_url: str,
    checks: AcceptanceChecks,
    telemetry: BrowserTelemetry,
    screenshots: list[str],
) -> None:
    for width, height in VIEWPORTS:
        telemetry.screen = f"responsive-{width}x{height}"
        mark = telemetry.mark()
        await page.set_viewport_size({"width": width, "height": height})
        await open_route(
            page,
            base_url,
            f"#/workspace/{SAMPLE_CASE_000131}",
            ".screen-workspace-layout",
        )
        metrics = await document_metrics(page)
        if width in (1920, 1440, 1280):
            checks.check(
                metrics["scrollHeight"] == metrics["innerHeight"],
                "C5 responsive",
                f"{width}×{height} 문서 높이는 viewport와 같아야 한다",
                metrics,
            )
        elif width == 1024:
            drawer_selectors = (
                ".workspace-left-drawer-toggle, "
                ".workspace-workbench-drawer-toggle, "
                "button[data-drawer='workspace-left'], "
                "button[aria-controls='workspace-left-drawer']"
            )
            visible_drawers = await page.locator(drawer_selectors).count()
            checks.check(
                visible_drawers > 0,
                "C5 responsive",
                "1024×768 작업대에는 왼쪽 계획·대화 서랍 버튼이 있어야 한다",
                visible_drawers,
            )
        elif width == 390:
            checks.check(
                metrics["scrollWidth"] <= metrics["innerWidth"]
                and metrics["bodyScrollWidth"] <= metrics["innerWidth"],
                "C5 responsive",
                "390×844에서 가로 넘침이 없어야 한다",
                metrics,
            )
        telemetry.assert_clean(checks, mark, f"responsive-{width}x{height}")
        screenshots.append(await screenshot(page, f"responsive_{width}x{height}.png"))


async def assert_webgl_disabled_workspace(
    playwright,
    base_url: str,
    checks: AcceptanceChecks,
    screenshots: list[str],
) -> None:
    browser = await playwright.chromium.launch(
        executable_path=get_chromium_executable(),
        headless=True,
        args=["--disable-3d-apis"],
    )
    try:
        page = await browser.new_page(viewport={"width": 1920, "height": 1080})
        telemetry = BrowserTelemetry(page)

        telemetry.screen = "webgl-disabled-case-detail"
        mark = telemetry.mark()
        await open_route(
            page,
            base_url,
            f"#/cases/{SAMPLE_CASE_000001}",
            ".cases-detail-tags",
        )
        condition_tags = await page.locator(".cases-detail-tags").inner_text()
        checks.check(
            "IPR 제외 17, 16, 26, 27" in condition_tags,
            "F1 constraints",
            "서버 Universal 조건 칩은 FDI 치아 번호로 보여야 한다",
            condition_tags,
        )
        checks.check(
            "IPR 제외 2, 3, 14, 15" not in condition_tags,
            "F1 constraints",
            "조건 칩에 Universal 치아 번호가 노출되지 않아야 한다",
            condition_tags,
        )
        telemetry.assert_clean(checks, mark, "webgl-disabled-case-detail")

        telemetry.screen = "webgl-disabled-workspace"
        mark = telemetry.mark()
        await open_route(
            page,
            base_url,
            f"#/workspace/{SAMPLE_CASE_000001}",
            ".viewer-unavailable",
        )
        await page.locator(".plan-card").first.wait_for(state="visible", timeout=10_000)
        fallback_text = await page.locator(".viewer-unavailable").inner_text()
        checks.check(
            "3D를 표시할 수 없습니다" in fallback_text
            and "WebGL을 쓸 수 없습니다" in fallback_text,
            "F1 WebGL",
            "3D 영역 안에 WebGL 비활성 안내가 보여야 한다",
            fallback_text,
        )
        checks.check(
            await page.locator(".plan-card").count() > 0,
            "F1 WebGL",
            "WebGL 없이도 계획 카드가 보여야 한다",
        )
        checks.check(
            await page.locator(".plan-start-error").count() == 0,
            "F1 WebGL",
            "WebGL 실패를 계획 생성 실패로 표시하지 않아야 한다",
        )
        checks.check(
            await page.locator(".screen-workspace-layout .stage-bar").count() == 1,
            "F1 WebGL",
            "WebGL 없이도 단계 막대가 유지되어야 한다",
        )

        slider = page.locator(".stage-slider")
        slider_max = int(await slider.get_attribute("max") or "0")
        if slider_max > 0:
            target_stage = min(2, slider_max)
            await slider.fill(str(target_stage))
            await page.wait_for_timeout(100)
            current_badge = await page.locator(".staging-row.is-current .staging-row-label").inner_text()
            checks.check(
                current_badge.strip() == str(target_stage),
                "F1 WebGL",
                "3D 폴백 단계 막대는 오른쪽 단계 표와 연동되어야 한다",
                current_badge,
            )
        telemetry.assert_clean(checks, mark, "webgl-disabled-workspace")
        screenshots.append(await screenshot(page, "07_webgl_disabled_workspace.png"))
    finally:
        await browser.close()


async def run_flow() -> dict:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    checks = AcceptanceChecks()
    screenshots: list[str] = []
    results: dict = {"status": "running", "assertions": checks.assertions, "screenshots": screenshots}

    with tempfile.TemporaryDirectory() as tmpdir:
        temp_out = Path(tmpdir)
        store_module.OUT_DIR = api.OUT_DIR = temp_out
        os.environ["CUALIGN_OUT"] = str(temp_out)
        app = make_app()

        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(app, log_level="error"))
        thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
        thread.start()

        browser = None
        try:
            for _ in range(200):
                if server.started:
                    break
                await asyncio.sleep(0.05)
            else:
                raise RuntimeError("Uvicorn test server failed to start within 10 seconds")

            base_url = f"http://127.0.0.1:{port}"
            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(
                    executable_path=get_chromium_executable(),
                    headless=True,
                    args=["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
                )
                page = await browser.new_page(viewport={"width": 1920, "height": 1080})
                page.on("dialog", lambda dialog: dialog.accept())
                telemetry = BrowserTelemetry(page)

                await assert_cases_and_detail(page, base_url, checks, telemetry, screenshots)
                await assert_workspace_contracts(page, base_url, checks, telemetry, screenshots)
                download_result = await approve_and_download(page, checks, telemetry, temp_out)
                results["download"] = download_result
                await assert_patient_and_upload(
                    page,
                    base_url,
                    checks,
                    telemetry,
                    temp_out,
                    screenshots,
                )
                await assert_responsive_contracts(page, base_url, checks, telemetry, screenshots)
                await assert_webgl_disabled_workspace(
                    playwright,
                    base_url,
                    checks,
                    screenshots,
                )

                results["page_errors"] = telemetry.page_errors
                results["http_4xx"] = telemetry.http_4xx
                checks.raise_if_failed()
                results["status"] = "passed"
                await browser.close()
                browser = None
        except Exception as exc:
            results["status"] = "failed"
            results["error"] = str(exc)
            raise
        finally:
            if browser is not None:
                await browser.close()
            server.should_exit = True
            thread.join(timeout=5)
            sock.close()
            (OUT_DIR / "result.json").write_text(
                json.dumps(results, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

    return results


def main() -> None:
    try:
        asyncio.run(run_flow())
    except Exception as exc:
        print(f"RESULT: FAILED - {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    print("RESULT: ALL UI V2 VALUE AND RESPONSIVE CONTRACTS PASSED")


if __name__ == "__main__":
    main()
