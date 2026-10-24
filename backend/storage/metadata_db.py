"""
MetadataDB — SQLite wrapper for file/chunk metadata that lives alongside
the vector store: file paths, indexing status, and the full chunk text
(kept here so the BM25 half of hybrid search has something to tokenize —
ChromaDB is queried by embedding, not by keyword).
"""

import sqlite3
import time
from pathlib import Path


class MetadataDB:
    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or Path.home() / ".nexus" / "metadata.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn: sqlite3.Connection | None = None

    def connect(self) -> None:
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self.init_schema()

    def init_schema(self) -> None:
        assert self._conn is not None
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT UNIQUE NOT NULL,
                file_type TEXT NOT NULL,
                last_modified REAL NOT NULL,
                last_indexed REAL,
                status TEXT NOT NULL DEFAULT 'pending'
            );

            CREATE TABLE IF NOT EXISTS chunks (
                id TEXT PRIMARY KEY,
                file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                chunk_index INTEGER NOT NULL,
                text TEXT NOT NULL
            );
            """
        )
        self._conn.commit()

    def upsert_file(self, path: str, file_type: str, last_modified: float) -> int:
        assert self._conn is not None
        existing = self.get_file(path)
        if existing:
            self._conn.execute(
                "UPDATE files SET file_type = ?, last_modified = ?, status = 'pending' WHERE path = ?",
                (file_type, last_modified, path),
            )
            self._conn.commit()
            return existing["id"]

        cursor = self._conn.execute(
            "INSERT INTO files (path, file_type, last_modified, status) VALUES (?, ?, ?, 'pending')",
            (path, file_type, last_modified),
        )
        self._conn.commit()
        return cursor.lastrowid

    def mark_indexed(self, file_id: int) -> None:
        assert self._conn is not None
        self._conn.execute(
            "UPDATE files SET status = 'indexed', last_indexed = ? WHERE id = ?",
            (time.time(), file_id),
        )
        self._conn.commit()

    def mark_error(self, file_id: int) -> None:
        assert self._conn is not None
        self._conn.execute("UPDATE files SET status = 'error' WHERE id = ?", (file_id,))
        self._conn.commit()

    def add_chunk(self, chunk_id: str, file_id: int, chunk_index: int, text: str) -> None:
        assert self._conn is not None
        self._conn.execute(
            "INSERT OR REPLACE INTO chunks (id, file_id, chunk_index, text) VALUES (?, ?, ?, ?)",
            (chunk_id, file_id, chunk_index, text),
        )
        self._conn.commit()

    def get_file(self, path: str) -> dict | None:
        assert self._conn is not None
        row = self._conn.execute("SELECT * FROM files WHERE path = ?", (path,)).fetchone()
        return dict(row) if row else None

    def all_chunks(self) -> list[dict]:
        """Every indexed chunk with its parent file's path — the corpus the
        BM25 side of hybrid search is built over."""
        assert self._conn is not None
        rows = self._conn.execute(
            """
            SELECT chunks.id AS chunk_id, chunks.text AS text, files.path AS path
            FROM chunks
            JOIN files ON chunks.file_id = files.id
            """
        ).fetchall()
        return [dict(row) for row in rows]

    def list_files(self, limit: int = 100, offset: int = 0, status: str | None = None) -> list[dict]:
        assert self._conn is not None
        query = """
            SELECT files.id, files.path, files.file_type, files.last_modified,
                   files.last_indexed, files.status, COUNT(chunks.id) AS chunk_count
            FROM files
            LEFT JOIN chunks ON files.id = chunks.file_id
        """
        params: list = []
        if status:
            query += " WHERE files.status = ?"
            params.append(status)
        query += " GROUP BY files.id ORDER BY files.last_modified DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        rows = self._conn.execute(query, params).fetchall()
        return [dict(row) for row in rows]

    def clear_file_chunks(self, file_id: int) -> None:
        assert self._conn is not None
        self._conn.execute("DELETE FROM chunks WHERE file_id = ?", (file_id,))
        self._conn.commit()

    def get_files_under_dir(self, dir_path: str) -> list[dict]:
        """Return all files recorded under dir_path."""
        assert self._conn is not None
        norm_dir = dir_path.rstrip("/\\")
        prefix1 = norm_dir + "/%"
        prefix2 = norm_dir + "\\%"
        rows = self._conn.execute(
            "SELECT id, path FROM files WHERE path = ? OR path LIKE ? OR path LIKE ?",
            (norm_dir, prefix1, prefix2),
        ).fetchall()
        return [dict(row) for row in rows]

    def delete_file_by_id(self, file_id: int) -> str | None:
        assert self._conn is not None
        row = self._conn.execute("SELECT path FROM files WHERE id = ?", (file_id,)).fetchone()
        if not row:
            return None
        file_path = row["path"]
        self._conn.execute("DELETE FROM chunks WHERE file_id = ?", (file_id,))
        self._conn.execute("DELETE FROM files WHERE id = ?", (file_id,))
        self._conn.commit()
        return file_path

    def delete_file_by_path(self, path: str) -> bool:
        assert self._conn is not None
        row = self._conn.execute("SELECT id FROM files WHERE path = ?", (path,)).fetchone()
        if not row:
            return False
        file_id = row["id"]
        self._conn.execute("DELETE FROM chunks WHERE file_id = ?", (file_id,))
        self._conn.execute("DELETE FROM files WHERE id = ?", (file_id,))
        self._conn.commit()
        return True

    def delete_all(self) -> None:
        assert self._conn is not None
        self._conn.execute("DELETE FROM chunks")
        self._conn.execute("DELETE FROM files")
        self._conn.commit()

    def get_stats(self) -> dict:
        assert self._conn is not None
        file_count = self._conn.execute("SELECT COUNT(*) FROM files").fetchone()[0]
        indexed_count = self._conn.execute("SELECT COUNT(*) FROM files WHERE status = 'indexed'").fetchone()[0]
        pending_count = self._conn.execute("SELECT COUNT(*) FROM files WHERE status = 'pending'").fetchone()[0]
        error_count = self._conn.execute("SELECT COUNT(*) FROM files WHERE status = 'error'").fetchone()[0]
        chunk_count = self._conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]

        return {
            "total_files": file_count,
            "indexed_files": indexed_count,
            "pending_files": pending_count,
            "error_files": error_count,
            "total_chunks": chunk_count,
        }

    def close(self) -> None:
        if self._conn:
            self._conn.close()
            self._conn = None