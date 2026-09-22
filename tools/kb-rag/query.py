#!/usr/bin/env python
"""Consulta la bóveda indexada.

Uso:
    python query.py "¿cómo evito deadlocks entre dos transferencias?" -k 5
    python query.py "reintentos" -k 3 --req R3.5c      # solo notas mapeadas a R3.5c
    python query.py "outbox" --json                    # salida para otros scripts
"""
from __future__ import annotations

import argparse
import json
import sys

# Windows cp1252 consoles can't encode some Unicode chars (→, ›, …).
# Reconfigure stdout to UTF-8 with replacement to avoid UnicodeEncodeError.
if sys.stdout.encoding and sys.stdout.encoding.lower().replace("-", "") != "utf8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from kbrag import COLLECTION, get_client, get_embedder, req_key


def search(question: str, k: int = 5, req: str | None = None):
    client = get_client()
    try:
        col = client.get_collection(COLLECTION)
    except Exception:
        raise SystemExit("No hay índice. Ejecuta primero: python ingest.py")
    backend = (col.metadata or {}).get("backend", "e5")
    emb = get_embedder(backend)  # siempre el mismo backend con el que se indexó
    res = col.query(query_embeddings=[emb.embed_query(question)], n_results=k,
                    where={req_key(req): True} if req else None,
                    include=["documents", "metadatas", "distances"])
    hits = []
    for doc, meta, dist in zip(res["documents"][0], res["metadatas"][0], res["distances"][0]):
        hits.append({"score": round(1 - dist, 4),  # similitud coseno
                     "nota": meta["nota"], "encabezado": meta["encabezado"],
                     "requisitos": meta["requisitos"], "fuentes": meta["fuentes"],
                     "texto": doc})
    return hits, col.metadata


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pregunta")
    ap.add_argument("-k", type=int, default=5)
    ap.add_argument("--req", help="filtrar por ID de requisito (p. ej. R3.1e)")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--chars", type=int, default=400, help="caracteres de texto a mostrar")
    a = ap.parse_args()

    hits, meta = search(a.pregunta, a.k, a.req)
    if a.json:
        json.dump({"pregunta": a.pregunta, "indice": meta, "resultados": hits}, sys.stdout,
                  ensure_ascii=False, indent=2)
        return
    print(f"Pregunta: {a.pregunta}   [backend: {meta.get('backend')} / {meta.get('model')}]\n")
    for i, h in enumerate(hits, 1):
        snippet = h["texto"].split("\n", 1)[-1].strip().replace("\n", " ")
        print(f"{i}. score {h['score']:.3f} | [[{h['nota']}]] › {h['encabezado']}")
        print(f"   requisitos: {h['requisitos']}")
        print(f"   {snippet[:a.chars]}{'…' if len(snippet) > a.chars else ''}\n")


if __name__ == "__main__":
    main()
