"""
Nexus backend — FastAPI entrypoint.

Wires together config (API key storage), embeddings, indexing, storage, and
retrieval into working endpoints. A provider must be configured via
POST /settings before /index or /search will do anything.
"""

import os
import sys

# Ensure cwd is a safe, readable directory (e.g. ~/.nexus or /tmp) so that
# libraries like rich that call os.getcwd() during module import never fail
# with PermissionError: [Errno 1] Operation not permitted
try:
    nexus_home = os.path.expanduser("~/.nexus")
    os.makedirs(nexus_home, exist_ok=True)
    os.chdir(nexus_home)
except Exception:
    try:
        os.chdir("/tmp")
    except Exception:
        pass

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import ConfigStore
from embeddings.base import CaptioningProvider, EmbeddingProvider
from embeddings.openai_provider import OpenAICaptioningProvider, OpenAIEmbeddingProvider
from embeddings.gemini_provider import GeminiCaptioningProvider, GeminiEmbeddingProvider
from embeddings.anthropic_provider import AnthropicCaptioningProvider
from indexing.pipeline import index_path
from indexing.directory import index_directory
from retrieval import HybridSearcher
from storage.metadata_db import MetadataDB

app = FastAPI(title="Nexus Backend", version="0.1.0")

# Allow the Tauri/Vite dev frontend to call this API during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AppState:
    """
    Holds everything that needs to survive across requests: the config
    store, the storage backends, and the provider/searcher pair.
    Heavy components like ChromaClient and HybridSearcher are lazily
    initialized on demand to ensure instant app boot times.
    """

    def __init__(self) -> None:
        self.config_store = ConfigStore()
        self._chroma_client: ChromaClient | None = None
        self.metadata_db = MetadataDB()
        self.metadata_db.connect()

        self.embedding_provider: EmbeddingProvider | None = None
        self.captioning_provider: CaptioningProvider | None = None
        self._searcher: HybridSearcher | None = None

        self._restore_provider_from_disk()

    @property
    def chroma_client(self):
        if self._chroma_client is None:
            from storage.chroma_client import ChromaClient
            self._chroma_client = ChromaClient()
        return self._chroma_client

    @property
    def searcher(self) -> HybridSearcher | None:
        if self._searcher is None and self.embedding_provider is not None:
            self._searcher = HybridSearcher(
                chroma_client=self.chroma_client,
                metadata_db=self.metadata_db,
                embedding_provider=self.embedding_provider,
            )
        return self._searcher

    @searcher.setter
    def searcher(self, val: HybridSearcher | None) -> None:
        self._searcher = val

    def _restore_provider_from_disk(self) -> None:
        """On startup, pick back up whatever provider was configured in a
        previous session, if any."""
        provider = self.config_store.get_active_provider()
        if not provider:
            return
        key = self.config_store.get_provider_key(provider)
        if key:
            try:
                self._init_provider(provider, key)
            except Exception as exc:
                print(f"Warning: Failed to restore active provider '{provider}': {exc}")

    def _init_provider(self, provider: str, api_key: str) -> None:
        if provider == "openai":
            self.embedding_provider = OpenAIEmbeddingProvider(api_key)
            self.captioning_provider = OpenAICaptioningProvider(api_key)
        elif provider == "gemini":
            self.embedding_provider = GeminiEmbeddingProvider(api_key)
            self.captioning_provider = GeminiCaptioningProvider(api_key)
        elif provider == "anthropic":
            self.captioning_provider = AnthropicCaptioningProvider(api_key)
            saved_openai = self.config_store.get_provider_key("openai")
            saved_gemini = self.config_store.get_provider_key("gemini")
            if saved_openai:
                self.embedding_provider = OpenAIEmbeddingProvider(saved_openai)
            elif saved_gemini:
                self.embedding_provider = GeminiEmbeddingProvider(saved_gemini)
            else:
                raise ValueError(
                    "Anthropic provides image captioning only. Please also configure an OpenAI or Gemini API key for embeddings."
                )
        else:
            raise ValueError(f"Provider '{provider}' is not supported.")

        self._searcher = None

    def configure(self, provider: str, api_key: str) -> None:
        self._init_provider(provider, api_key)
        self.config_store.save_provider_key(provider, api_key)


state = AppState()


# --------------------------------------------------------------------------
# Request/response models
# --------------------------------------------------------------------------

class HealthResponse(BaseModel):
    status: str
    version: str
    provider_configured: bool
    active_provider: str | None = None


class SearchRequest(BaseModel):
    query: str
    top_k: int = 10


class SearchResult(BaseModel):
    file_path: str
    snippet: str
    score: float


class SearchResponse(BaseModel):
    results: list[SearchResult]


class SettingsPayload(BaseModel):
    provider: str
    api_key: str


class SettingsResponse(BaseModel):
    provider: str
    saved: bool


class IndexRequest(BaseModel):
    file_path: str


class IndexResponse(BaseModel):
    file_path: str
    chunks_indexed: int


class IndexDirectoryRequest(BaseModel):
    directory_path: str


class IndexDirectoryResponse(BaseModel):
    directory: str
    total_files_found: int
    files_indexed: int
    total_chunks_indexed: int
    errors: list[dict[str, str]]


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------

@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=app.version,
        provider_configured=state.embedding_provider is not None,
        active_provider=state.config_store.get_active_provider(),
    )


