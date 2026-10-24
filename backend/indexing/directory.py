"""
Directory indexing utility — recursively crawls a target folder, identifies
supported files, and indexes them using the pipeline.
"""

import os
from pathlib import Path
from typing import Callable

from embeddings.base import CaptioningProvider, EmbeddingProvider
from storage.chroma_client import ChromaClient
from storage.metadata_db import MetadataDB

from . import IMAGE_EXTENSIONS, CODE_EXTENSIONS, _EXTENSION_MAP
from .pipeline import index_path

_IGNORE_DIRS = {
    "node_modules", "venv", "env", ".venv", ".env", "__pycache__",
    "dist", "build", "target", "out", "bin", "obj", ".git", ".idea",
    ".vscode", ".gemini", ".nexus", ".next", ".nuxt",
}

SUPPORTED_EXTENSIONS = set(_EXTENSION_MAP.keys()).union(IMAGE_EXTENSIONS).union(CODE_EXTENSIONS)


def crawl_directory(dir_path: str) -> list[Path]:
    """
    Find all supported files in dir_path, ignoring common build/dependency
    directories and hidden folders. Handles OS permissions gracefully.
    """
    root = Path(dir_path)
    if not root.exists() or not root.is_dir():
        raise ValueError(f"Directory path '{dir_path}' does not exist or is not a directory.")

    try:
        os.listdir(str(root))
    except PermissionError as exc:
        raise PermissionError(
            f"macOS denied permission to access '{dir_path}'. "
            "Please grant Nexus permission in System Settings > Privacy & Security > Files and Folders, "
            "or move the folder outside of ~/Downloads (e.g. to ~/Documents or a personal folder)."
        ) from exc

    files: list[Path] = []
    crawl_errors: list[str] = []

    def on_walk_error(err: OSError) -> None:
        crawl_errors.append(f"{err.filename or dir_path}: {err.strerror}")

    for dirpath, dirnames, filenames in os.walk(str(root), onerror=on_walk_error):
        # Prune ignored and hidden directories in-place
        dirnames[:] = [
            d for d in dirnames
            if d not in _IGNORE_DIRS and not (d.startswith(".") and d != ".")
        ]

        for fname in filenames:
            if fname.startswith("."):
                continue
            item = Path(dirpath) / fname
            if item.suffix.lower() in SUPPORTED_EXTENSIONS:
                files.append(item)

    if not files and crawl_errors:
        raise PermissionError(
            f"macOS denied permission to scan files in '{dir_path}': {'; '.join(crawl_errors)}"
        )

    return sorted(files)


def index_directory(
    dir_path: str,
    embedding_provider: EmbeddingProvider,
    chroma_client: ChromaClient,
    metadata_db: MetadataDB,
    captioning_provider: CaptioningProvider | None = None,
    progress_callback: Callable[[str, int, int], None] | None = None,
) -> dict:
    """
    Index all supported files inside a directory and prune removed files.
    """
    files = crawl_directory(dir_path)
    current_file_paths = {str(f.resolve()) for f in files} | {str(f) for f in files}

    # Reconcile: prune files that were removed from this directory
    existing_records = metadata_db.get_files_under_dir(dir_path)
    for record in existing_records:
        rec_path = record["path"]
        if rec_path not in current_file_paths and not Path(rec_path).exists():
            metadata_db.delete_file_by_id(record["id"])
            chroma_client.delete_by_file_path(rec_path)

    total_files = len(files)
    indexed_files = 0
    total_chunks = 0
    errors: list[dict] = []

    for i, file_path in enumerate(files):
        if progress_callback:
            progress_callback(str(file_path), i + 1, total_files)
        try:
            chunks = index_path(
                file_path=str(file_path),
                embedding_provider=embedding_provider,
                chroma_client=chroma_client,
                metadata_db=metadata_db,
                captioning_provider=captioning_provider,
            )
            indexed_files += 1
            total_chunks += chunks
        except Exception as exc:
            errors.append({"file_path": str(file_path), "error": str(exc)})

    return {
        "directory": dir_path,
        "total_files_found": total_files,
        "files_indexed": indexed_files,
        "total_chunks_indexed": total_chunks,
        "errors": errors,
    }
