"""Start-screen samples (#46): real scans that ship with the package, opened with the dentist's prescription."""
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cualign.core import planner, samples, store
from cualign.core.store import Store
from cualign.server import api

STATIC = Path(api.__file__).resolve().parent / "static"
IDS = ["poseidon-000097", "poseidon-000001", "poseidon-000131"]   # card order: severe → moderate → mild (#90)


def test_samples_ship_with_the_package():
    assert list(samples.SAMPLES) == IDS
    for s in samples.SAMPLES.values():
        assert s.available, s.case_id
        assert {f"{i}.stl" for i in range(2, 16)} <= {p.name for p in s.folder.iterdir()}
        assert (s.folder / "gingiva.stl").exists() and "CC-BY-4.0" in (s.folder / "SOURCE.txt").read_text(encoding="utf-8")
        assert (STATIC / "samples" / f"{s.case_id}.png").stat().st_size > 1000
    assert "CC-BY-4.0" in (samples.SAMPLE_DIR / "ATTRIBUTION.md").read_text(encoding="utf-8")


def test_start_screen_lists_the_samples_not_the_synthetic_cases():
    rows = Store().available_cases()
    assert [r["case_id"] for r in rows[:3]] == IDS and all(r["kind"] == "sample" and r["available"] for r in rows[:3])
    assert all(r["prescription"] and r["request"] for r in rows[:3])
    assert all(r["constraints"] == samples.get(r["case_id"]).initial_constraints().model_dump(mode="json") for r in rows[:3])
    # the presets stay loadable by name (agent, tests, CLI); the screen filters them out
    assert {"moderate"} <= {r["case_id"] for r in rows if r["kind"] == "synthetic"}
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    assert 'id="screenStart"' in html and 'id="sampleCards"' in html and "screenSamples" not in html
    assert "발치안이랑 비발치안" not in html          # the tool does not pick the treatment direction


def test_a_sample_opens_with_its_prescription():
    st = Store()
    cid, case = st.load_case("poseidon-000097")
    assert cid == "poseidon-000097" and case.ids == list(range(2, 16))
    assert st.constraints_for(cid).allow_extraction
    _, _ = st.load_case("poseidon-000131")
    c = st.constraints_for("poseidon-000131")
    assert not c.allow_extraction and c.ipr_limit_mm == 0.25
    assert set(range(2, 16)) - set(c.ipr_exclude) == {7, 8, 9, 10}        # FDI 12..22
    c.check_case(case.ids)
    # the dentist's later change is kept: the prescription is only the starting value
    st.case_constraints["poseidon-000097"] = st.constraints_for("poseidon-000097").patched({"allow_extraction": False})
    st.load_case("poseidon-000097")
    assert not st.constraints_for("poseidon-000097").allow_extraction


def test_activate_api_returns_the_prescription(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "OUT_DIR", tmp_path)
    monkeypatch.setattr(store, "OUT_DIR", tmp_path)
    monkeypatch.setattr(store, "STORE", Store())
    monkeypatch.setattr(api, "STORE", store.STORE)
    app = FastAPI()
    api.add_api_routes(app)
    with TestClient(app) as client:
        cases = client.get("/api/cases").json()["cases"]
        assert [c["case_id"] for c in cases[:3]] == IDS
        info = client.post("/api/cases/poseidon-000097/activate").json()
        assert info["n_teeth"] == 14 and info["constraints"]["allow_extraction"] is True
        assert client.get("/ui/samples/poseidon-000097.png").status_code == 200


def test_extraction_sample_plans_inside_its_prescription():
    st = Store()
    cid, case = st.load_case("poseidon-000097")
    rows = planner.compare_strategies(case, constraints=st.constraints_for(cid))
    assert [r["strategy"] for r in rows] == ["extraction"]              # prescribed: the extraction plan only
    ext = rows[0]
    assert ext["passed"] and ext["removed"] == [5, 12]                  # FDI 14·24, as prescribed


def test_a_missing_sample_is_reported_not_crashed(monkeypatch, tmp_path):
    monkeypatch.setattr(samples, "SAMPLE_DIR", tmp_path)
    rows = Store().available_cases()
    assert not any(r["available"] for r in rows if r["kind"] == "sample")
    with pytest.raises(FileNotFoundError):
        Store().load_case("poseidon-000001")


def test_the_note_states_the_ipr_the_core_computes():
    # the prescription is not exactly expressible (per-tooth IPR, 0.25 mm per contact at most): the note gives the
    # app's total, and it must be the core's
    for s in samples.SAMPLES.values():
        c = s.initial_constraints()
        got = planner._ipr_gain(list(range(2, 16)), set(c.ipr_exclude), c.ipr_limit_mm) if c.ipr_exclude else 0.0
        assert got == pytest.approx(s.ipr_total_mm), s.case_id
        if got:
            assert f"총 {got:.1f}mm" in s.note, s.case_id


def test_prescriptions_show_fdi_and_the_app_numbers():
    for s in samples.SAMPLES.values():
        assert "FDI" in s.prescription and "앱 번호" in s.prescription and "앱 번호" in s.request


def test_cli_keeps_the_sample_prescription_unless_the_request_says_otherwise():
    from cualign.cli import parse_constraints
    assert parse_constraints(samples.get("poseidon-000131").request)["extraction"] == []
    assert parse_constraints(samples.get("poseidon-000001").request)["extraction"] == []
    assert parse_constraints(samples.get("poseidon-000097").request)["extraction"] == [5, 12]   # the app numbers
    assert parse_constraints("12개월 안에")["extraction"] is None           # not said: the case decides
    assert parse_constraints("발치 없이 12개월 안에")["extraction"] == []
    assert parse_constraints("4번과 13번 발치로 짜줘")["extraction"] == [4, 13]
    assert parse_constraints("발치 허용해서 짜줘")["extraction"] == "teeth-needed"   # the app does not pick teeth (#56)
