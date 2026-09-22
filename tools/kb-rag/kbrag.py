"""Utilidades compartidas del RAG local de la bóveda SmartBancs.

- Lectura de notas Obsidian (frontmatter + cuerpo).
- Chunking por encabezados markdown con límite de tokens y solapamiento.
- Backends de embeddings intercambiables (e5 por defecto, Ollama, hashing de prueba).
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import unicodedata
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import frontmatter

ROOT = Path(__file__).resolve().parents[2]
VAULT = ROOT / "docs" / "knowledge-base"
CHROMA_DIR = Path(__file__).resolve().parent / ".chroma"
COLLECTION = "smartbancs_kb"

# Carpetas indexadas por defecto. El checklist y el MOC se excluyen porque repiten
# el texto de los requisitos y "ganarían" cualquier consulta; 04-Evidencias se
# excluye para no indexar las salidas del propio RAG.
DEFAULT_DIRS = ["02-Referencias", "03-Decisiones"]

MAX_TOKENS = 480   # e5 trunca a 512 tokens: se deja margen para prefijo + título
OVERLAP_TOKENS = 64

HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
FENCE_RE = re.compile(r"^\s*(```|~~~)")


# --------------------------------------------------------------------------- notas
@dataclass
class Note:
    path: Path
    name: str
    meta: dict
    body: str


def load_notes(dirs: list[str] | None = None) -> list[Note]:
    dirs = dirs or DEFAULT_DIRS
    notes: list[Note] = []
    for d in dirs:
        for p in sorted((VAULT / d).rglob("*.md")):
            post = frontmatter.load(p)
            notes.append(Note(p, p.stem, dict(post.metadata), post.content))
    return notes


def as_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value]
    return [s.strip() for s in str(value).split(",") if s.strip()]


def req_key(req_id: str) -> str:
    """'R3.1a' -> 'req_R3_1a' (clave de metadato filtrable en Chroma)."""
    return "req_" + re.sub(r"[^A-Za-z0-9]", "_", req_id)


# ------------------------------------------------------------------------ chunking
@dataclass
class Section:
    heading_path: list[str]
    lines: list[str] = field(default_factory=list)


def split_by_headings(body: str, note_title: str) -> list[Section]:
    """Parte por encabezados (ignorando los '#' dentro de bloques de código)."""
    sections: list[Section] = []
    stack: list[tuple[int, str]] = []
    current = Section([note_title])
    in_fence = False
    for line in body.splitlines():
        if FENCE_RE.match(line):
            in_fence = not in_fence
        m = None if in_fence else HEADING_RE.match(line)
        if m:
            if any(l.strip() for l in current.lines):
                sections.append(current)
            level, text = len(m.group(1)), m.group(2)
            if level == 1:  # título de la nota
                stack = []
                current = Section([note_title])
                continue
            stack = [(lv, t) for lv, t in stack if lv < level] + [(level, text)]
            current = Section([note_title] + [t for _, t in stack])
        else:
            current.lines.append(line)
    if any(l.strip() for l in current.lines):
        sections.append(current)
    return sections


def _blocks(lines: list[str]) -> list[str]:
    """Agrupa en bloques atómicos: párrafos, filas de tabla y bloques de código."""
    blocks, buf, in_fence = [], [], False
    for line in lines:
        if FENCE_RE.match(line):
            in_fence = not in_fence
            buf.append(line)
            if not in_fence:
                blocks.append("\n".join(buf)); buf = []
            continue
        if in_fence:
            buf.append(line); continue
        if not line.strip():
            if buf:
                blocks.append("\n".join(buf)); buf = []
            continue
        # cada ítem de lista / fila de tabla es un bloque propio (mejor corte)
        if re.match(r"^\s*([-*+]|\d+\.|\|)", line) and buf and not re.match(r"^\s*([-*+]|\d+\.|\|)", buf[-1]):
            blocks.append("\n".join(buf)); buf = []
        buf.append(line)
    if buf:
        blocks.append("\n".join(buf))
    return [b for b in blocks if b.strip()]


def chunk_section(sec: Section, count_tokens, max_tokens=MAX_TOKENS, overlap=OVERLAP_TOKENS) -> list[str]:
    header = " > ".join(sec.heading_path)
    budget = max_tokens - count_tokens(header) - 8
    blocks = _blocks(sec.lines)
    # bloques gigantes (p. ej. una tabla enorme) se parten por líneas
    expanded: list[str] = []
    for b in blocks:
        if count_tokens(b) <= budget:
            expanded.append(b)
        else:
            cur: list[str] = []
            for ln in b.splitlines():
                if cur and count_tokens("\n".join(cur + [ln])) > budget:
                    expanded.append("\n".join(cur)); cur = []
                cur.append(ln)
            if cur:
                expanded.append("\n".join(cur))

    chunks, cur, cur_tok = [], [], 0
    for b in expanded:
        t = count_tokens(b)
        if cur and cur_tok + t > budget:
            chunks.append(cur)
            # solapamiento: se arrastran los últimos bloques hasta ~overlap tokens
            tail, tail_tok = [], 0
            for pb in reversed(cur):
                pt = count_tokens(pb)
                if tail_tok + pt > overlap:
                    break
                tail.insert(0, pb); tail_tok += pt
            cur, cur_tok = tail, tail_tok
        cur.append(b); cur_tok += t
    if cur:
        chunks.append(cur)
    return [f"{header}\n" + "\n\n".join(c) for c in chunks]


# ---------------------------------------------------------------------- backends
class Embedder:
    name = "base"
    model = ""

    def count_tokens(self, text: str) -> int:
        # aproximación para backends sin tokenizador local (~1,3 tokens/palabra en español)
        return math.ceil(len(text.split()) * 1.3)

    def embed_passages(self, texts: list[str]) -> list[list[float]]: ...
    def embed_query(self, text: str) -> list[float]: ...


class E5Embedder(Embedder):
    """intfloat/multilingual-e5-small vía sentence-transformers (100 % local tras la descarga)."""
    name = "e5"
    model = "intfloat/multilingual-e5-small"

    def __init__(self):
        from sentence_transformers import SentenceTransformer
        self._m = SentenceTransformer(self.model)
        self._tok = self._m.tokenizer

    def count_tokens(self, text: str) -> int:
        return len(self._tok.encode(text, add_special_tokens=False))

    def embed_passages(self, texts):
        return self._m.encode([f"passage: {t}" for t in texts], normalize_embeddings=True,
                              batch_size=32, show_progress_bar=False).tolist()

    def embed_query(self, text):
        return self._m.encode([f"query: {text}"], normalize_embeddings=True).tolist()[0]


class OllamaEmbedder(Embedder):
    """nomic-embed-text-v2-moe (multilingüe) vía Ollama en localhost."""
    name = "ollama"
    model = os.environ.get("KB_OLLAMA_MODEL", "nomic-embed-text-v2-moe")
    url = os.environ.get("OLLAMA_HOST", "http://localhost:11434") + "/api/embed"

    def _call(self, inputs):
        req = urllib.request.Request(self.url, data=json.dumps({"model": self.model, "input": inputs}).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r:
            vecs = json.load(r)["embeddings"]
        return [_l2norm(v) for v in vecs]

    def embed_passages(self, texts):
        return self._call([f"search_document: {t}" for t in texts])

    def embed_query(self, text):
        return self._call([f"search_query: {text}"])[0]


class HashingEmbedder(Embedder):
    """SOLO para probar el pipeline sin red: bolsa de n-gramas de caracteres con hashing.
    No es semántico; sus resultados no sirven como evidencia de recuperación."""
    name = "test-hashing"
    model = "char-ngram-hashing-768"
    dim = 768

    def _vec(self, text):
        t = unicodedata.normalize("NFKD", text.lower())
        t = "".join(c for c in t if not unicodedata.combining(c))
        v = [0.0] * self.dim
        for w in re.findall(r"\w+", t):
            w = f" {w} "
            for n in (3, 4):
                for i in range(len(w) - n + 1):
                    h = int(hashlib.md5(w[i:i + n].encode()).hexdigest()[:8], 16)
                    v[h % self.dim] += 1.0
        return _l2norm(v)

    def embed_passages(self, texts):
        return [self._vec(t) for t in texts]

    def embed_query(self, text):
        return self._vec(text)


def _l2norm(v):
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


BACKENDS = {"e5": E5Embedder, "ollama": OllamaEmbedder, "test-hashing": HashingEmbedder}


def get_embedder(name: str) -> Embedder:
    if name not in BACKENDS:
        raise SystemExit(f"backend desconocido: {name}. Opciones: {', '.join(BACKENDS)}")
    return BACKENDS[name]()


def get_client():
    import chromadb
    return chromadb.PersistentClient(path=str(CHROMA_DIR))
