#!/usr/bin/env python
"""Prueba de humo del RAG: una consulta por requisito del checklist.

Para cada ítem del checklist usa su texto como consulta, recupera top-k y verifica
si algún fragmento proviene de una nota cuyo frontmatter `requisitos:` incluye ese ID
(hit@k). Escribe el resultado en docs/knowledge-base/04-Evidencias/retrieval-smoke-test.md.

Uso:
    python ingest.py && python smoke_test.py -k 5
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
import subprocess
from collections import defaultdict
from pathlib import Path

from kbrag import ROOT, VAULT, as_list, load_notes
from query import search

CHECKLIST = VAULT / "01-Requisitos" / "Reto TCS - Checklist.md"
OUT = VAULT / "04-Evidencias" / "retrieval-smoke-test.md"
ITEM_RE = re.compile(r"^- \[[ x]\] \*\*(?P<id>[A-Z0-9.\-]+[a-z]?)\*\*\s*(?:\((?P<tipo>[PT])\)\s*)?(?P<txt>.+)$")


def parse_checklist():
    items, section = [], ""
    for line in CHECKLIST.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            section = line[3:].strip()
        m = ITEM_RE.match(line.strip())
        if m:
            items.append({"id": m["id"], "texto": m["txt"].strip(), "seccion": section})
    return items


def git_rev():
    try:
        return subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"], text=True).strip()
    except Exception:
        return "n/d"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-k", type=int, default=5)
    ap.add_argument("--out", type=Path, default=OUT)
    a = ap.parse_args()

    mapped = defaultdict(set)
    for n in load_notes():
        for r in as_list(n.meta.get("requisitos")):
            mapped[r].add(n.name)

    items = parse_checklist()
    rows, details, meta = [], [], None
    hits_ok = evaluable = 0
    for it in items:
        hits, meta = search(it["texto"], a.k)
        expected = mapped.get(it["id"], set())
        got = [h["nota"] for h in hits]
        rank = next((i for i, n in enumerate(got, 1) if n in expected), None)
        if expected:
            evaluable += 1
            hits_ok += rank is not None
            verdict = f"✅ @{rank}" if rank else "❌"
        else:
            verdict = "— sin nota mapeada"
        top = hits[0]
        rows.append(f"| {it['id']} | {verdict} | {top['score']:.3f} | [[{top['nota']}]] › {top['encabezado']} |")
        det = [f"### {it['id']} — {it['texto']}",
               f"Notas mapeadas: {', '.join(sorted(expected)) or '(ninguna)'}", "",
               "| # | score | nota › encabezado | ¿mapeada? |", "|---|---|---|---|"]
        for i, h in enumerate(hits, 1):
            det.append(f"| {i} | {h['score']:.3f} | [[{h['nota']}]] › {h['encabezado']} | "
                       f"{'sí' if h['nota'] in expected else ''} |")
        details.append("\n".join(det))

    backend = meta.get("backend")
    if backend == "test-hashing" and a.out == OUT:
        raise SystemExit("El backend test-hashing no es semántico: usa --out a otra ruta; "
                         "la evidencia oficial se genera con e5 u ollama.")

    now = dt.datetime.now().astimezone().isoformat(timespec="seconds")
    header = f"""---
tags: [evidencia, rag]
generado: {now}
backend: {backend}
modelo: {meta.get('model')}
commit: {git_rev()}
k: {a.k}
---

# Prueba de humo de recuperación (RAG)

Archivo generado por `tools/kb-rag/smoke_test.py`; **no se edita a mano**. Hay una consulta por requisito del
[[Reto TCS - Checklist]], y la consulta es el texto literal del ítem. **hit@{a.k}** = algún fragmento del top-{a.k}
viene de una nota que declara ese requisito en su frontmatter.

- Índice: `{meta.get('dirs')}` · chunk ≤ {meta.get('max_tokens')} tokens, solapamiento {meta.get('overlap_tokens')}
- **hit@{a.k}: {hits_ok}/{evaluable} requisitos evaluables ({100*hits_ok/max(evaluable,1):.0f} %)**
- Requisitos sin nota mapeada: {sum(1 for it in items if not mapped.get(it['id']))} (brecha de cobertura; ver resumen)

## Resumen

| Req | hit@{a.k} | score top-1 | top-1 |
|---|---|---|---|
"""
    body = header + "\n".join(rows) + "\n\n## Detalle por requisito\n\n" + "\n\n".join(details) + "\n"
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(body, encoding="utf-8")
    print(f"hit@{a.k}: {hits_ok}/{evaluable} -> {a.out}")


if __name__ == "__main__":
    main()
