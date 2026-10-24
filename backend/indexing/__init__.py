"""
Indexing module — routes a file to the right parser based on its
extension and returns the text chunks extracted from it.
"""

from pathlib import Path

from embeddings.base import CaptioningProvider

from .code.parser import parse as _parse_code
from .docx.parser import parse as _parse_docx
from .images.parser import parse as _parse_image
from .pdf.parser import parse as _parse_pdf
from .pptx.parser import parse as _parse_pptx
from .xlsx.parser import parse as _parse_xlsx

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"}

CODE_EXTENSIONS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".h", ".cpp", ".hpp",
    ".go", ".rs", ".rb", ".php", ".cs", ".sh", ".sql", ".txt", ".md",
    ".json", ".yaml", ".yml", ".toml", ".html", ".css",
}

_EXTENSION_MAP = {
    ".pdf": _parse_pdf,
    ".docx": _parse_docx,
    ".xlsx": _parse_xlsx,
    ".xls": _parse_xlsx,
    ".pptx": _parse_pptx,
}
for _ext in CODE_EXTENSIONS:
    _EXTENSION_MAP[_ext] = _parse_code
for _ext in IMAGE_EXTENSIONS:
    _EXTENSION_MAP[_ext] = _parse_image


def index_file(file_path: str, captioning_provider: CaptioningProvider | None = None) -> list[str]:
    """
    Parse a single file into a list of text chunks, ready for embedding.
    Raises ValueError for unsupported extensions.
    """
    ext = Path(file_path).suffix.lower()
    parser_fn = _EXTENSION_MAP.get(ext)
    if parser_fn is None:
        raise ValueError(f"Unsupported file type: '{ext}'")

    if ext in IMAGE_EXTENSIONS or ext == ".pdf":
        return parser_fn(file_path, captioning_provider=captioning_provider)
    return parser_fn(file_path)