"""#113: Universal <-> FDI conversion lives in one place (core/fdi.py) and the reviewer reads FDI."""
import pytest

from cualign.core.fdi import from_fdi, teeth_to_fdi, to_fdi


def test_round_trip_over_the_upper_arch():
    assert [to_fdi(u) for u in range(1, 17)] == [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
    assert all(from_fdi(to_fdi(u)) == u for u in range(1, 17))
    assert (to_fdi(5), to_fdi(12), to_fdi(4), to_fdi(13)) == (14, 24, 15, 25)   # the premolars the planner supports
    for bad in (0, 17, 32):
        with pytest.raises(ValueError):
            to_fdi(bad)
    for bad in (5, 19, 20, 31, 48):
        with pytest.raises(ValueError):
            from_fdi(bad)


def test_plan_data_tooth_fields_are_rewritten_and_nothing_else():
    data = {"constraints": {"extraction": [5, 12], "lock": (), "ipr_limit_mm": 0.25, "stage_cap": 12},
            "info": {"removed": [5, 12], "locked": [], "ipr_applied_teeth": [7, 8, 9, 10], "n_stages": 12,
                     "rotation_deg": {8: 3.1, "9": -2.0}, "vertical_mm": {}, "space_deficit_mm": 0.4},
            "violations": [{"stage": 3, "type": "collision", "teeth": [8, 9], "mm": 0.1}, {"stage": None, "type": "space_deficit", "mm": 0.4}]}
    out = teeth_to_fdi(data)
    assert out["constraints"] == {"extraction": [14, 24], "lock": [], "ipr_limit_mm": 0.25, "stage_cap": 12}
    assert out["info"]["removed"] == [14, 24] and out["info"]["ipr_applied_teeth"] == [12, 11, 21, 22]
    assert out["info"]["rotation_deg"] == {"11": 3.1, "21": -2.0} and out["info"]["n_stages"] == 12
    assert out["violations"][0]["teeth"] == [11, 21] and out["violations"][1] == {"stage": None, "type": "space_deficit", "mm": 0.4}
    assert data["constraints"]["extraction"] == [5, 12]   # the input is not touched
