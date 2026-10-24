"""
Storage module — SQLite (metadata store) and ChromaDB (vector store) wrappers.
"""

from .metadata_db import MetadataDB

__all__ = ["MetadataDB"]
