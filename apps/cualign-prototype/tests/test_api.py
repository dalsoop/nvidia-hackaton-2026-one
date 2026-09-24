"""Offline artifact flow and missing-resource handling; no model calls."""
from io import BytesIO
from zipfile import ZipFile

from fastapi import FastAPI
from fastapi.testclient import TestClient

from cualign.server import api
from cualign.core import store


def test_artifact_flow(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "OUT_DIR", tmp_path)
    monkeypatch.setattr(store, "OUT_DIR", tmp_path)
    app = FastAPI()
    api.add_api_routes(app)
    with TestClient(app) as client:
        assert client.get("/ui/").status_code == 200
        assert client.get("/ui/app.js").status_code == 200
        result = client.post("/api/plan", json={"case_id": "moderate", "allow_extraction": False}).json()
        plan = result["chosen"] or result["best_failed"]
        pid = plan["plan_id"]
        detail = client.get(f"/api/plans/{pid}")
        assert detail.status_code == 200
        output = client.get(f"/api/plans/{pid}/stl.zip")
        assert output.status_code == 200
        with ZipFile(BytesIO(output.content)) as archive:
            assert len([n for n in archive.namelist() if n.endswith('.stl')]) == plan["n_stages"] * 14


def test_missing_plan_returns_404():
    app = FastAPI()
    api.add_api_routes(app)
    with TestClient(app) as client:
        assert client.get("/api/plans/not-a-plan").status_code == 404
        assert client.get("/api/plans/not-a-plan/stl.zip").status_code == 404
