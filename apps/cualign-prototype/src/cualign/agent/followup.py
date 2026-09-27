"""The next question for the dentist after each agent turn (#90).

The screen shows the agent's answer and then one question card with two or three choices (the way a design agent
asks before it draws). A small, fast model writes it from the last turn of the conversation (the answer and the sentence that asked for it); the planner's prompt
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
    "general, and never ask again what the dentist's last message already decided: move to the next decision. Korean "
    "only, question and choices alike. Stay inside the app's limits: IPR is at most 0.25 mm per surface (never offer "
    "more), strategies are 확장, IPR, 확장 + IPR, 발치; a choice names concrete teeth or values. Tooth numbers in FDI, "
    "upper arch only (11..18, 21..28), never the app's 1..16 and never lower teeth. If the dentist asks about pain, "
    "symptoms, medication or anything clinical, do not answer it: the choices stay plan conditions (never advise "
    "medication, wear time or treatment management). Never diagnose, never prescribe, never mention plan ids, tool or "
    "field names. "
    'Answer with JSON only: {"question": "...", "options": [{"label": "...", "message": "..."}, ...]}'
)

# The model sees the last answer and the dentist's last sentence only. With the last six turns of an E2E conversation
# (three plan answers, about 3,000 characters) nim_lightning did not answer within 60 s (socket read timeout, 2026-09-28,
# .report/11-gum-server.md) and the card was null on every run; the ten-sentence live check with one short answer
# came back in seconds. The card asks about the plan just made, so that answer is all it needs.
MAX_ANSWER_CHARS = 1200   # the last assistant answer (a plan answer is about 500 characters)
MAX_USER_CHARS = 300      # the dentist's last sentence
MAX_TURNS = 2
MAX_CHARS = MAX_ANSWER_CHARS + MAX_USER_CHARS   # the whole tail
MAX_OPTIONS = 3
HEDGE_AFTER = 4         # seconds without an answer before a second call is started (next_question)
# What the screen does with buttons, never a chip (#107): approving, exporting, holding, downloading, re-reviewing.
HANGUL_RE = re.compile(r"[가-힣]")
SCREEN_ACTION_RE = re.compile(r"승인|확정|내보내|export|보류|다운로드|STL|ZIP|검토 다시|재검토|approve", re.I)


def parse(text: str) -> dict | None:
    """The JSON object in the model's text, trimmed to what the card shows; None when it is not a usable question."""
    text = text or ""
    data = None
    for start in sorted({m.start() for m in re.finditer(r"\{", text)}, reverse=True):   # the last object that parses
        try:
            data = json.loads(text[start:text.rindex("}") + 1])
            break
        except (json.JSONDecodeError, ValueError):
            continue
    if not isinstance(data, dict):
        return None
    question = str(data.get("question") or "").strip()
    if not HANGUL_RE.search(question):   # an English question is no card for a Korean screen (#107, live case 6)
        return None
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
    """The last assistant answer (cut to MAX_ANSWER_CHARS) preceded by the dentist's last sentence before it (cut to
    MAX_USER_CHARS); without an assistant answer, the last user message alone. At most MAX_TURNS messages, MAX_CHARS
    characters in all."""
    turns = [m for m in messages if m.get("role") in ("user", "assistant")]
    last_answer = next((i for i in range(len(turns) - 1, -1, -1) if turns[i]["role"] == "assistant"), None)
    kept = []
    if last_answer is None:
        users = [m for m in turns if m["role"] == "user"]
        if users:
            kept.append({"role": "user", "content": str(users[-1].get("content") or "")[:MAX_USER_CHARS]})
        return kept
    last_user = next((i for i in range(last_answer - 1, -1, -1) if turns[i]["role"] == "user"), None)
    if last_user is not None:
        kept.append({"role": "user", "content": str(turns[last_user].get("content") or "")[:MAX_USER_CHARS]})
    kept.append({"role": "assistant", "content": str(turns[last_answer].get("content") or "")[:MAX_ANSWER_CHARS]})
    return kept


async def next_question(llm, messages: list[dict], *, timeout_seconds: float = 12, hedge_after: float = HEDGE_AFTER) -> dict | None:
    """One question card for the conversation, or None (no answer, bad JSON, timeout, upstream error).

    The endpoint sometimes never answers a request (live 2026-09-28: 3 of 9 calls hung past 60 s, with 200 to 1400
    characters of input alike, while the same inputs answered in 2 to 8 s the rest of the time, and a fresh request
    right after a hung one answered). So when the first call has not answered after `hedge_after` seconds a second
    call is started and the first answer wins, all within `timeout_seconds`."""
    turns = tail(messages)
    if not turns:
        return None
    chat = [{"role": "system", "content": INSTRUCTIONS},
            {"role": "user", "content": "Conversation:\n" + json.dumps(turns, ensure_ascii=False) + "\n\nJSON:"}]
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds
    calls = [asyncio.ensure_future(llm.ainvoke(chat))]
    try:
        done, _ = await asyncio.wait(calls, timeout=min(hedge_after, timeout_seconds / 3))
        if not done:
            calls.append(asyncio.ensure_future(llm.ainvoke(chat)))
            done, _ = await asyncio.wait(calls, timeout=max(deadline - loop.time(), 0), return_when=asyncio.FIRST_COMPLETED)
        answered = [c for c in done if not c.exception()]
        return parse(response_text(answered[0].result())) if answered else None
    except Exception:   # noqa: BLE001 - a missing card is the designed outcome of any failure here
        return None
    finally:
        for c in calls:
            c.cancel()
