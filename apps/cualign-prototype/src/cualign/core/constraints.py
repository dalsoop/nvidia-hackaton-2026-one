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
    model_config = ConfigDict(extra="forbid")
    allow_extraction: bool | None = None
    lock: list[Tooth] | None = None
    ipr_exclude: list[Tooth] | None = None
    ipr_limit_mm: float | None = Field(default=None, ge=0, le=IPR_PER_SURFACE, allow_inf_nan=False)
    stage_cap: int | None = Field(default=None, gt=0)
    order: Order | None = None

    def changes(self):
        # Only stage_cap can explicitly be cleared with null; [] clears tooth lists.
        result = self.model_dump(exclude_unset=True)
        if any(v is None and k != "stage_cap" for k, v in result.items()):
            raise ValueError("null only clears stage_cap; use [] for tooth lists")
        return result
