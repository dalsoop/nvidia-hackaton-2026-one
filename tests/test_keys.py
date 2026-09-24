"""NVIDIA key detection must accept the OpenShell provider placeholder, or Guardrails turn off inside a sandbox."""
from cualign.keys import nvidia_key_available


def test_real_key_counts():
    assert nvidia_key_available({"NVIDIA_API_KEY": "nvapi-abc"})


def test_openshell_placeholder_counts():
    assert nvidia_key_available({"NVIDIA_API_KEY": "openshell:resolve:env:v123_NVIDIA_API_KEY"})


def test_missing_or_other_values_do_not_count():
    assert not nvidia_key_available({})
    assert not nvidia_key_available({"NVIDIA_API_KEY": ""})
    assert not nvidia_key_available({"NVIDIA_API_KEY": "sk-not-nvidia"})
