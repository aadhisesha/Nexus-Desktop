"""
HybridSearcher — combines BM25 (sparse, keyword-based) and dense embedding
vector similarity search into one highly ranked, deduplicated result list.
"""

from pathlib import Path
from typing import TYPE_CHECKING
from rank_bm25 import BM25Okapi

from embeddings.base import EmbeddingProvider
from storage.metadata_db import MetadataDB

if TYPE_CHECKING:
    from storage.chroma_client import ChromaClient


class HybridSearcher:
    def __init__(
        self,
        chroma_client: ChromaClient,
        metadata_db: MetadataDB,
        embedding_provider: EmbeddingProvider,
        bm25_weight: float = 0.45,
        dense_weight: float = 0.55,
    ) -> None:
        self.chroma_client = chroma_client
        self.metadata_db = metadata_db
        self.embedding_provider = embedding_provider
        self.bm25_weight = bm25_weight
        self.dense_weight = dense_weight

        self._bm25: BM25Okapi | None = None
        self._bm25_chunks: list[dict] = []
        self.refresh_index()

    def refresh_index(self) -> None:
        """Rebuild the in-memory BM25 index from whatever's currently in
        the metadata DB. Call this after indexing new files."""
        self._bm25_chunks = self.metadata_db.all_chunks()
        if not self._bm25_chunks:
            self._bm25 = None
            return

        tokenized_corpus = []
        for chunk in self._bm25_chunks:
            fname = Path(chunk.get("path", "")).name
            clean_name = fname.replace("_", " ").replace("-", " ")
            combined = f"{fname} {clean_name} {chunk['text']}".lower().split()
            tokenized_corpus.append(combined)

        self._bm25 = BM25Okapi(tokenized_corpus)

    def search(self, query: str, top_k: int = 10) -> list[dict]:
        clean_q = query.strip()
        if not clean_q:
            return []

        dense_results = self._dense_search(clean_q, top_k * 2)
        sparse_results = self._sparse_search(clean_q, top_k * 2)
        merged = self._merge(clean_q, dense_results, sparse_results, top_k)

        valid_results = []
        stale_purged = False
        for r in merged:
            fp = r.get("file_path", "")
            if fp and not Path(fp).exists():
                # Self-healing: file was deleted from disk, purge immediately
                self.metadata_db.delete_file_by_path(fp)
                self.chroma_client.delete_by_file_path(fp)
                stale_purged = True
                continue
            valid_results.append(r)

        if stale_purged:
            self.refresh_index()

        return valid_results

    def _dense_search(self, query: str, top_k: int) -> dict[str, dict]:
        embedding = self.embedding_provider.embed_text(query)
        raw = self.chroma_client.query(embedding, top_k=top_k)

        results = {}
        for item in raw:
            dist = max(item.get("distance", 1.0), 0.0)
            # True cosine similarity for unit vectors: cos(theta) = 1.0 - (dist / 2.0)
            cos_sim = max(0.0, min(1.0, 1.0 - (dist / 2.0)))
            results[item["id"]] = {
                "file_path": item["metadata"].get("file_path", ""),
                "snippet": item["metadata"].get("snippet", ""),
                "score": cos_sim,
                "raw_sim": cos_sim,
            }
        return results

    def _sparse_search(self, query: str, top_k: int) -> dict[str, dict]:
        if self._bm25 is None or not self._bm25_chunks:
            return {}

        tokenized_query = query.lower().split()
        scores = self._bm25.get_scores(tokenized_query)
        if len(scores) == 0:
            return {}

        max_score = max(scores) if max(scores) > 0 else 1.0
        ranked_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k]

        results = {}
        for i in ranked_indices:
            if scores[i] <= 0:
                continue
            chunk = self._bm25_chunks[i]
            results[chunk["chunk_id"]] = {
                "file_path": chunk["path"],
                "snippet": chunk["text"][:300],
                "score": scores[i] / max_score,
                "raw_bm25": scores[i],
            }
        return results

    def _merge(self, query: str, dense_results: dict, sparse_results: dict, top_k: int) -> list[dict]:
        combined_chunks: dict[str, dict] = {}
        query_words = [w.lower() for w in query.split() if len(w) > 1]

        all_chunk_ids = set(dense_results.keys()).union(sparse_results.keys())

        for chunk_id in all_chunk_ids:
            dense = dense_results.get(chunk_id)
            sparse = sparse_results.get(chunk_id)

            file_path = (dense or sparse)["file_path"]
            snippet = (dense or sparse)["snippet"]

            dense_score = dense["score"] if dense else 0.0
            sparse_score = sparse["score"] if sparse else 0.0

            # Direct keyword presence bonus in filename or snippet
            fname = Path(file_path).name.lower()
            snip_lower = snippet.lower()
            keyword_matches = sum(1 for w in query_words if w in fname or w in snip_lower)

            bonus = min(0.20, keyword_matches * 0.08)

            # Combined blended score
            final_score = (dense_score * self.dense_weight) + (sparse_score * self.bm25_weight) + bonus

            # Noise floor filter: discard chunks with weak semantic score and zero keyword hits
            if dense_score < 0.38 and sparse_score == 0 and keyword_matches == 0:
                continue

            combined_chunks[chunk_id] = {
                "file_path": file_path,
                "snippet": snippet,
                "score": min(0.99, max(0.01, final_score)),
            }

        # Deduplicate by file_path: group results so each document appears once with its best chunk
        best_per_file: dict[str, dict] = {}
        for c in combined_chunks.values():
            fp = c["file_path"]
            if fp not in best_per_file or c["score"] > best_per_file[fp]["score"]:
                best_per_file[fp] = c

        ranked = sorted(best_per_file.values(), key=lambda r: r["score"], reverse=True)
        return ranked[:top_k]
