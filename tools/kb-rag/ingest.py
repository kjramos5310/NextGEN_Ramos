#!/usr/bin/env python
"""Indexa la bóveda Obsidian en ChromaDB.

Uso:
    python ingest.py                      # backend e5 (por defecto), reindexa desde cero
    python ingest.py --backend ollama     # nomic-embed-text-v2-moe vía Ollama
    python ingest.py --dirs 02-Referencias 03-Decisiones 01-Requisitos
"""
from __future__ import annotations

import argparse
import hashlib
import time
from collections import Counter

from kbrag import (COLLECTION, DEFAULT_DIRS, MAX_TOKENS, OVERLAP_TOKENS, as_list,
                   chunk_section, get_client, get_embedder, load_notes, req_key,
                   split_by_headings)


def build_chunks(embedder, dirs):
    records = []
    for note in load_notes(dirs):
        reqs = as_list(note.meta.get("requisitos"))
        fuentes = as_list(note.meta.get("fuentes"))
        tags = as_list(note.meta.get("tags"))
        rel = note.path.relative_to(note.path.parents[2]).as_posix()
        for sec in split_by_headings(note.body, note.name):
            for i, text in enumerate(chunk_section(sec, embedder.count_tokens)):
                heading = " > ".join(sec.heading_path[1:]) or "(intro)"
                meta = {
                    "nota": note.name,
                    "ruta": rel,
                    "encabezado": heading,
                    "requisitos": ",".join(reqs),
                    "fuentes": " ".join(fuentes),
                    "tags": ",".join(tags),
                    "estado": str(note.meta.get("estado", "")),
                    "parte": i,
                    "tokens": embedder.count_tokens(text),
                }
                for r in reqs:  # permite filtrar: where={"req_R3_1e": True}
                    meta[req_key(r)] = True
                cid = hashlib.sha1(f"{rel}|{heading}|{i}".encode()).hexdigest()
                records.append((cid, text, meta))
    return records


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--backend", default="e5", help="e5 | ollama | test-hashing")
    ap.add_argument("--dirs", nargs="+", default=DEFAULT_DIRS, help="subcarpetas de la bóveda a indexar")
    args = ap.parse_args()

    t0 = time.time()
    emb = get_embedder(args.backend)
    records = build_chunks(emb, args.dirs)
    if not records:
        raise SystemExit("No se encontraron notas para indexar.")

    client = get_client()
    try:
        client.delete_collection(COLLECTION)  # reindexado completo e idempotente
    except Exception:
        pass
    col = client.create_collection(
        COLLECTION,
        configuration={"hnsw": {"space": "cosine"}},
        metadata={"backend": emb.name, "model": emb.model, "dirs": ",".join(args.dirs),
                  "max_tokens": MAX_TOKENS, "overlap_tokens": OVERLAP_TOKENS},
    )
    ids, docs, metas = zip(*records)
    vecs = emb.embed_passages(list(docs))
    for s in range(0, len(ids), 256):
        col.add(ids=list(ids[s:s + 256]), documents=list(docs[s:s + 256]),
                metadatas=list(metas[s:s + 256]), embeddings=vecs[s:s + 256])

    per_note = Counter(m["nota"] for m in metas)
    toks = [m["tokens"] for m in metas]
    print(f"Backend: {emb.name} ({emb.model})")
    print(f"Notas: {len(per_note)} | chunks: {len(ids)} | tokens/chunk: "
          f"min {min(toks)}, media {sum(toks)//len(toks)}, máx {max(toks)} (límite {MAX_TOKENS})")
    for n, c in sorted(per_note.items()):
        print(f"  {c:3d}  {n}")
    print(f"Listo en {time.time() - t0:.1f}s -> colección '{COLLECTION}'")


if __name__ == "__main__":
    main()
