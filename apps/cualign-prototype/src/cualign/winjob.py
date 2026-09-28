"""Windows: `cualign serve` must not leave `nat serve` running after it is gone.

On Windows `uv run python -m cualign.cli serve` is a chain of processes: uv.exe -> the venv's python.exe (a
redirector) -> the interpreter running cualign.cli -> the redirector again -> the interpreter running nat serve. Each
python therefore shows twice in a process list; only the last one is the server (the redirectors are ~4 MB). Windows
does not end children with their parent, so killing uv.exe (or the shell) left the whole chain and the port behind.

Two ties fix that: this process goes into a job object that kills every process in it when its last handle closes
(the handle is ours, so it closes when this process ends in any way), and a thread ends this process when the nearest
ancestor that is not python (uv.exe or the shell that started the server) exits.
"""
from __future__ import annotations

import ctypes
import os
import threading
from ctypes import wintypes

_k32 = ctypes.WinDLL("kernel32", use_last_error=True) if os.name == "nt" else None
_JOB = None   # kept for the life of the process: closing it would kill the server


class _Basic(ctypes.Structure):
    _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]


class _Extended(ctypes.Structure):
    _fields_ = [("BasicLimitInformation", _Basic), ("IoInfo", ctypes.c_uint64 * 6),
                ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]


class _Entry(ctypes.Structure):
    _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD),
                ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", wintypes.LONG), ("dwFlags", wintypes.DWORD),
                ("szExeFile", wintypes.WCHAR * 260)]


def kill_children_with_this_process() -> bool:
    """Put this process in a kill-on-close job; the processes it starts afterwards join it. False if Windows refused."""
    global _JOB
    _k32.CreateJobObjectW.restype = wintypes.HANDLE
    job = _k32.CreateJobObjectW(None, None)
    info = _Extended()
    info.BasicLimitInformation.LimitFlags = 0x2000   # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    _k32.GetCurrentProcess.restype = wintypes.HANDLE
    if not (job and _k32.SetInformationJobObject(wintypes.HANDLE(job), 9, ctypes.byref(info), ctypes.sizeof(info))
            and _k32.AssignProcessToJobObject(wintypes.HANDLE(job), wintypes.HANDLE(_k32.GetCurrentProcess()))):
        return False
    _JOB = job
    return True


def _processes() -> dict[int, tuple[int, str]]:
    """pid -> (parent pid, exe name) for every process now."""
    _k32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    snap = _k32.CreateToolhelp32Snapshot(2, 0)   # TH32CS_SNAPPROCESS
    out, e = {}, _Entry()
    e.dwSize = ctypes.sizeof(e)
    try:
        ok = _k32.Process32FirstW(wintypes.HANDLE(snap), ctypes.byref(e))
        while ok:
            out[e.th32ProcessID] = (e.th32ParentProcessID, e.szExeFile.lower())
            ok = _k32.Process32NextW(wintypes.HANDLE(snap), ctypes.byref(e))
    finally:
        _k32.CloseHandle(wintypes.HANDLE(snap))
    return out


def launcher_pid() -> int | None:
    """The nearest ancestor that is not python (uv.exe, the shell), or None when there is none."""
    procs, pid, seen = _processes(), os.getpid(), set()
    while pid in procs and pid not in seen:
        seen.add(pid)
        pid = procs[pid][0]
        if pid in procs and not procs[pid][1].startswith("python"):
            return pid
    return None


def exit_when_gone(pid: int) -> bool:
    """End this process (and so the job) when `pid` exits. False if that process cannot be watched."""
    _k32.OpenProcess.restype = wintypes.HANDLE
    handle = _k32.OpenProcess(0x00100000, False, pid)   # SYNCHRONIZE
    if not handle:
        return False

    def wait():
        _k32.WaitForSingleObject(wintypes.HANDLE(handle), 0xFFFFFFFF)
        os._exit(0)
    threading.Thread(target=wait, name="cualign-launcher-watch", daemon=True).start()
    return True
