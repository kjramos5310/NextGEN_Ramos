# Bitácora del proceso

Registro de cómo se construyó cada entregable y con qué herramienta. Alimenta la **declaración de uso de IA** (E5).

## Fase 1: base de conocimiento (2026-09-22)
| Paso | Herramienta | Detalle |
|---|---|---|
| Lectura del reto | Claude (pandoc) | `.docx` → `docs/reto/reto-original.md`, texto literal |
| Checklist con IDs | Claude + revisión del autor | 47 ítems (36 R3.x, 5 RNF, 6 E). El autor aprobó el checklist antes de iniciar la investigación |
| Investigación | Claude (búsqueda web) | Solo fuentes primarias u oficiales (PostgreSQL, Debezium, microservices.io, Google SRE, Stripe, OpenTelemetry, W3C, Prometheus, RabbitMQ, PgBouncer, Microsoft Azure Architecture Center, AWS, Google Cloud, Evidently, OWASP, Kubernetes). **Cada URL citada se abrió y leyó**; se descartaron las URLs que no se pudieron abrir |
| Notas de referencia | Claude | 12 notas en `02-Referencias/`, todas en `estado: borrador` hasta la revisión del autor |
| Validación | `tools/kb-rag/lint_vault.py` | Wikilinks, frontmatter, IDs, orden de secciones y cobertura |

## Fase 2: RAG local (2026-09-22)
| Paso | Herramienta | Detalle |
|---|---|---|
| Diseño e implementación | Claude | `kbrag.py`, `ingest.py`, `query.py`, `smoke_test.py` |
| Prueba del pipeline | Claude, backend `test-hashing` | 12 notas → 79 fragmentos (≤ 480 tokens). Valida chunking, metadatos, Chroma y consultas. **No es evidencia semántica** |
| Evidencia con e5 | `tools/kb-rag/smoke_test.py` fuera del entorno de Claude | El entorno de Claude no tenía acceso a Hugging Face para descargar el modelo. Resultado en `04-Evidencias/retrieval-smoke-test.md`: backend `e5`, hit@5 = 37/41 (90 %) |

## Fase 3: análisis de brechas
| Paso | Herramienta | Detalle |
|---|---|---|
| Retrieve + comparación con el código | Claude Code + RAG local | `docs/ANALISIS_BRECHAS.md`: brechas G1–G10 con evidencia `archivo:línea` |

## Fase 4: correcciones por brecha
| Paso | Herramienta | Detalle |
|---|---|---|
| Implementación | Claude Code | Commits con el ID de la brecha (G1–G4, G6, G7, G10); estado en la sección 4 de `ANALISIS_BRECHAS.md` |
| Validación | Candidato | Ejecución de pruebas y revisión de diffs |

## Fase 5: segunda revisión con equipo de agentes
| Paso | Herramienta | Detalle |
|---|---|---|
| Revisión | Claude Code, equipo de agentes | Roles de concurrencia/BD, SRE/observabilidad, coherencia docs-código y diagramador. Informes en `docs/revision/` |
| Correcciones | Claude Code, validadas por el candidato | Commits `fix(review): correcciones del backend…`, `fix(ai-service): sin perdida de mensajes…`, `fix(frontend): la UI solo muestra datos reales`, más la actualización de la documentación |
| Diagramas | Claude Code (diagramador) + mermaid-cli | `docs/ARQUITECTURA_DIAGRAMAS.md`, validados con `mmdc`; la sección "Entrada para Archify" alimenta Archify |

## Pendiente del autor
- Leer y corregir cada nota → `estado: revisada`.
- Video demostrativo y material de presentación (E4, G9).
