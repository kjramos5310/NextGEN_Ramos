# Segunda revisión con equipo de agentes

Después del análisis de brechas ([ANALISIS_BRECHAS.md](../ANALISIS_BRECHAS.md)) y sus correcciones, el repositorio pasó por una segunda revisión hecha por un equipo de agentes de Claude Code. Cada agente tuvo un rol y un alcance distintos:

| Rol | Alcance | Resultado |
|---|---|---|
| Concurrencia y base de datos | Transacciones, outbox, RabbitMQ, SQL y prueba de integración, con experimentos contra PostgreSQL 16 | [01-concurrencia-bd.md](01-concurrencia-bd.md) (C1–C18) |
| SRE y observabilidad | Logs, métricas, trazabilidad, diagnóstico, compose, Prometheus/Grafana y ai-service | [02-sre-observabilidad.md](02-sre-observabilidad.md) (O1–O22) |
| Coherencia documentación-código | README, documentos de `docs/`, AGENTS/CLAUDE, bitácora y UI contra el código | [03-docs-vs-codigo.md](03-docs-vs-codigo.md) (D1–D59) |
| Diagramador | Diagramas Mermaid derivados del código | [ARQUITECTURA_DIAGRAMAS.md](../ARQUITECTURA_DIAGRAMAS.md), actualizado después de las correcciones |

**Los tres informes describen el código ANTES de la ronda de correcciones.** Los números de línea, los conteos de pruebas (2 unitarias y 4 de integración en ese momento) y los "hallazgos confirmados" se refieren a esa versión. Se conservan sin editar como evidencia del proceso. Los scripts de experimentos que cita el informe 01 (`tmp-concurrency/`) quedaron en el entorno de la revisión y no forman parte del repositorio.

Después vino una ronda de correcciones implementada por Claude Code y validada por el candidato, en tres commits de código:

- `fix(review): correcciones del backend…`
- `fix(ai-service): sin perdida de mensajes…`
- `fix(frontend): la UI solo muestra datos reales`

A esos commits se suma la actualización de la documentación de la misma ronda (README, diagramas, estos informes, análisis de brechas y declaración de uso de IA). Resultado verificado tras las correcciones: backend `npm test` 31/31, `npm run test:int` 12/12 contra PostgreSQL 16 y ai-service `pytest` 16/16.

## Estado de los hallazgos de severidad ALTA

En la columna Commit, "backend", "ai-service" y "frontend" se refieren a los tres commits anteriores. "Docs" es la actualización de documentación de esta ronda.

