"""
Gemini implementation of EmbeddingProvider / CaptioningProvider.

Uses Google's `google-generativeai` package with `models/gemini-embedding-001`
for text embeddings and `gemini-2.5-flash` for vision-based image captioning.
"""

from PIL import Image
import google.generativeai as genai

from .base import CaptioningProvider, EmbeddingProvider

_EMBEDDING_DIMENSIONS = 3072


class GeminiEmbeddingProvider(EmbeddingProvider):
    def __init__(self, api_key: str, model: str = "models/gemini-embedding-001") -> None:
        self.api_key = api_key
        self.model = model if model.startswith("models/") else f"models/{model}"
        self._dimensions = _EMBEDDING_DIMENSIONS
        genai.configure(api_key=self.api_key)

    def embed_text(self, text: str) -> list[float]:
        results = self.embed_batch([text], task_type="retrieval_query")
        return results[0]

    def embed_batch(self, texts: list[str], task_type: str = "retrieval_document") -> list[list[float]]:
        if not texts:
            return []
        try:
            res = genai.embed_content(
                model=self.model,
                content=texts,
                task_type=task_type
            )
        except Exception as exc:
            # Automatic fallback if specific embedding model is unsupported on user's API tier
            if "not found" in str(exc) and self.model != "models/gemini-embedding-001":
                self.model = "models/gemini-embedding-001"
                res = genai.embed_content(
                    model=self.model,
                    content=texts,
                    task_type=task_type
                )
            else:
                raise

        embeddings = res.get("embedding", [])
        if embeddings and isinstance(embeddings[0], float):
            self._dimensions = len(embeddings)
            return [embeddings]
        if embeddings and isinstance(embeddings[0], list):
            self._dimensions = len(embeddings[0])
            return embeddings
        return embeddings

    @property
    def dimensions(self) -> int:
        return self._dimensions


class GeminiCaptioningProvider(CaptioningProvider):
    def __init__(self, api_key: str, model: str = "gemini-2.5-flash") -> None:
        self.api_key = api_key
        self.model = model
        genai.configure(api_key=self.api_key)
        try:
            self._model_client = genai.GenerativeModel(self.model)
        except Exception:
            self.model = "gemini-flash-latest"
            self._model_client = genai.GenerativeModel(self.model)

    def caption_image(self, image_path: str) -> str:
        with Image.open(image_path) as img:
            img_copy = img.copy()

        prompt = (
            "Describe this image in detail, covering any text, objects, people, "
            "and context visible in it. Write it as a dense paragraph suitable "
            "for semantic search indexing, not a bulleted list."
        )
        try:
            response = self._model_client.generate_content([prompt, img_copy])
            return response.text.strip() if response.text else ""
        except Exception as exc:
            if "not found" in str(exc) and self.model != "gemini-flash-latest":
                self.model = "gemini-flash-latest"
                self._model_client = genai.GenerativeModel(self.model)
                response = self._model_client.generate_content([prompt, img_copy])
                return response.text.strip() if response.text else ""
            raise
