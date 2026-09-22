# CLAUDE.md

Claude Code: este archivo contiene el mismo contexto que `AGENTS.md` (que lee OpenCode). Si cambias uno, actualiza el otro.

## División de trabajo
- **Claude**: investigación en fuentes primarias, contenido técnico de las notas, criterio de diseño, análisis de brechas (fase 3), ADR y revisión.
- **OpenCode (modelo barato/local)**: tareas mecánicas como esqueletos, normalización de frontmatter y wikilinks, requirements/README y ejecución de scripts con formateo de salidas.

## Flujo de fase 3 (retrieve)
Antes de afirmar algo sobre una referencia, consulta la bóveda con
`python tools/kb-rag/query.py "<pregunta>" -k 5` y cita la nota de origen. Compara siempre contra los IDs del checklist.

---

Contexto para agentes de código (OpenCode, Claude Code u otros). Léelo completo antes de actuar.

## Proyecto
Reto técnico "SmartBancs App": una plataforma de transacciones en tiempo real con recomendaciones de IA que se integra con un core legado ("Bancs"). El enunciado literal está en `docs/reto/reto-original.md`. Los requisitos con ID (R3.1a…R3.6d, RNF-1…5, E1…E6) están en `docs/knowledge-base/01-Requisitos/Reto TCS - Checklist.md`.

Restricciones clave: picos de 10 000 TPS, transferencias < 2 s, la IA nunca bloquea el flujo transaccional y Bancs no tolera alto volumen de consultas directas.

## Proceso (fases)
1. Base de conocimiento en Obsidian (`docs/knowledge-base/`) — **hecha en borrador**
2. RAG local sobre la bóveda (`tools/kb-rag/`) — **implementada; falta generar la evidencia con e5 en la PC del autor**
3. Retrieve + análisis de brechas + diseño del MVP (ADR en `03-Decisiones/`)
4. Construcción del MVP a partir de las brechas
5. Revisión con equipo de agentes + diagramas (Mermaid, Archify)

**No escribas código de la aplicación (backend, IA, ETL) hasta la fase 4.**

## Estructura
```
docs/reto/reto-original.md            enunciado literal
docs/knowledge-base/                  bóveda Obsidian
  00-MOC.md                           mapa de contenido
  01-Requisitos/Reto TCS - Checklist.md
  02-Referencias/*.md                 una nota por tema
  03-Decisiones/                      ADR (fase 3+)
  04-Evidencias/                      salidas de pruebas (retrieval, carga, etc.)
tools/kb-rag/                         ingest.py, query.py, smoke_test.py, lint_vault.py
docs/proceso/                         bitácora del proceso y prompts (OpenCode, fase 3)
```

## Reglas para notas de la bóveda
- Idioma español; conciso, sin relleno.
- Frontmatter obligatorio en `02-Referencias/`:
  ```yaml
  ---
  tags: [ ... ]
  requisitos: [R3.1e, RNF-1]
  fuentes:
    - https://...
  estado: borrador        # borrador | revisada (solo el autor humano pasa a revisada)
  ---
  ```
- Secciones en este orden: `## Qué es`, `## Problema que resuelve`, `## Cómo se implementa`, `## Trade-offs`, `## Aplicación a SmartBancs`, `## Preguntas que podría hacer el jurado`.
- Enlaces internos con `[[Nombre de nota]]` (nombre de archivo sin `.md`). Todo wikilink debe resolver a un archivo existente.
- Los IDs de requisitos deben existir en el checklist.
- **Nunca inventes URLs.** Si no puedes verificar una fuente, no la agregues; déjalo anotado como `TODO fuente`.
- No cambies `estado: borrador` a `revisada`. Eso lo hace el autor.
- No reescribas contenido técnico; los agentes de bajo costo solo hacen tareas mecánicas (formato, enlaces, ejecución de scripts).

## RAG (`tools/kb-rag`)
```bash
cd tools/kb-rag
python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python ingest.py                 # reindexa la bóveda completa (borra y recrea la colección)
python query.py "pregunta" -k 5
python smoke_test.py             # regenera 04-Evidencias/retrieval-smoke-test.md
python lint_vault.py --cobertura # valida wikilinks, frontmatter, secciones e IDs
```
Hay que reindexar después de cualquier cambio en la bóveda.

## Git
- Commits pequeños con Conventional Commits: `docs(kb): ...`, `feat(rag): ...`, `chore: ...`, `test(rag): ...`.
- Un commit por paso lógico (una nota, un script). No hagas squash del historial: el historial es evidencia del proceso.
- No hagas commit de `.venv/`, `tools/kb-rag/.chroma/` ni de cachés de modelos.
