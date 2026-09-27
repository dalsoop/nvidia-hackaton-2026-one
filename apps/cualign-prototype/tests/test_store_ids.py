"""#126: plan/target ids are short enough for the model to copy between tool calls, and never reuse a taken one."""
from cualign.core import store


def test_new_id_is_prefix_plus_8_hex_and_skips_taken_ids(monkeypatch):
    draws = iter(["deadbeef", "deadbeef", "0badf00d", "01234567"])
    monkeypatch.setattr(store.secrets, "token_hex", lambda n: next(draws))
    assert store._new_id("p", {"pdeadbeef"}) == "p0badf00d"
    assert len(store._new_id("t", set())) == 1 + store.ID_HEX
