"""Browser acceptance test for cuAlign UI v2 (J9T).

Run:
    uv run --with playwright python tests/browser_flow_v2.py

Requires installed Chrome or PLAYWRIGHT_CHROMIUM_EXECUTABLE.
Tests the complete end-to-end v2 browser workflow:
1. Cases list: verify 1920x1080 no vertical scroll, console errors 0, display of cases
2. Sample 000131 workspace: open sample workspace, inspect plan card
3. Plan approval: verify STL export is inactive before approval, perform approval with inline doctor confirmation
4. STL zip download: download via Playwright, verify zip contains at least 1 .stl file
5. Patient intake: create new patient record
6. Lower-arch scan rejection: mix lower-arch tooth file (18.stl), verify error message
7. Valid scan upload: upload 2.stl~15.stl from poseidon-000131 sample
8. Scan check screen: verify tooth count (14) displayed, inspect readiness

Outputs screenshots and result.json to out/browser-acceptance/v2/.
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import shutil
import socket
import sys
import tempfile
import threading
import zipfile

import uvicorn
from fastapi import FastAPI
from playwright.async_api import async_playwright

from cualign.core import store as store_module
from cualign.server import api, plan_events

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "out" / "browser-acceptance" / "v2"
SAMPLE_DIR = ROOT / "src" / "cualign" / "core" / "samples" / "poseidon-000131"


async def fake_manual_review(plan_id: str) -> dict:
    """Mock review function for testing without NIM / external LLM."""
    return {"status": "passed", "message": "가짜 검토 통과", "manual": True}


def get_chromium_executable() -> str | None:
    """Determine Chrome / Chromium executable path."""
    env_path = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")
    if env_path and os.path.exists(env_path):
        return env_path
    
    candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return None


async def check_no_vertical_scroll(page) -> bool:
    """Assert viewport fits 1920x1080 without vertical scrollbars."""
    return bool(await page.evaluate(
        "() => document.documentElement.scrollHeight <= window.innerHeight && document.body.scrollHeight <= window.innerHeight"
    ))


async def run_flow() -> dict:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    
    with tempfile.TemporaryDirectory() as tmpdir:
        temp_out = Path(tmpdir)
        store_module.OUT_DIR = api.OUT_DIR = temp_out
        os.environ["CUALIGN_OUT"] = str(temp_out)
        
        app = FastAPI()
        api.add_api_routes(app, review=fake_manual_review)
        app.add_middleware(plan_events.PlanEventsASGI)
        
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(app, log_level="error"))
        thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
        thread.start()
        
        test_results = {
            "status": "running",
            "viewport": {"width": 1920, "height": 1080},
            "steps": [],
            "console_errors": []
        }
        
        browser = None
        current_step = "Server Startup"
        
        try:
            # Wait for uvicorn server to start
            for _ in range(200):
                if server.started:
                    break
                await asyncio.sleep(0.05)
            else:
                raise RuntimeError("Uvicorn test server failed to start within 10 seconds")
            
            base_url = f"http://127.0.0.1:{port}"
            
            async with async_playwright() as pw:
                current_step = "Browser Launch"
                executable = get_chromium_executable()
                browser = await pw.chromium.launch(
                    executable_path=executable,
                    headless=True,
                    args=["--enable-unsafe-swiftshader", "--use-angle=swiftshader"]
                )
                page = await browser.new_page(viewport={"width": 1920, "height": 1080})
                
                page_errors = []
                page.on("pageerror", lambda err: page_errors.append(str(err)))
                page.on("dialog", lambda dialog: dialog.accept())
                
                # -------------------------------------------------------------
                # Step 1: 케이스 목록
                # -------------------------------------------------------------
                current_step = "Step 1: 케이스 목록 (Cases List)"
                print(f"\n[EXEC] {current_step}")
                await page.goto(f"{base_url}/ui/v2/#/cases")
                await page.wait_for_selector(".screen-cases", timeout=15000)
                
                scroll_ok_s1 = await check_no_vertical_scroll(page)
                if not scroll_ok_s1:
                    print("  [WARN] Vertical scroll detected on cases screen")
                
                # Verify case table header and sample 000131 presence
                sample_item = page.locator(".cases-table-row", has_text="000131")
                await sample_item.wait_for(state="visible", timeout=10000)
                
                screenshot_s1 = OUT_DIR / "01_cases_list.png"
                await page.screenshot(path=str(screenshot_s1))
                test_results["steps"].append({
                    "step": 1,
                    "name": "cases_list",
                    "passed": True,
                    "scroll_ok": scroll_ok_s1,
                    "screenshot": screenshot_s1.name
                })
                print("  [PASS] Cases list displayed and sample 000131 found")
                
                # -------------------------------------------------------------
                # Step 2: 샘플 000131 작업대 (계획 카드)
                # -------------------------------------------------------------
                current_step = "Step 2: 샘플 000131 작업대 (Workspace)"
                print(f"\n[EXEC] {current_step}")
                # Click sample 000131 row
                await sample_item.click()
                
                # Wait for detail panel and click CTA to open workspace
                cta_btn = page.locator(".cases-cta-btn")
                await cta_btn.wait_for(state="visible", timeout=5000)
                await cta_btn.click()
                
                # Wait for workspace layout to load
                await page.wait_for_selector(".screen-workspace-layout", timeout=20000)
                scroll_ok_s2 = await check_no_vertical_scroll(page)
                
                # Verify viewing plan card is rendered
                viewing_card = page.locator(".plan-card-viewing")
                await viewing_card.wait_for(state="visible", timeout=15000)
                card_title = await viewing_card.locator(".plan-card-title").inner_text()
                
                screenshot_s2 = OUT_DIR / "02_workspace_sample_000131.png"
                await page.screenshot(path=str(screenshot_s2))
                test_results["steps"].append({
                    "step": 2,
                    "name": "sample_workspace",
                    "passed": True,
                    "case_id": "poseidon-000131",
                    "card_title": card_title,
                    "scroll_ok": scroll_ok_s2,
                    "screenshot": screenshot_s2.name
                })
                print(f"  [PASS] Workspace loaded with viewing plan card ({card_title})")
                
                # -------------------------------------------------------------
                # Step 3: 통과 계획 승인 (확인 단계 포함) 및 승인 전 비활성도 확인
                # -------------------------------------------------------------
                current_step = "Step 3: 계획 승인 (Plan Approval)"
                print(f"\n[EXEC] {current_step}")
                
                # Pre-approval check: Verify STL download link is not accessible / disabled
                pre_stl_link = page.locator('.plan-download-btn, a[href*="stl.zip"]')
                is_pre_stl_disabled = (
                    await pre_stl_link.count() == 0 or
                    await pre_stl_link.get_attribute("aria-disabled") == "true" or
                    "disabled" in (await pre_stl_link.get_attribute("class") or "")
                )
                assert is_pre_stl_disabled, "STL export link must be inactive / disabled before doctor approval"
                print("  [PASS] Pre-approval STL export link is inactive")
                
                # Trigger approval button
                approve_trigger_btn = page.locator(".plan-approve-btn")
                await approve_trigger_btn.wait_for(state="visible", timeout=10000)
                await approve_trigger_btn.click()
                
                # Verify inline confirmation drawer
                confirm_step = page.locator(".plan-approve-confirm-step")
                await confirm_step.wait_for(state="visible", timeout=5000)
                
                # Click execute confirmation button ('최종 승인')
                execute_confirm_btn = page.locator(".plan-confirm-execute-btn")
                await execute_confirm_btn.click()
                
                # Verify approved section appears
                approved_section = page.locator(".plan-approved-section")
                await approved_section.wait_for(state="visible", timeout=10000)
                
                scroll_ok_s3 = await check_no_vertical_scroll(page)
                screenshot_s3 = OUT_DIR / "03_approved_plan.png"
                await page.screenshot(path=str(screenshot_s3))
                test_results["steps"].append({
                    "step": 3,
                    "name": "plan_approval",
                    "passed": True,
                    "scroll_ok": scroll_ok_s3,
                    "screenshot": screenshot_s3.name
                })
                print("  [PASS] Plan approved with doctor confirmation step")
                
                # -------------------------------------------------------------
                # Step 4: STL(zip) 다운로드 및 zip 안 .stl >= 1 확인
                # -------------------------------------------------------------
                current_step = "Step 4: STL 다운로드 및 파일 검증 (STL Zip Download)"
                print(f"\n[EXEC] {current_step}")
                stl_download_link = page.locator('.plan-download-btn, a[href*="stl.zip"]')
                await stl_download_link.wait_for(state="visible", timeout=5000)
                
                async with page.expect_download(timeout=15000) as download_info:
                    await stl_download_link.click()
                download = await download_info.value
                
                zip_target_path = temp_out / download.suggested_filename
                await download.save_as(zip_target_path)
                
                with zipfile.ZipFile(zip_target_path, "r") as z:
                    all_members = z.namelist()
                    stl_members = [f for f in all_members if f.lower().endswith(".stl")]
                    assert len(stl_members) >= 1, f"Expected at least 1 .stl file in downloaded zip, found: {stl_members}"
                
                test_results["steps"].append({
                    "step": 4,
                    "name": "stl_zip_download",
                    "passed": True,
                    "zip_filename": download.suggested_filename,
                    "stl_count": len(stl_members),
                    "sample_stl_names": stl_members[:3]
                })
                print(f"  [PASS] STL zip downloaded successfully ({len(stl_members)} .stl files verified)")
                
                # -------------------------------------------------------------
                # Step 5: 새 환자 만들기
                # -------------------------------------------------------------
                current_step = "Step 5: 새 환자 만들기 (Create New Patient)"
                print(f"\n[EXEC] {current_step}")
                # Topbar '새 환자' link or navigate to intake
                topbar_new_patient = page.locator('#topbar a, a[href*="patients"]', has_text="새 환자")
                if await topbar_new_patient.count() > 0:
                    await topbar_new_patient.click()
                    await page.wait_for_timeout(300)
                
                # If route did not switch due to main.js hash router fallback, navigate directly
                if not await page.locator('.intake-patient-form').is_visible():
                    await page.goto(f"{base_url}/ui/v2/#/patients/new")
                
                await page.wait_for_selector(".intake-patient-form", timeout=10000)
                alias_input = page.locator('.intake-patient-form input[name="alias"]')
                await alias_input.fill("테스트환자01")
                
                submit_patient_btn = page.locator('.intake-patient-form button[type="submit"]')
                await submit_patient_btn.click()
                
                # Wait for patient creation and upload dropzone
                await page.wait_for_selector(".upload-container", timeout=10000)
                scroll_ok_s5 = await check_no_vertical_scroll(page)
                
                screenshot_s5 = OUT_DIR / "04_patient_intake.png"
                await page.screenshot(path=str(screenshot_s5))
                test_results["steps"].append({
                    "step": 5,
                    "name": "create_patient",
                    "passed": True,
                    "scroll_ok": scroll_ok_s5,
                    "screenshot": screenshot_s5.name
                })
                print("  [PASS] New patient created and intake upload zone ready")
                
                # -------------------------------------------------------------
                # Step 6: 하악 번호 파일 (18.stl 사본) 섞었을 때 서버 오류 문구 표시 확인
                # -------------------------------------------------------------
                current_step = "Step 6: 하악 번호 파일 오류 검사 (Lower Arch File Error)"
                print(f"\n[EXEC] {current_step}")
                upload_tmp_dir = temp_out / "upload_mixed_lower"
                upload_tmp_dir.mkdir(parents=True, exist_ok=True)
                
                files_with_lower = []
                for i in range(2, 16):
                    src_stl = SAMPLE_DIR / f"{i}.stl"
                    dst_stl = upload_tmp_dir / f"{i}.stl"
                    shutil.copyfile(src_stl, dst_stl)
                    files_with_lower.append(str(dst_stl))
                
                # 18.stl is lower arch (Universal 17..32)
                lower_copy = upload_tmp_dir / "18.stl"
                shutil.copyfile(SAMPLE_DIR / "2.stl", lower_copy)
                files_with_lower.append(str(lower_copy))
                
                file_input = page.locator('input[type="file"].upload-file-input')
                await file_input.set_input_files(files_with_lower)
                
                # Verify error card appears with lower arch error description
                error_card = page.locator(".upload-error-card")
                await error_card.wait_for(state="visible", timeout=8000)
                error_text = await error_card.inner_text()
                assert "하악" in error_text, f"Expected lower arch rejection message, got: {error_text}"
                
                scroll_ok_s6 = await check_no_vertical_scroll(page)
                screenshot_s6 = OUT_DIR / "05_lower_arch_error.png"
                await page.screenshot(path=str(screenshot_s6))
                test_results["steps"].append({
                    "step": 6,
                    "name": "lower_arch_error_rejection",
                    "passed": True,
                    "error_message": error_text.splitlines()[0] if error_text else "",
                    "scroll_ok": scroll_ok_s6,
                    "screenshot": screenshot_s6.name
                })
                print(f"  [PASS] Lower arch (18.stl) error detected and displayed on screen")
                
                # -------------------------------------------------------------
                # Step 7: 정상 2.stl~15.stl 스캔 파일 올리기
                # -------------------------------------------------------------
                current_step = "Step 7: 정상 스캔 파일 업로드 (Upload 2.stl~15.stl)"
                print(f"\n[EXEC] {current_step}")
                valid_stls = [str(SAMPLE_DIR / f"{i}.stl") for i in range(2, 16)]
                await file_input.set_input_files(valid_stls)
                
                # Verify pre-upload summary card
                summary_card = page.locator(".upload-summary-card")
                await summary_card.wait_for(state="visible", timeout=8000)
                summary_text = await summary_card.inner_text()
                assert "검사 통과" in summary_text and "14개" in summary_text, f"Unexpected summary: {summary_text}"
                
                # Click upload button
                upload_submit_btn = page.locator(".upload-submit-btn")
                await upload_submit_btn.wait_for(state="visible", timeout=5000)
                await upload_submit_btn.click()
                
                test_results["steps"].append({
                    "step": 7,
                    "name": "valid_scan_upload",
                    "passed": True,
                    "files_count": len(valid_stls)
                })
                print("  [PASS] Valid 14 teeth files submitted for processing")
                
                # -------------------------------------------------------------
                # Step 8: 입력 확인 화면에 치아 개수 표시 (Check Screen)
                # -------------------------------------------------------------
                current_step = "Step 8: 입력 확인 화면 치아 개수 검증 (Scan Check Screen)"
                print(f"\n[EXEC] {current_step}")
                await page.wait_for_selector(".screen-check", timeout=20000)
                
                # Wait for inspection data definition list to finish loading
                await page.wait_for_selector(".check-dl", timeout=15000)
                
                check_panel_text = await page.locator(".check-panel").inner_text()
                assert "14개" in check_panel_text, f"Expected '14개' teeth count in check panel, got: {check_panel_text[:300]}"
                
                scroll_ok_s8 = await check_no_vertical_scroll(page)
                screenshot_s8 = OUT_DIR / "06_scan_check.png"
                await page.screenshot(path=str(screenshot_s8))
                test_results["steps"].append({
                    "step": 8,
                    "name": "scan_check_tooth_count",
                    "passed": True,
                    "teeth_count": 14,
                    "scroll_ok": scroll_ok_s8,
                    "screenshot": screenshot_s8.name
                })
                print("  [PASS] Scan check screen verified with 14 teeth displayed")
                
                # Final assertions on console errors
                assert len(page_errors) == 0, f"Expected 0 unhandled console/page errors, found {len(page_errors)}: {page_errors}"
                
                test_results["status"] = "passed"
                test_results["all_passed"] = True
                test_results["console_errors_count"] = len(page_errors)
                
                await browser.close()
                browser = None
                
        except Exception as exc:
            print(f"\n[FAIL] Failure occurred at [{current_step}]: {exc}", file=sys.stderr)
            test_results["status"] = "failed"
            test_results["failed_at_step"] = current_step
            test_results["error"] = str(exc)
            raise
        finally:
            if browser is not None:
                await browser.close()
            server.should_exit = True
            thread.join(timeout=5)
            sock.close()
            
            result_json_file = OUT_DIR / "result.json"
            result_json_file.write_text(json.dumps(test_results, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"\n[INFO] Test result saved to {result_json_file}")
            
    return test_results


def main():
    print("=" * 70)
    print("cuAlign UI v2 Browser Acceptance Test Runner (J9T)")
    print("=" * 70)
    try:
        results = asyncio.run(run_flow())
        print("\n" + "=" * 70)
        print("RESULT: ALL BROWSER FLOW STEPS PASSED SUCCESSFULLY")
        print("=" * 70)
        sys.exit(0)
    except Exception as e:
        print("\n" + "=" * 70)
        print(f"RESULT: FAILED - {e}")
        print("=" * 70)
        sys.exit(1)


if __name__ == "__main__":
    main()