@app.get("/settings")
async def get_settings() -> dict[str, Any]:
    active = state.config_store.get_active_provider()
    keys = state.config_store._read().get("keys", {})
    configured = [p for p, k in keys.items() if k]
    return {
        "active_provider": active,
        "configured_providers": configured,
    }


@app.post("/settings", response_model=SettingsResponse)
async def save_settings(payload: SettingsPayload) -> SettingsResponse:
    try:
        state.configure(payload.provider, payload.api_key)
    except (ValueError, PermissionError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return SettingsResponse(provider=payload.provider, saved=True)


@app.post("/index", response_model=IndexResponse)
async def index_one(request: IndexRequest) -> IndexResponse:
    """
    Index a single file by absolute path.
    """
    if state.embedding_provider is None:
        raise HTTPException(status_code=400, detail="No provider configured. Save settings first.")

    path = Path(request.file_path)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    try:
        chunk_count = index_path(
            file_path=str(path),
            embedding_provider=state.embedding_provider,
            chroma_client=state.chroma_client,
            metadata_db=state.metadata_db,
            captioning_provider=state.captioning_provider,
        )
    except (ValueError, PermissionError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    assert state.searcher is not None
    state.searcher.refresh_index()

    return IndexResponse(file_path=str(path), chunks_indexed=chunk_count)


@app.post("/index-directory", response_model=IndexDirectoryResponse)
async def index_dir(request: IndexDirectoryRequest) -> IndexDirectoryResponse:
    """
    Recursively scan and index supported files in a directory.
    """
    if state.embedding_provider is None:
        raise HTTPException(status_code=400, detail="No provider configured. Save settings first.")

    path = Path(request.directory_path)
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")

    try:
        summary = index_directory(
            dir_path=str(path),
            embedding_provider=state.embedding_provider,
            chroma_client=state.chroma_client,
            metadata_db=state.metadata_db,
            captioning_provider=state.captioning_provider,
        )
    except (ValueError, PermissionError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    assert state.searcher is not None
    state.searcher.refresh_index()

    return IndexDirectoryResponse(**summary)


@app.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest) -> SearchResponse:
    if state.searcher is None:
        raise HTTPException(status_code=400, detail="No provider configured. Save settings first.")

    raw_results = state.searcher.search(request.query, top_k=request.top_k)
    return SearchResponse(
        results=[
            SearchResult(file_path=r["file_path"], snippet=r["snippet"], score=r["score"])
            for r in raw_results
        ]
    )


@app.get("/files")
async def list_files(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    status: str | None = None,
) -> list[dict[str, Any]]:
    return state.metadata_db.list_files(limit=limit, offset=offset, status=status)


@app.delete("/files/{file_id}")
async def delete_file(file_id: int) -> dict[str, Any]:
    file_path = state.metadata_db.delete_file_by_id(file_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="File not found")

    state.chroma_client.delete_by_file_path(file_path)
    if state.searcher:
        state.searcher.refresh_index()

    return {"deleted": True, "file_id": file_id, "path": file_path}


@app.delete("/folders")
async def delete_folder(path: str = Query(...)) -> dict[str, Any]:
    norm_path = path.replace("\\", "/").rstrip("/")
    files = state.metadata_db.get_files_under_dir(norm_path)
    count = 0
    for f in files:
        state.metadata_db.delete_file_by_id(f["id"])
        state.chroma_client.delete_by_file_path(f["path"])
        count += 1
    if state._searcher:
        state._searcher.refresh_index()
    return {"deleted_files": count, "folder": norm_path}


@app.post("/clear")
async def clear_all() -> dict[str, bool]:
    state.metadata_db.delete_all()
    state.chroma_client.clear()
    if state.searcher:
        state.searcher.refresh_index()
    return {"cleared": True}


@app.get("/stats")
async def get_stats() -> dict[str, Any]:
    db_stats = state.metadata_db.get_stats()
    chroma_count = state._chroma_client.count() if state._chroma_client else db_stats["total_chunks"]
    return {
        **db_stats,
        "chroma_vectors": chroma_count,
        "active_provider": state.config_store.get_active_provider(),
        "provider_configured": state.embedding_provider is not None,
    }


async def _serve_and_report_port() -> None:
    """
    Start uvicorn on an OS-assigned free port (port=0) and, once it's
    actually bound, print that port to stdout in a fixed, greppable
    format: "NEXUS_BACKEND_PORT=<port>". Tauri's Rust side reads this
    line from the child process's stdout to learn where the backend
    ended up listening — this avoids any "find a free port, then hope
    nothing else grabs it before we bind" race condition, since the
    port is only reported *after* uvicorn has actually bound it.
    """
    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="info")
    server = uvicorn.Server(config)

    # Mirrors what Server._serve() normally does internally before
    # calling startup() — required since we're driving the lifecycle
    # by hand instead of calling the usual server.serve().
    if not config.loaded:
        config.load()
    server.lifespan = config.lifespan_class(config)

    await server.startup()
    if server.should_exit:
        return

    port = server.servers[0].sockets[0].getsockname()[1]
    print(f"NEXUS_BACKEND_PORT={port}", flush=True)

    await server.main_loop()
    await server.shutdown()


if __name__ == "__main__":
    import asyncio
    import uvicorn

    asyncio.run(_serve_and_report_port())