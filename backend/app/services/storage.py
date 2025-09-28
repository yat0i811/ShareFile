from __future__ import annotations

import asyncio
import hashlib
import os
from pathlib import Path

from app.core.config import settings


class StorageService:
    def __init__(self) -> None:
        self._root = settings.storage_root
        self._tmp_dir = settings.tmp_dir
        self._files_dir = settings.files_dir

    def ensure_base_dirs(self) -> None:
        for directory in (self._root, self._tmp_dir, self._files_dir):
            directory.mkdir(parents=True, exist_ok=True)

    def session_tmp_dir(self, session_id: str) -> Path:
        path = self._tmp_dir / session_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def chunk_path(self, session_id: str, index: int) -> Path:
        return self.session_tmp_dir(session_id) / f"chunk_{index:08d}.part"

    def file_dir(self, file_id: str) -> Path:
        path = self._files_dir / file_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def final_file_path(self, file_id: str) -> Path:
        return self.file_dir(file_id) / "data"

    async def write_chunk(self, session_id: str, index: int, data: bytes) -> Path:
        path = self.chunk_path(session_id, index)

        def _write() -> None:
            with open(path, "wb") as handle:
                handle.write(data)

        await asyncio.to_thread(_write)
        return path

    async def read_chunk(self, session_id: str, index: int) -> bytes:
        path = self.chunk_path(session_id, index)

        def _read() -> bytes:
            with open(path, "rb") as handle:
                return handle.read()

        return await asyncio.to_thread(_read)

    async def merge_chunks(
        self,
        session_id: str,
        total_chunks: int,
        target_path: Path,
    ) -> int:
        tmp_dir = self.session_tmp_dir(session_id)

        def _merge() -> int:
            byte_count = 0
            with open(target_path, "wb") as out_handle:
                for index in range(total_chunks):
                    chunk_path = tmp_dir / f"chunk_{index:08d}.part"
                    with open(chunk_path, "rb") as in_handle:
                        while True:
                            chunk = in_handle.read(1024 * 1024)
                            if not chunk:
                                break
                            out_handle.write(chunk)
                            byte_count += len(chunk)
            return byte_count

        return await asyncio.to_thread(_merge)

    async def cleanup_session(self, session_id: str) -> None:
        tmp_dir = self._tmp_dir / session_id

        def _cleanup() -> None:
            if tmp_dir.exists():
                for root, dirs, files in os.walk(tmp_dir, topdown=False):
                    for name in files:
                        Path(root, name).unlink(missing_ok=True)
                    for name in dirs:
                        Path(root, name).rmdir()
                tmp_dir.rmdir()

        await asyncio.to_thread(_cleanup)

    @staticmethod
    async def compute_sha256(path: Path) -> str:
        def _compute() -> str:
            hash_ = hashlib.sha256()
            with open(path, "rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    hash_.update(chunk)
            return hash_.hexdigest()

        return await asyncio.to_thread(_compute)


storage_service = StorageService()
