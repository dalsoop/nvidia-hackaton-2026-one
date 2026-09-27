"""#107: ten dentist sentences outside the demo script -> the follow-up card the live model writes for each.

Builds the workflow from configs/workflow.yml (so the card comes from the same `nim_lightning` model and instructions
the server uses) and calls agent/followup.next_question the way POST /api/followup does. Each sentence is put after a
canned plan answer, as on the screen after an agent turn. Never prints the API key.
Writes out/nim-live/followup-10.md (the table for the issue) and followup-10.json (raw cards for test_followup.OFF_SCRIPT).

Costs real NVIDIA usage: ten small model calls. Run: uv run --frozen python tests/nim_followup_live_check.py
"""
import asyncio
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out" / "nim-live"
sys.path.insert(0, str(ROOT / "tests"))

PLAN_ANSWER = ("**확장 + IPR 전략으로 14단계(약 3.2개월) 계획을 만들었습니다.** 규칙 위반은 없습니다.\n"
               "- 조건: 발치 치아 없음 · 고정 치아 없음 · IPR 제외 치아 없음 · IPR 한도 면당 0.25mm · 단계 상한 없음 · 이동 순서 동시\n"
               "- 검토: 통과, 단계당 이동량 0.24mm · 공간 부족 0mm · 양측 확장 1.1mm · IPR 면당 0.2mm\n"
               "- 의사 확인 필요: 앞니 IPR 범위\n이 계획은 초안입니다. 최종 판단은 의사가 합니다.")
REPLY = "요청하신 조건으로 다시 계획하겠습니다. 어떤 점을 우선할지 알려 주세요."


async def main():
    load_dotenv(ROOT / ".env")
    if not os.environ.get("NVIDIA_API_KEY", "").startswith("nvapi-"):
        raise SystemExit("NVIDIA_API_KEY is not set (put it in apps/cualign-prototype/.env)")
    OUT.mkdir(parents=True, exist_ok=True)
    from nat.builder.workflow_builder import WorkflowBuilder
    from nat.runtime.loader import load_config
    from nat.builder.framework_enum import LLMFrameworkEnum
    from cualign.agent import followup
    from cualign.agent.reviewer import response_text
    from test_followup import OFF_SCRIPT

    rows, raw = [], {}
    async with WorkflowBuilder.from_config(load_config(ROOT / "configs" / "workflow.yml")) as builder:
        llm = await builder.get_llm("nim_lightning", wrapper_type=LLMFrameworkEnum.LANGCHAIN)
        for i, (sentence, _) in enumerate(OFF_SCRIPT, 1):
            messages = [{"role": "user", "content": "처방대로 계획해줘."}, {"role": "assistant", "content": PLAN_ANSWER},
                        {"role": "user", "content": sentence}, {"role": "assistant", "content": REPLY}]
            # the same chat next_question builds, but keeping the model's raw text to see what it wrote before parse filters
            chat = [{"role": "system", "content": followup.INSTRUCTIONS},
                    {"role": "user", "content": "Conversation:\n" + json.dumps(followup.tail(messages), ensure_ascii=False) + "\n\nJSON:"}]
            text = response_text(await asyncio.wait_for(llm.ainvoke(chat), timeout=30))
            raw[sentence] = {"raw": text, "card": followup.parse(text)}
            card = raw[sentence]["card"]
            leak = [w for w in ("승인", "내보내", "보류", "다운로드", "STL", "검토 다시") if w in text]
            opts = " / ".join(f"{o['label']} → {o['message']}" for o in card["options"]) if card else "(카드 없음)"
            rows.append(f"| {i} | {sentence} | {card['question'] if card else '-'} | {opts} | "
                        f"{'⚠ ' + ', '.join(leak) if leak else 'ok'} |")
            print(f"[{i}/10] {sentence} -> {card['question'] if card else None}")
    (OUT / "followup-10.json").write_text(json.dumps(raw, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / "followup-10.md").write_text("| # | 문장 | 질문 | 선택지 | 화면 동작 누출 |\n|---|---|---|---|---|\n"
                                        + "\n".join(rows) + "\n", encoding="utf-8")
    print(f"-> {OUT / 'followup-10.md'}")


if __name__ == "__main__":
    asyncio.run(main())
