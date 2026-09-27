"""Confirmed planning constraints. Values are snapshots, never implicit resets.

Extraction is the dentist's prescription of which teeth to extract (#56): `extraction` lists them (Universal
numbers), () is non-extraction. The app never picks the teeth. `allow_extraction` survives only as a derived value
in the output (screens, logs, evaluations read it); as an input, false clears the list and true without teeth is
refused with ExtractionTeethNeeded, so the caller asks the dentist which teeth.
"""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator, model_validator
from .limits import IPR_PER_SURFACE, PREMOLARS

Tooth = Annotated[int, Field(strict=True, ge=2, le=15)]
Order = Literal["simultaneous", "anterior_first", "sequential"]
EXTRACTABLE = frozenset(PREMOLARS)   # the layout (anchored on the first molars) supports premolar extraction only


class ExtractionTeethNeeded(ValueError):
    """Extraction was allowed without saying which teeth: the app does not choose them."""

    def __init__(self):
        super().__init__("발치할 치아 번호가 필요합니다(Universal, 예: 5, 12). 앱은 발치 치아를 고르지 않습니다.")


def reason_ko(e: Exception) -> str:
    """A constraint error in the words shown to the dentist: the validator's own sentence, not pydantic's dump."""
    errors = getattr(e, "errors", None)
    if callable(errors):
        msgs = [str(x.get("msg", "")).removeprefix("Value error, ") for x in errors()]
        return "; ".join(m for m in msgs if m) or str(e)
    return str(e)


def _legacy_extraction(data: dict, current: tuple = ()) -> dict:
    """Map the old allow_extraction input onto extraction. false clears; true keeps a prescription already there and
    otherwise needs the teeth; a value contradicting the given list is an input error."""
    if "allow_extraction" not in data:
        return data
    data = dict(data)
    allow = data.pop("allow_extraction")
    if allow is None:
        return data
    teeth = data.get("extraction")
    if teeth is not None:
        if bool(allow) != bool(teeth):
            raise ValueError("allow_extraction과 extraction이 서로 다릅니다.")
        return data
    if not allow:
        data["extraction"] = ()
    elif not current:
        raise ExtractionTeethNeeded()
    return data


class Constraints(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    extraction: tuple[Tooth, ...] = ()
    lock: tuple[Tooth, ...] = ()
    ipr_exclude: tuple[Tooth, ...] = ()
    ipr_limit_mm: float = Field(default=IPR_PER_SURFACE, ge=0, le=IPR_PER_SURFACE, allow_inf_nan=False)
    stage_cap: int | None = Field(default=None, gt=0)
    order: Order = "simultaneous"

    @model_validator(mode="before")
    @classmethod
    def _accept_legacy(cls, data):
        return _legacy_extraction(data) if isinstance(data, dict) else data

    @field_validator("extraction", "lock", "ipr_exclude")
    @classmethod
    def unique_teeth(cls, value):
        return tuple(sorted(set(value)))

    @field_validator("extraction")
    @classmethod
    def supported_extraction(cls, value):
        if set(value) - EXTRACTABLE:
            raise ValueError(f"소구치(4, 5, 12, 13) 발치만 계획할 수 있습니다: {sorted(set(value) - EXTRACTABLE)}")
        return value

    @model_validator(mode="after")
    def _not_both_locked_and_extracted(self):
        if set(self.extraction) & set(self.lock):
            raise ValueError(f"발치할 치아를 고정할 수 없습니다: {sorted(set(self.extraction) & set(self.lock))}")
        return self

    @computed_field
    @property
    def allow_extraction(self) -> bool:
        return bool(self.extraction)

    @classmethod
    def from_saved(cls, data: dict, removed=()) -> "Constraints":
        """A constraints snapshot read back from a plan file. Files written before #56 have allow_extraction and no
        teeth: an extraction plan's prescription is the teeth it removed; a plan that removed none only had
        extraction allowed, which is non-extraction now. Never picks teeth."""
        if "extraction" not in data and "allow_extraction" in data:
            allowed = bool(data["allow_extraction"])
            data = {k: v for k, v in data.items() if k != "allow_extraction"}
            # only an extraction the plan was allowed to make becomes its prescription; a forbidden one stays
            # forbidden, so the validator still reports it (#98 review)
            data["extraction"] = sorted(set(removed or ())) if allowed else []
        return cls.model_validate(data)

    def patched(self, changes: dict) -> "Constraints":
        changes = _legacy_extraction(changes, self.extraction)
        return Constraints.model_validate({**self.model_dump(exclude={"allow_extraction"}), **changes})

    def check_case(self, ids):
        if (set(self.lock) | set(self.ipr_exclude) | set(self.extraction)) - set(ids):
            raise ValueError("constraint refers to a tooth absent from this case")


class ConstraintPatch(BaseModel):
    """null means keep. A model filling every schema field with null must not change anything.

    Clearing is always explicit: [] empties a tooth list, clear_stage_cap drops the stage cap.
    Do not rely on exclude_unset here — a tool call arrives with every field present.
    """
    model_config = ConfigDict(extra="forbid")
    extraction: list[Tooth] | None = Field(
        default=None, description="Teeth the dentist prescribed to extract (Universal numbers). [] = non-extraction. "
                                  "Never choose teeth yourself: if extraction is allowed but no teeth were named, ask.")
    allow_extraction: bool | None = Field(
        default=None, description="Deprecated: prefer extraction. false = non-extraction; true alone is refused "
                                  "(the teeth are needed).")
    lock: list[Tooth] | None = None
    ipr_exclude: list[Tooth] | None = None
    ipr_limit_mm: float | None = Field(default=None, ge=0, le=IPR_PER_SURFACE, allow_inf_nan=False)
    stage_cap: int | None = Field(default=None, gt=0)
    clear_stage_cap: bool = False
    order: Order | None = None

    def changes(self):
        result = {k: v for k, v in self.model_dump().items()
                  if v is not None and k not in ("clear_stage_cap", "stage_cap")}
        if self.clear_stage_cap:
            if self.stage_cap is not None:
                raise ValueError("clear_stage_cap and stage_cap cannot be set together")
            result["stage_cap"] = None
        elif self.stage_cap is not None:
            result["stage_cap"] = self.stage_cap
        return result
