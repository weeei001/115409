from contextlib import contextmanager
import os
from pathlib import Path

from app.core.config import state_directory


class JobAlreadyRunning(RuntimeError):
    pass


@contextmanager
def worker_lock(name: str, directory: Path | None = None):
    if not name or Path(name).name != name or name in {".", ".."}:
        raise ValueError("Worker lock name must be a filename component")
    directory = directory or state_directory()
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{name}.lock"
    with path.open("a+b") as handle:
        if path.stat().st_size == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise JobAlreadyRunning(f"Worker is already running: {name}") from exc
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
