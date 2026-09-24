"""Confirmed planning constraints. Values are snapshots, never implicit resets."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator
from .limits import IPR_PER_SURFACE

Tooth = Annotated[int, Field(strict=True, ge=2, le=15)]
Order = Literal["simultaneous", "anterior_first", "sequential"]


class Constraints(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    allow_extraction: bool = False
    lock: tuple[Tooth, ...] = ()
    ipr_exclude: tuple[Tooth, ...] = ()
    ipr_limit_mm: float = Field(default=IPR_PER_SURFACE, ge=0, le=IPR_PER_SURFACE, allow_inf_nan=False)
    stage_cap: int | None = Field(default=None, gt=0)
    order: Order = "simultaneous"

    @field_validator("lock", "ipr_exclude")
    @classmethod
    def unique_teeth(cls, value):
        return tuple(sorted(set(value)))

    def patched(self, changes: dict) -> "Constraints":
        return Constraints.model_validate({**self.model_dump(), **changes})

    def check_case(self, ids):
        if (set(self.lock) | set(self.ipr_exclude)) - set(ids):
            raise ValueError("constraint refers to a tooth absent from this case")


class ConstraintPatch(BaseModel):
    """null means keep. A model filling every schema field with null must not change anything.

    Clearing is always explicit: [] empties a tooth list, clear_stage_cap drops the stage cap.
    Do not rely on exclude_unset here — a tool call arrives with every field present.
    """
    model_config = ConfigDict(extra="forbid")
    allow_extraction: bool | None = None
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
