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
| Evidencia con e5 | Pendiente: OpenCode en la PC del autor (prompt OC-1) | El entorno de Claude no tenía acceso a Hugging Face para descargar el modelo |

## Pendiente del autor
- Leer y corregir cada nota → `estado: revisada`.
- Ejecutar OC-1 para generar `04-Evidencias/retrieval-smoke-test.md` con e5.
