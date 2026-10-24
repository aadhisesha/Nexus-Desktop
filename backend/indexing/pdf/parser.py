"""
PDF parser — extracts digital text with `pypdf`, chunks it, and falls back
to OCR / visual captioning for scanned / image-based PDFs using `captioning_provider`.
"""

import os
import tempfile
from pathlib import Path
from pypdf import PdfReader

from embeddings.base import CaptioningProvider
from ..chunking import chunk_text


def parse(file_path: str, captioning_provider: CaptioningProvider | None = None) -> list[str]:
    reader = PdfReader(file_path)
    pages_text = []
    for page in reader.pages:
        text = page.extract_text() or ""
        if text.strip():
            pages_text.append(text.strip())

    full_text = "\n\n".join(pages_text)

    # 1. If the PDF has digital text, chunk and return it
    if len(full_text.strip()) > 30:
        return chunk_text(full_text)

    # 2. Scanned / image-only PDF fallback: extract visually via captioning_provider
    extracted_captions = []
    if captioning_provider is not None:
        # Option A: Render pages to images using pypdfium2 (lazy import to keep app startup instant)
        try:
            import pypdfium2 as pdfium
        except ImportError:
            pdfium = None

        if pdfium is not None:
            try:
                pdf_doc = pdfium.PdfDocument(file_path)
                max_pages = min(len(pdf_doc), 10)  # Render up to 10 pages
                for page_idx in range(max_pages):
                    page = pdf_doc[page_idx]
                    pil_img = page.render(scale=2).to_pil()
                    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp_file:
                        tmp_path = tmp_file.name
                        pil_img.save(tmp_path, format="PNG")
                    try:
                        caption = captioning_provider.caption_image(tmp_path)
                        if caption and caption.strip():
                            extracted_captions.append(f"[Page {page_idx + 1}]: {caption.strip()}")
                    finally:
                        if os.path.exists(tmp_path):
                            os.remove(tmp_path)
            except Exception as exc:
                print(f"pypdfium2 rendering failed for {file_path}: {exc}")

        # Option B: Fallback to embedded images extracted via pypdf
        if not extracted_captions:
            try:
                for page_idx, page in enumerate(reader.pages[:10]):
                    for img_file in page.images:
                        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp_file:
                            tmp_path = tmp_file.name
                            tmp_file.write(img_file.data)
                        try:
                            caption = captioning_provider.caption_image(tmp_path)
                            if caption and caption.strip():
                                extracted_captions.append(f"[Page {page_idx + 1} Image]: {caption.strip()}")
                        finally:
                            if os.path.exists(tmp_path):
                                os.remove(tmp_path)
            except Exception as exc:
                print(f"pypdf image extraction failed for {file_path}: {exc}")

    if extracted_captions:
        combined = "\n\n".join(extracted_captions)
        # Prepend filename context so the file is strongly associated with its name
        doc_header = f"File: {Path(file_path).name}\n"
        return chunk_text(doc_header + combined)

    # 3. If there is some short digital text, return it
    if full_text.strip():
        doc_header = f"File: {Path(file_path).name}\n"
        return chunk_text(doc_header + full_text)

    # 4. Ultimate safety fallback: guarantee that the file is indexed and searchable by its name & keywords
    fname_terms = Path(file_path).stem.replace("_", " ").replace("-", " ")
    return [f"File: {Path(file_path).name}\nDocument title: {fname_terms}"]
