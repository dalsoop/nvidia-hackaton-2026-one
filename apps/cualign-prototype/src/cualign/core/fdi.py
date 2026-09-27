"""Tooth numbering at the boundary (#113): the code and files use Universal (upper arch 1..16), the dentist reads FDI
(upper right 18..11, upper left 21..28). Convert here, in one place, never in a prompt."""
from __future__ import annotations

TOOTH_LIST_KEYS = frozenset({"teeth", "removed", "locked", "lock", "extraction", "ipr_exclude", "ipr_applied_teeth"})
TOOTH_MAP_KEYS = frozenset({"rotation_deg", "vertical_mm", "widths_mm"})   # {tooth: value}


def to_fdi(u: int) -> int:
    """Universal 1..8 -> FDI 18..11, Universal 9..16 -> FDI 21..28."""
    u = int(u)
    if not 1 <= u <= 16:
        raise ValueError(f"not an upper-arch Universal number: {u}")
    return 19 - u if u <= 8 else 12 + u


def from_fdi(f: int) -> int:
    """FDI 11..18 -> Universal 8..1, FDI 21..28 -> Universal 9..16."""
    f = int(f)
    if 11 <= f <= 18:
        return 19 - f
    if 21 <= f <= 28:
        return f - 12
    raise ValueError(f"not an upper-arch FDI number: {f}")


def teeth_to_fdi(data):
    """A copy of nested plan data with every tooth number rewritten as FDI: lists under TOOTH_LIST_KEYS and the keys of
    maps under TOOTH_MAP_KEYS. Everything else is left as it is."""
    if isinstance(data, dict):
        out = {}
        for k, v in data.items():
            if k in TOOTH_LIST_KEYS and isinstance(v, (list, tuple)):
                out[k] = [to_fdi(t) for t in v]
            elif k in TOOTH_MAP_KEYS and isinstance(v, dict):
                out[k] = {str(to_fdi(t)): val for t, val in v.items()}
            else:
                out[k] = teeth_to_fdi(v)
        return out
    if isinstance(data, list):
        return [teeth_to_fdi(v) for v in data]
    return data
