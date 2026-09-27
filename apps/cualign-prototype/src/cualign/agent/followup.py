"""The next question for the dentist after each agent turn (#90).

The screen shows the agent's answer and then one question card with two or three choices (the way a design agent
asks before it draws). A small, fast model writes it from the last turns of the conversation; the planner's prompt
and the rails are untouched. Any failure means no card, never an error on screen.
"""
from __future__ import annotations

import asyncio
import json
import re

from .reviewer import response_text

INSTRUCTIONS = (
    "You are cuAlign's follow-up writer for a dentist planning clear-aligner staging in Korean. Given the conversation "
    "so far (the assistant's last answer is the latest plan draft), write the ONE question the dentist most likely has "
    "to decide next, with 2 or 3 concrete choices. Each choice is a short label (at most 12 Korean characters) and the "
    "full message the dentist would send to the assistant to take that choice (one sentence, Korean, imperative). "
    "Good questions decide a condition: extraction, a time cap in months, teeth to lock, IPR exclusions, comparing "
    "strategies, or a revision. Never offer approval, export, download, hold (보류) or re-review as a choice: the screen "
    "does those with buttons, and every choice must be a planning request the assistant can carry out in the next turn "
    "(a condition change, a comparison, a revision). If the dentist's last message is off topic (not about this plan), "
    "still ask about the plan just made. Ask about the plan just made (its strategy, months, violations), not in "
    "general. Tooth numbers in FDI (11..28), never the app's 1..16. Never diagnose, never prescribe, never mention plan "
    "ids, tool or field names. "
    'Answer with JSON only: {"question": "...", "options": [{"label": "...", "message": "..."}, ...]}'
)

MAX_TURNS = 6           # the model sees only the tail of the conversation
MAX_CHARS = 1500        # per message
MAX_OPTIONS = 3
# What the screen does with buttons, never a chip (#107): approving, exporting, holding, downloading, re-reviewing.
SCREEN_ACTION_RE = re.compile(r"승인|내보내|export|보류|다운로드|STL|ZIP|검토 다시|재검토|approve", re.I)


def parse(text: str) -> dict | None:
    """The JSON object in the model's text, trimmed to what the card shows; None when it is not a usable question."""
    m = re.search(r"\{[\s\S]*\}", text or "")
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    question = str(data.get("question") or "").strip()
    options = []
    for o in data.get("options") or []:
        if not isinstance(o, dict):
            continue
        label, message = str(o.get("label") or "").strip(), str(o.get("message") or "").strip()
        if label and message and not SCREEN_ACTION_RE.search(label + " " + message):
            options.append({"label": label[:24], "message": message[:200]})
    if not question or len(options) < 2:
        return None
    return {"question": question[:120], "options": options[:MAX_OPTIONS]}


def tail(messages: list[dict]) -> list[dict]:
    """The last turns with user/assistant roles only, each cut to MAX_CHARS."""
    kept = [{"role": m["role"], "content": str(m.get("content") or "")[:MAX_CHARS]}
            for m in messages if m.get("role") in ("user", "assistant")]
    return kept[-MAX_TURNS:]


async def next_question(llm, messages: list[dict], *, timeout_seconds: float = 12) -> dict | None:
    """One question card for the conversation, or None (no answer, bad JSON, timeout, upstream error)."""
    turns = tail(messages)
    if not turns:
        return None
    chat = [{"role": "system", "content": INSTRUCTIONS},
            {"role": "user", "content": "Conversation:\n" + json.dumps(turns, ensure_ascii=False) + "\n\nJSON:"}]
    try:
        response = await asyncio.wait_for(llm.ainvoke(chat), timeout=timeout_seconds)
    except Exception:   # noqa: BLE001 - a missing card is the designed outcome of any failure here
        return None
    return parse(response_text(response))