| ID | Hallazgo | Estado | Dónde | Commit |
|---|---|---|---|---|
| C1 | Montos con más de 2 decimales y aritmética en `float` creaban centavos | Corregido. El DTO rechaza más de 2 decimales, booleanos y montos fuera de 0.01–1 000 000. Débito y crédito se calculan en `NUMERIC` dentro de PostgreSQL (`UPDATE ... WHERE balance >= $1`). Pruebas de integración de centavos. | `create-transaction.dto.ts`, `transactions.service.ts`, `concurrency.int-spec.ts` | backend |
| C2 / D1 | CORS no permitía `Idempotency-Key`: las transferencias desde la UI fallaban | Corregido. `allowedHeaders` incluye `Idempotency-Key` y se expone `x-correlation-id`. | `backend/src/main.ts` | backend |
| C3 | `DB_SYNCHRONIZE=true` en `backend/.env.example` borraba índices únicos y CHECKs | Corregido en la configuración: `DB_SYNCHRONIZE=false` en ambos `.env.example`, y el código solo activa `synchronize` con el string `"true"`. Pendiente: las entidades TypeORM siguen sin declarar los índices parciales, los CHECK ni los nombres de enum del DDL, así que activar `synchronize` seguiría siendo destructivo. El esquema lo define `backend/sql/schema.sql`. | `backend/.env.example`, `.env.example`, `app.module.ts` | backend |
| C4 / O14 / D4 | El relay marcaba `published_at` sin confirmación del broker | Corregido. Canal de confirmación (`createConfirmChannel`), `published_at` solo con ack, un `UPDATE ... WHERE id = ANY($1)` por lote, timeout de confirmación de 5 s. | `rabbitmq.service.ts`, `outbox-relay.service.ts` | backend |
| O1 | El consumidor de IA hacía ack aunque el backend fallara: la recomendación se perdía | Corregido. `ack` solo con 2xx o 409. Errores transitorios: 3 intentos del POST. Agotados, 4xx o mensaje inválido: `nack` sin requeue hacia `smartbancs.dlx` → `smartbancs.ai.dlq`. La topología se declara igual en backend y ai-service. | `ai-service/consumer.py`, `rabbitmq.service.ts`, `ai-service/tests/test_consumer.py` | ai-service, backend |
| O2 / D5 | La reconexión a RabbitMQ se rendía tras 5 intentos | Corregido. Reconexión indefinida con backoff exponencial (tope 30 s) tras un fallo o un `close` de conexión o canal, sin bloquear el arranque. RabbitMQ tiene healthcheck y el backend espera `service_healthy`. La prueba de "broker caído" usa un stub de RabbitMQ, y así se declara en el README. | `rabbitmq.service.ts`, `docker-compose.yml` | backend |
| D2 | `.env.example` y el documento técnico citaban modelos Gemini desactualizados | Corregido: `.env.example` usa `gemini-2.5-flash`, igual que `docker-compose.yml` y `advisor.py`; el documento técnico cita `GEMINI_MODEL` con ese valor por defecto. | `.env.example`, `DOCUMENTO_TECNICO.md` | fix(review), docs |
| D3 | El README no bastaba para alguien sin contexto | Corregido. Prerrequisitos de Node y Python, `cp .env.example .env`, `GEMINI_API_KEY` opcional, `check_gemini.py`, prueba con curl, comandos de prueba y ETL, datos de prueba. | `README.md` | docs |
| D6 | La imagen PNG de arquitectura estaba desactualizada y mostraba un aviso de PlantUML | Corregido. Imagen eliminada del repositorio. El README embebe un diagrama Mermaid y enlaza a `ARQUITECTURA_DIAGRAMAS.md`. | `README.md`, `docs/ARQUITECTURA_DIAGRAMAS.md` | docs |
| D7, D11, D13 | `DOCUMENTO_TECNICO.md`: "emite un evento a RabbitMQ", timeout de 4.5 s, PSI y umbral 0.50 presentados como implementados | Corregido en la reescritura de `DOCUMENTO_TECNICO.md` de esta ronda (outbox, timeout de 10 s, drift como diseño). En código, `/model-info` ya no reporta umbral ni drift inventados. | `DOCUMENTO_TECNICO.md`, `ai-service/main.py` | docs, ai-service |
| D8 | UI: "fire-and-forget" | Corregido: la UI describe el Transactional Outbox. | `frontend/src/App.tsx` | frontend |
| D9 | Consola de incidente con "0 deadlocks" y "100 % ACID" fijos; `healthStatus` siempre `HEALTHY` | Corregido. La UI muestra solo valores de la respuesta de la simulación. `db-diagnostics` usa `pg_blocking_pids` y calcula `HEALTHY`/`DEGRADED`/`CRITICAL`. | `OperationsIncidentConsole.tsx`, `simulation.service.ts` | frontend, backend |
| D10 | "Motor: Gemini" fijo en cada recomendación | Corregido. El ai-service guarda `metadata.engine` y la UI muestra el motor real de cada recomendación. | `consumer.py`, `frontend/src/utils/aiEngine.ts` | ai-service, frontend |
| D12, D14 | `IA_IMPLEMENTACION_Y_DESPLIEGUE.md`: versión y drift de `/model-info`, ETL con anonimización y caché | Código corregido: `/model-info` expone `v2.5.0-gemini-hybrid` y `dataDriftStatus: "not_implemented"`. El documento se reescribió en esta ronda: separa lo implementado del diseño y aclara que el ETL no anonimiza. | `ai-service/main.py`, `IA_IMPLEMENTACION_Y_DESPLIEGUE.md` | ai-service, docs |
| D15 | `AI_DISCLOSURE.md` omite OpenCode | No aplicado. El uso de OpenCode no está confirmado, así que no se declara. `AGENTS.md` y `CLAUDE.md` lo mencionan como agente previsto. | — | — |
| D16 | Autoría de las notas de la bóveda atribuida al candidato | Corregido. Las notas se declaran redactadas por Claude con búsqueda web a partir del checklist del candidato; siguen en `estado: borrador`. | `docs/AI_DISCLOSURE.md` | docs |
| D17 | Narrativa contradictoria: bóveda "antes de escribir código" | Corregido. El MOC dice que la bóveda se construyó después de la primera versión del MVP; `AGENTS.md`, `CLAUDE.md` y la bitácora reflejan el estado de las fases. | `00-MOC.md`, `AGENTS.md`, `CLAUDE.md`, `bitacora.md` | docs |
| D18 | "Un commit por brecha" | Corregido: "commits por brecha o grupo de brechas". | `docs/AI_DISCLOSURE.md` | docs |
| D19 | Las brechas "fueron corregidas por el candidato" | Corregido: implementadas por Claude Code y validadas por el candidato. | `docs/AI_DISCLOSURE.md` | docs |

## Pendientes conocidos de severidad MEDIA o BAJA

Verificados contra el código actual y sin corregir en esta ronda:

- **Bancs:** `smartbancs.bancs.sync.queue` no tiene consumidor, DLX ni `x-max-length` (C17, O18). El worker con rate limiting sigue siendo diseño (G8).
- **Outbox:** no hay purga ni partición de `outbox_events` (C12), y el orden de publicación es por `created_at`, no por orden de commit (C11).
- **Alertas:** `docker/prometheus/prometheus.yml` no tiene `rule_files`; las alertas del documento técnico son propuestas (O5). El dashboard de Grafana tiene dos paneles (O12).
- **ai-service:** no expone `/metrics` (O10) y sus logs son texto con `corrId`, `txId` y `eventId`, no JSON (O8).
- **UI:** `App.tsx` todavía dice "Prevención matemática de deadlocks" (D28).
- **Proceso:** `docs/knowledge-base/03-Decisiones/` no tiene ADR (D32), y el video y la presentación de E4 no están en el repositorio (G9).
