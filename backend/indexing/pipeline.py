"""
Indexing pipeline — parses a file, embeds its chunks, and writes both the
vectors (ChromaDB) and the metadata (SQLite) for it.

This is the piece `/index` in main.py calls per file. A directory-crawling
/ background-watcher layer can sit on top of `index_path` later without
changing this function.
"""

from pathlib import Path
from typing import TYPE_CHECKING

from embeddings.base import CaptioningProvider, EmbeddingProvider
from storage.metadata_db import MetadataDB

if TYPE_CHECKING:
    from storage.chroma_client import ChromaClient

from . import index_file


def index_path(
    file_path: str,
    embedding_provider: EmbeddingProvider,
    chroma_client: ChromaClient,
    metadata_db: MetadataDB,
    captioning_provider: CaptioningProvider | None = None,
) -> int:
    """
    Index a single file end-to-end. Returns the number of chunks indexed
    (0 if the file produced no usable text).
    """
    path = Path(file_path)
    if not path.exists():
        metadata_db.delete_file_by_path(str(path))
        chroma_client.delete_by_file_path(str(path))
        return 0

    mtime = path.stat().st_mtime
    existing = metadata_db.get_file(str(path))
    if existing and existing.get("status") == "indexed":
        if abs(existing.get("last_modified", 0.0) - mtime) < 1e-4:
            # File has not changed since last successful indexing
            return 1

    chunks = index_file(str(path), captioning_provider=captioning_provider)
    if not chunks:
        return 0

    file_id = metadata_db.upsert_file(
        path=str(path),
        file_type=path.suffix.lower().lstrip("."),
        last_modified=mtime,
    )

    try:
        embeddings = embedding_provider.embed_batch(chunks)

        chunk_ids = [f"{file_id}-{i}" for i in range(len(chunks))]
        metadatas = [
            {"file_path": str(path), "snippet": chunk[:300]}
            for chunk in chunks
        ]

        # Purge any previous chunks for this file from vector DB and metadata DB
        chroma_client.delete_by_file_path(str(path))
        metadata_db.clear_file_chunks(file_id)

        chroma_client.upsert(ids=chunk_ids, embeddings=embeddings, metadatas=metadatas)

        for i, (chunk_id, chunk) in enumerate(zip(chunk_ids, chunks)):
            metadata_db.add_chunk(chunk_id=chunk_id, file_id=file_id, chunk_index=i, text=chunk)

        metadata_db.mark_indexed(file_id)
        return len(chunks)
    except Exception:
        metadata_db.mark_error(file_id)
        raise