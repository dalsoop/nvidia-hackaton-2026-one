"""Windows: `cualign serve` leaves nothing behind (winjob.py). Real processes, no server: a stand-in for serve puts
itself in the job, starts a long-running child (the stand-in for nat serve) and watches a stand-in launcher."""
import os
import subprocess
import sys
import time

import pytest

pytestmark = pytest.mark.skipif(os.name != "nt", reason="the POSIX serve path replaces itself with nat (os.execv)")

SERVE = """
import subprocess, sys, time
from cualign import winjob
assert winjob.kill_children_with_this_process()
if sys.argv[1] != "-":
    assert winjob.exit_when_gone(int(sys.argv[1]))
child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
print(child.pid, flush=True)
time.sleep(120)
"""


def alive(pid: int) -> bool:
    """Asked of the kernel, not tasklist (its output follows the console code page, cp949 here)."""
    import ctypes
    k32 = ctypes.WinDLL("kernel32")
    k32.OpenProcess.restype = ctypes.c_void_p
    h = k32.OpenProcess(0x00100000, False, pid)   # SYNCHRONIZE
    if not h:
        return False
    try:
        return k32.WaitForSingleObject(ctypes.c_void_p(h), 0) == 0x102   # WAIT_TIMEOUT: still running
    finally:
        k32.CloseHandle(ctypes.c_void_p(h))


def gone(pid: int, seconds: float = 15) -> bool:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if not alive(pid):
            return True
        time.sleep(0.3)
    return False


def start(launcher: str) -> tuple[subprocess.Popen, int]:
    serve = subprocess.Popen([sys.executable, "-c", SERVE, launcher], stdout=subprocess.PIPE, text=True)
    child = int(serve.stdout.readline())
    assert alive(child)
    return serve, child


def test_killing_serve_ends_the_server_it_started():
    serve, child = start("-")
    serve.kill()      # TerminateProcess: no cleanup code runs in serve
    assert gone(child)


def test_serve_ends_with_its_launcher():
    launcher = subprocess.Popen(["ping", "-n", "120", "127.0.0.1"], stdout=subprocess.DEVNULL)
    serve, child = start(str(launcher.pid))
    try:
        launcher.kill()   # uv.exe or the shell going away
        assert gone(serve.pid) and gone(child)
    finally:
        serve.kill()


def test_launcher_is_the_nearest_ancestor_that_is_not_python():
    from cualign import winjob
    procs = winjob._processes()
    pid = winjob.launcher_pid()
    assert pid is None or not procs[pid][1].startswith("python")
