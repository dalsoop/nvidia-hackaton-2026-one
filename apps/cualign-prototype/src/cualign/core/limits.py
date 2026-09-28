"""Clinical limits used by the validator. Every number is grade-A (primary source, quoted verbatim).

Sources (see docs/clinical-sources.md):
- MDPI Applied Sciences 2024 staging review — 0.25 mm linear / 1 deg angular / 2 deg rotation per aligner
- Nature IJOS 2025 expert consensus — IPR 0.25 mm per surface, expansion 2 mm per side, extraction threshold 8 mm
- Align Technology press release 2016 — 7-day wear period
"""
MAX_LINEAR_PER_ALIGNER = 0.25   # mm
MAX_ANGULAR_PER_ALIGNER = 1.0   # deg (not enforced in MVP: translation-only staging)
MAX_ROTATION_PER_ALIGNER = 2.0  # deg about the crown's vertical axis (staged and validated)
IPR_PER_SURFACE = 0.25          # mm
MAX_EXPANSION_PER_SIDE = 2.0    # mm
EXTRACTION_THRESHOLD_MM = 8.0   # mm of space deficit
WEAR_DAYS = 14                  # days per aligner
DAYS_PER_MONTH = 30.4

STRATEGIES = ("expansion", "ipr", "expansion_ipr", "extraction")
SPACE_DEFICIT_TOLERANCE_MM = 0.5   # a strategy must gain at least crowding - this much

# Universal numbering, upper arch. Third molars (1, 16) are excluded from planning.
UPPER = list(range(2, 16))
PREMOLARS = {4, 5, 12, 13}
ANTERIOR = {6, 7, 8, 9, 10, 11}   # canine to canine


def stage_cap_from_months(months: float) -> int:
    """'12개월' -> 26 aligners. Same formula the SKILL.md teaches the agent."""
    return int(round(months * DAYS_PER_MONTH / WEAR_DAYS))


def months_from_stages(n: int) -> float:
    return round(n * WEAR_DAYS / DAYS_PER_MONTH, 1)
