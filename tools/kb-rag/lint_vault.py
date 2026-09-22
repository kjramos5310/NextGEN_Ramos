#!/usr/bin/env python
"""Valida la bóveda: wikilinks rotos, frontmatter, IDs de requisito, orden de secciones
y cobertura por requisito. Sale con código 1 si hay errores (útil en CI / pre-commit).

Uso:  python lint_vault.py [--cobertura]
"""
from __future__ import annotations

import argparse
import re
import sys

import frontmatter

from kbrag import VAULT, as_list

SECTIONS = ["Qué es", "Problema que resuelve", "Cómo se implementa", "Trade-offs",
            "Aplicación a SmartBancs", "Preguntas que podría hacer el jurado"]
REQUIRED_FM = ["tags", "requisitos", "fuentes", "estado"]
ESTADOS = {"borrador", "revisada"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cobertura", action="store_true", help="imprime notas por requisito")
    a = ap.parse_args()

    files = [p for p in VAULT.rglob("*.md") if ".obsidian" not in p.parts]
    names = {p.stem for p in files}
    checklist = (VAULT / "01-Requisitos" / "Reto TCS - Checklist.md").read_text(encoding="utf-8")
    ids = re.findall(r"\*\*((?:R3\.\d[a-z])|RNF-\d|E\d)\*\*", checklist)
    errors, cover = [], {i: [] for i in ids}

    for p in sorted(files):
        rel = p.relative_to(VAULT).as_posix()
        post = frontmatter.load(p)
        for link in re.findall(r"\[\[([^\]|#]+)", post.content):
            if link.strip() not in names:
                errors.append(f"{rel}: wikilink roto [[{link}]]")
        if not rel.startswith("02-Referencias/"):
            continue
        for k in REQUIRED_FM:
            if k not in post.metadata:
                errors.append(f"{rel}: falta '{k}' en frontmatter")
        if post.metadata.get("estado") not in ESTADOS:
            errors.append(f"{rel}: estado inválido '{post.metadata.get('estado')}'")
        for url in as_list(post.metadata.get("fuentes")):
            if not url.startswith("https://"):
                errors.append(f"{rel}: fuente no es URL https: {url}")
        for r in as_list(post.metadata.get("requisitos")):
            if r not in cover:
                errors.append(f"{rel}: requisito desconocido '{r}'")
            else:
                cover[r].append(p.stem)
        heads = re.findall(r"^## (.+?)\s*$", post.content, re.M)
        if heads != SECTIONS:
            errors.append(f"{rel}: secciones {heads} != {SECTIONS}")

    if a.cobertura:
        for r in ids:
            print(f"{r:6} {len(cover[r])}  {', '.join(cover[r])}")
    sin = [r for r in ids if not cover[r]]
    print(f"\n{len(files)} archivos, {len(ids)} requisitos, sin cobertura: {', '.join(sin) or 'ninguno'}")
    for e in errors:
        print("ERROR", e)
    print("OK" if not errors else f"{len(errors)} error(es)")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
