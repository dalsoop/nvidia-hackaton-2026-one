"""IPR cut from the crown meshes (#62): width, untouched crowns, closed cuts, target contacts, exports."""
import io
import zipfile

import numpy as np
import pytest
import trimesh

from cualign.core import Case, planner
from cualign.core.constraints import Constraints
from cualign.core.ipr_cut import cut_faces, cut_ipr, per_tooth, surfaces_from_info

WIDTH_TOL_MM = 0.02     # the cut plane sits exactly `depth` inside the band extreme; the slack is mesh sampling


@pytest.fixture(scope="module")
def moderate():
    return Case.synthetic("moderate")


def test_half_per_tooth_and_excluded_partner_takes_none():
    assert per_tooth([(8, 9, 0.4)]) == {8: [(9, 0.2)], 9: [(8, 0.2)]}
    assert per_tooth([(3, 4, 0.125)], exclude={3}) == {4: [(3, 0.125)]}     # the molar keeps its width
    assert per_tooth([(3, 4, 0.125)], exclude={3, 4}) == {}
    assert per_tooth([(8, 9, 0.0)]) == {}


def test_width_drops_by_the_prescribed_amount_and_the_rest_is_untouched(moderate):
    c = moderate
    # (synthetic crown 6 is left out: its template mesh is not closed to begin with)
    cut = cut_ipr(c, [(8, 9, 0.4), (12, 13, 0.25)], exclude={13})
    assert sorted(cut.ipr_cut) == [8, 9, 12]
    for i, mm in ((8, 0.2), (9, 0.2), (12, 0.25)):
        assert c.contact_width(i) - cut.contact_width(i) == pytest.approx(mm, abs=WIDTH_TOL_MM), i
        assert cut.ipr_cut[i]["mm"] == pytest.approx(mm)
        assert cut.mesh[i].is_watertight and len(cut.ipr_cut[i]["faces"]) > 0
    for i in c.ids:
        if i not in (8, 9, 12):
            assert cut.mesh[i] is c.mesh[i]                       # not a copy: vertices and faces identical
    assert c.contact_width(13) == cut.contact_width(13)           # excluded partner: whole
    # the original case is not changed
    assert 8 not in getattr(c, "ipr_cut", {}) and c.mesh[8].vertices.shape == Case.synthetic("moderate").mesh[8].vertices.shape


def test_only_the_prescribed_surfaces_are_cut(moderate):
    c = moderate
    cut = cut_ipr(c, [(8, 9, 0.4)])
    m = cut.mesh[8]
    planes = cut.ipr_cut[8]["planes"]
    assert len(planes) == 1
    # the distal side of 8 (towards 7) keeps its vertices: every original vertex on that side is still in the mesh
    n = np.asarray(planes[0]["n"])
    V0 = np.asarray(c.mesh[8].vertices)
    far = V0[V0 @ n < planes[0]["c"] - 0.5]
    from scipy.spatial import cKDTree
    assert cKDTree(np.asarray(m.vertices)).query(far)[0].max() < 1e-9
    assert len(cut_faces(m, planes)) == len(cut.ipr_cut[8]["faces"])


def test_planner_cuts_the_ipr_it_plans_and_ipr_contacts_do_not_overlap(moderate):
    c = moderate
    target, info = planner.propose_target(c, "expansion_ipr")
    assert info["ipr_surfaces"] and all(mm > 0 for _, _, mm in info["ipr_surfaces"])
    surfaces, exclude = surfaces_from_info(c, info)
    cut = planner.cut_case(c, info)
    assert cut is not c and planner.cut_case(c, info) is cut          # cached
    assert sorted(cut.ipr_cut) == info["ipr_applied_teeth"]
    for i in info["ipr_applied_teeth"]:
        # both contacts of a span tooth: the per-surface amount in total (half of each contact, all of a contact
        # shared with an excluded molar)
        assert c.contact_width(i) - cut.contact_width(i) == pytest.approx(info["ipr_mm_per_surface"], abs=WIDTH_TOL_MM)
    for a, b, _ in surfaces:
        ov = cut._overlap(a, b, target[a], target[b], planner.yaw_of(target, a), planner.yaw_of(target, b))
        assert ov - cut.pair_baseline(a, b) <= planner.NEW_OVERLAP_MM3, (a, b, ov)
    # no IPR: nothing is cut, the case itself is used
    t2, info2 = planner.propose_target(c, "extraction", extraction=(5, 12))
    assert info2["ipr_surfaces"] == [] and planner.cut_case(c, info2) is c


def test_validate_and_exports_use_the_cut_crowns(tmp_path, moderate):
    c = moderate
    target, info = planner.propose_target(c, "expansion_ipr")
    stages, _ = planner.plan_stages(c, target)
    cut = planner.cut_case(c, info)
    assert planner.validate(c, stages, target_info=info) == planner.validate(cut, stages, target_info=info)
    z = planner.export_zip(cut, stages, str(tmp_path / "p.zip"))
    with zipfile.ZipFile(z) as zf:
        m = trimesh.load(io.BytesIO(zf.read("stage_01/8.stl")), file_type="stl", force="mesh")
    m.apply_transform(np.linalg.inv(cut.transform(8, stages[0][8], planner.yaw_of(stages[0], 8))))   # back to the scan frame
    assert m.is_watertight and len(cut_faces(m, cut.ipr_cut[8]["planes"], tol=1e-3)) > 0     # cut from the first stage


def test_cut_json_lists_the_cut_crowns_with_their_cap_faces(moderate):
    c = moderate
    _, info = planner.propose_target(c, "ipr")
    cut = planner.cut_case(c, info)
    data = cut.cut_json(max_faces=1500)
    assert set(data["teeth_cut"]) == set(data["ipr_cut"]) == {str(i) for i in info["ipr_applied_teeth"]}
    for i, e in data["ipr_cut"].items():
        t = data["teeth_cut"][i]
        assert len(t["f"]) <= 1500 and e["mm"] > 0 and 0 < len(e["faces"]) < len(t["f"]) and max(e["faces"]) < len(t["f"])
    assert c.cut_json() == {"teeth_cut": {}, "ipr_cut": {}}


def test_extraction_plan_without_ipr_leaves_the_sample_meshes_alone():
    from cualign.core.store import Store
    st = Store()
    cid, case = st.load_case("poseidon-000097")
    rows = planner.compare_strategies(case, constraints=st.constraints_for(cid))
    assert rows[0]["_info"]["ipr_surfaces"] == []
    assert planner.cut_case(case, rows[0]["_info"]) is case


def test_real_scan_cut_is_closed_and_exact():
    from cualign.core.store import Store
    st = Store()
    cid, case = st.load_case("poseidon-000131")
    c = st.constraints_for(cid)
    target, info = planner.propose_target(case, "ipr", constraints=c)
    cut = planner.cut_case(case, info)
    assert sorted(cut.ipr_cut) == [7, 8, 9, 10]                     # FDI 12..22, the prescription
    for i in cut.ipr_cut:
        assert cut.mesh[i].is_watertight
        assert case.contact_width(i) - cut.contact_width(i) == pytest.approx(c.ipr_limit_mm, abs=WIDTH_TOL_MM)
    for i in (2, 3, 4, 5, 6, 11, 12, 13, 14, 15):
        assert cut.mesh[i] is case.mesh[i]
