"""The planner's movement notes (target.notes on GET /api/plans/{id}, the 규칙 tab) name teeth as the dentist reads them.

Screen review 2026-09-28: 「… 0.2mm 더 둠 3-4」 and 「(3번 쪽 5.0mm, 14번 쪽 2.0mm)」 were Universal numbers. Every number in a note
that is not a measurement is an upper-arch FDI number (11..18, 21..28), and a contact pair sits inside its sentence."""
import re

import pytest

from cualign.core import samples
from cualign.core.case import Case
from cualign.core.constraints import Constraints
from cualign.core.planner import propose_target

FDI = {*range(11, 19), *range(21, 29)}
# a number that is not a measurement: not part of a decimal, not followed by a unit
NUMBER = re.compile(r"(?<![\d.])(\d+)(?![\d.]*(?:mm|°|면|개|장))")


def _teeth_in(note: str) -> list[int]:
    return [int(n) for n in NUMBER.findall(note)]


@pytest.mark.parametrize("sample", [s for s in samples.SAMPLES.values() if s.available], ids=lambda s: s.case_id)
def test_notes_name_teeth_in_fdi_on_every_sample(sample):
    case = Case.from_dir(sample.folder)
    c = Constraints().patched(dict(sample.constraints))
    strategies = ("extraction",) if c.extraction else ("expansion", "ipr", "expansion_ipr")
    seen = []
    for strategy in strategies:
        _, info = propose_target(case, strategy, constraints=c)
        for note in info["notes"]:
            teeth = _teeth_in(note)
            assert all(t in FDI for t in teeth), note          # no Universal 1..10, no "3-4"
            assert not re.search(r"\d+-\d+\s*$", note), note   # a contact pair does not hang off the sentence end
            seen += teeth
    assert seen   # the samples do produce notes with teeth (rotation, contact pairs, extraction sides)


def test_contact_pair_note_is_fdi_and_mid_sentence():
    assert _teeth_in("치관 모양 때문에 16-15, 13-12 사이를 접촉 폭보다 0.6mm 더 둠") == [16, 15, 13, 12]
    assert _teeth_in("남는 발치 공간은 대구치를 앞으로 옮겨 닫음 (16번 쪽 4.8mm, 26번 쪽 2.0mm)") == [16, 26]
    assert _teeth_in("IPR 면당 0.25mm x 20면 (제외 17·16·26·27번)") == [17, 16, 26, 27]
    assert _teeth_in("치관 모양 때문에 접촉 폭보다 0.2mm 더 둠 3-4") == [3, 4]   # the leak this test pins out
