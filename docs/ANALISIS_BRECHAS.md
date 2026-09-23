---
tags: [analisis, brechas]
fase: 3
estado: borrador
---

# Análisis de brechas: arquitectura implementada vs. referencias

Comparación del MVP (`backend/`, `ai-service/`, `etl-bancs/`, `docker-compose.yml`) contra el
[[Reto TCS - Checklist]] y las notas de `docs/knowledge-base/02-Referencias/`, recuperadas con el
RAG local (`tools/kb-rag`, modelo `intfloat/multilingual-e5-small`; evidencia en
`04-Evidencias/retrieval-smoke-test.md`, hit@5 = 90 %).

Leyenda: **✅** cumple · **⚠️** parcial · **❌** brecha.

## 1. Resumen por requisito

La columna "Antes" es la foto del MVP v1 cuando se hizo este análisis; las referencias `archivo:línea` de esa columna y de la sección 2 apuntan a esa versión, no al código actual. La columna "Ahora" resume el estado después de las correcciones de la sección 4 y de la segunda revisión (sección 5).

| Req | Antes | Evidencia en el código (MVP v1) | Ahora |
|---|---|---|---|
| R3.1a Endpoint transaccional | ✅ | `backend/src/modules/transactions/transactions.controller.ts` | ✅ con `Idempotency-Key` y validación de montos (máx. 2 decimales) |
| R3.1b DDL | ✅ | `backend/sql/schema.sql` (CHECK de saldo ≥ 0, `NUMERIC(18,2)`, índices) | ✅ + `outbox_events` e índice único de idempotencia |
| R3.1c DML semilla | ✅ | `backend/sql/seed.sql`, `backend/src/database/seeds/seed.service.ts` | ✅ |
| R3.1d Interacción real con BD | ✅ | TypeORM + `queryRunner` en `transactions.service.ts` | ✅ débito y crédito en `NUMERIC` dentro de PostgreSQL |
| R3.1e Concurrencia sin race conditions | ⚠️ | Lock pesimista ordenado (`transactions.service.ts:50-70`), pero sin prueba automatizada de concurrencia (ver **G4**) | ✅ `npm run test:int` (12 pruebas contra PostgreSQL real) |
| R3.1f IaC un comando | ✅ | `docker-compose.yml` (7 servicios, healthchecks, `depends_on`) | ✅ healthchecks en PostgreSQL y RabbitMQ; el backend espera `service_healthy` |
| R3.2a/b Estrategia Bancs | ⚠️ | Documentada; el patrón Outbox está **declarado pero no implementado** (ver **G1**) | ⚠️ Outbox implementado con *publisher confirms*; el worker hacia Bancs sigue en diseño (**G8**) |
| R3.2c–f ETL | ✅ | `etl-bancs/etl_bancs_processor.py` (nulos, fechas, feature engineering, salida JSON) | ✅ |
| R3.3a Servicio IA independiente | ✅ | `ai-service/` (FastAPI + consumidor RabbitMQ) | ✅ |
| R3.3b/c Consumo asíncrono | ⚠️ | No bloqueante (`transactions.service.ts:132`), pero con riesgo de pérdida de evento (**G1**) | ✅ outbox + ack solo tras persistir, 3 intentos y DLQ `smartbancs.ai.dlq` |
| R3.3d–f MLOps teórico | ✅ | `docs/IA_IMPLEMENTACION_Y_DESPLIEGUE.md` | ✅ (diseño) |
| R3.4a–c Logs críticos | ✅ | `common/logger/logger.service.ts`, interceptor de logging | ✅ JSON en producción; ai-service con `corrId`/`txId`/`eventId` en cada línea |
| R3.4d Log de interacciones con BD | ⚠️ | `DB_LOGGING` está en `false` por defecto (`app.module.ts:40`); no hay log de consultas lentas (**G7**) | ✅ `log_min_duration_statement`, `log_lock_waits` y SQLSTATE + consulta en el log de error |
| R3.4e–g Métricas | ✅ | `metrics.service.ts`: contador e histograma de transacciones, HTTP, deadlocks, latencia de IA | ✅ la latencia de IA se registra desde `metadata.inferenceLatencyMs` |
| R3.4h Trazabilidad | ✅ | `x-correlation-id` en middleware, en el payload de RabbitMQ y en `ai-service/consumer.py:19,33` | ✅ el correlation ID se valida (≤ 64 caracteres) |
| R3.4i/j Diseño teórico | ✅ | `docs/DOCUMENTO_TECNICO.md` §4.2 | ✅ (alertas propuestas, no configuradas en Prometheus) |
| R3.5a Consulta exacta del cuello de botella | ❌ | No hay `pg_stat_statements` ni `auto_explain` (**G7**) | ✅ `pg_stat_statements` y `db-diagnostics` con `pg_blocking_pids` |
| R3.5b Timeouts de BD | ⚠️ | Hay `connectionTimeoutMillis`, pero falta `statement_timeout`/`lock_timeout` (**G3**) | ✅ `lock_timeout`, `statement_timeout` y `POOL_TIMEOUT` → 503 |
| R3.5c Deadlocks | ⚠️ | Se detectan comparando texto del mensaje (`transactions.service.ts:141`) en vez del código SQLSTATE (**G3**) | ✅ por SQLSTATE, con reintento |
| R3.5d / R3.6a–d Teórico | ✅ | `docs/DOCUMENTO_TECNICO.md` §5-6 | ✅ |
| RNF-1 10k TPS | ⚠️ | Pool configurado (`max` 25-30), sin PgBouncer ni prueba de carga que lo respalde (**G5**) | ⚠️ sin cambios (**G5**) |
| RNF-2 < 2 s | ✅ | Medido por histograma; `execution_time_ms` persistido | ✅ medido: p95 de 361 ms con 10.000 transferencias en la simulación de quincena |
| RNF-3 IA no bloquea | ✅ | Despacho sin `await` bloqueante | ✅ la petición no toca RabbitMQ: responde tras el `COMMIT` |
| RNF-4 Bancs sin alto volumen | ⚠️ | Solo se publica el evento; no hay rate limiting ni buffer reales (**G1**, **G8**) | ⚠️ cola durable sin consumidor (**G8**) |
| E1–E3, E5 | ✅ | `docs/`, `README.md`, `AI_DISCLOSURE.md` | ✅ |
| E4 Video y presentación | ❌ | No están en el repo (**G9**) | ⚠️ datos de prueba documentados en el README; video y presentación pendientes (**G9**) |

## 2. Brechas priorizadas

### G1 — El "Transactional Outbox" está documentado pero no existe (dual-write)
- **Referencia:** [[Transactional Outbox]] — *"messages are guaranteed to be sent if and only if the database transaction commits"* (microservices.io).
- **Código:** `transactions.service.ts:132` llama a `dispatchAsyncEvents` **después** de `commitTransaction()`; `dispatchAsyncEvents` (`:162`) publica directo a RabbitMQ. No existe tabla `outbox` en `backend/sql/schema.sql`.
- **Impacto:** si el proceso o RabbitMQ caen entre el commit y la publicación, el evento se pierde de forma silenciosa. La transferencia queda registrada, pero Bancs nunca se entera. Además, el documento técnico afirmaba que se usaba Outbox, así que en ese momento había una inconsistencia entre lo que se decía y lo que se hacía.
- **Acción:** tabla `outbox_events` insertada dentro de la misma transacción, más un relay con `SELECT ... FOR UPDATE SKIP LOCKED` que publique y marque `published_at`.
- **Prioridad: alta.** Es la pregunta más probable del jurado.

### G2 — Sin clave de idempotencia en el endpoint de transferencia
- **Referencia:** [[Idempotency Keys]] (Stripe, draft IETF `Idempotency-Key`).
- **Código:** `create-transaction.dto.ts` y el controlador no reciben ninguna clave; no hay índice único que impida repetir la operación.
- **Impacto:** un reintento del cliente, o de un proxy, produce un doble débito. En banca es inaceptable, y se agrava con **G1** porque los consumidores reciben *at-least-once*.
- **Acción:** header `Idempotency-Key`, columna con índice único en `transactions` y devolver la transacción original ante una clave repetida.
- **Prioridad: alta.**

### G3 — Deadlocks y timeouts mal instrumentados
- **Referencia:** [[Concurrencia en PostgreSQL]] — SQLSTATE `40P01` (deadlock_detected), `55P03` (lock_not_available), `lock_timeout` y `statement_timeout`.
- **Código:** `transactions.service.ts:141` hace `error.message.includes('deadlock')`. Es frágil, depende del idioma y del driver, y puede dar falsos negativos justo en el incidente del 3.5.
- **Acción:** usar `error.code === '40P01' | '55P03'`, configurar `lock_timeout` y `statement_timeout` por sesión, y etiquetar la métrica de deadlocks por SQLSTATE.
- **Prioridad: alta.** Es el escenario que el reto evalúa de forma explícita.

### G4 — No hay prueba automatizada de concurrencia
- **Referencia:** R3.1e exige demostrar que no hay race conditions.
- **Código:** solo `transactions.service.spec.ts`, con repositorios simulados. El módulo `simulation/` dispara carga por HTTP, pero no verifica invariantes.
- **Acción:** test de integración que lance N transferencias cruzadas en paralelo contra Postgres real y verifique que la suma de saldos se conserva, que no hay saldos negativos y que los reintentos por deadlock terminan bien.
- **Prioridad: alta.** Es barato y es la evidencia más contundente frente al jurado.

### G5 — El salto a 10 000 TPS no está sustentado
- **Referencia:** [[Connection Pooling y 10k TPS]] (wiki de PostgreSQL, PgBouncer, HikariCP pool sizing).
- **Código:** `app.module.ts:41-46` fija el pool entre 5 y 30 conexiones. No hay PgBouncer en el compose, aunque el post-mortem lo menciona.
- **Acción:** documentar el cálculo del pool y agregar PgBouncer en modo transaction al compose, o declarar de forma explícita que el MVP es de una sola instancia y describir el plan de escalado.
- **Prioridad: media.**

### G6 — `synchronize: true` contra un DDL versionado
- **Código:** `app.module.ts:39`. TypeORM puede alterar el esquema en el arranque, y eso convive con `backend/sql/schema.sql`. En un sistema financiero no se hace, porque el esquema deja de ser reproducible.
- **Acción:** dejarlo en `false` fuera de desarrollo y apoyarse en el DDL o en migraciones.
- **Prioridad: media.**

### G7 — No se puede identificar la consulta exacta del cuello de botella (R3.5a)
- **Referencia:** [[Observabilidad]] e [[Incidentes y Post Mortem]] — `pg_stat_statements`, `pg_stat_activity`, `pg_locks`, `auto_explain`.
- **Acción:** habilitar `pg_stat_statements` y `auto_explain` en el Postgres del compose, y agregar un endpoint o consulta de diagnóstico sobre `pg_locks` y `pg_stat_activity` (bloqueos, `wait_event_type`, consultas de más de N ms).
- **Prioridad: media.** Es lo que el 3.5 pide de forma literal.

### G8 — La sincronización con Bancs no tiene control de ritmo
- **Referencia:** [[Sincronizacion con core legado]] (rate limiting, queue-based load leveling, anti-corruption layer).
- **Código:** `dispatchAsyncEvents` publica a `bancs.sync`, pero no hay consumidor, ni buffer, ni límite de tasa, ni DLQ.
- **Acción:** un consumidor mock de Bancs con límite de tasa y DLQ ya demuestra el patrón completo, y es poco código.
- **Prioridad: media.**

### G9 — Faltan evidencias E4
- Video demostrativo, material de presentación y datos de prueba.
- **Prioridad: alta**, porque es un entregable explícito del reto.

### G10 — La métrica de conexiones del pool nunca se actualizaba (detectada durante la corrección)
- **Referencia:** [[Connection Pooling y 10k TPS]], [[Observabilidad]] (R3.5b).
- **Código:** `smartbancs_db_active_connections` se declaraba en `metrics.service.ts`, pero ningún código le asignaba valor: siempre valía 0, y la alerta `ConnectionPoolExhaustion` del documento técnico nunca podía dispararse.
- **Acción:** leer `totalCount`, `idleCount` y `waitingCount` del pool de `pg` en cada scrape y exponer también `smartbancs_db_pool_waiting_requests`.
- **Prioridad: media.**

## 3. Orden sugerido de ejecución
1. G1, G2, G3 y G4, que son el núcleo técnico y lo que el jurado va a cuestionar.
2. G7 y G8, que cierran el escenario del incidente y el de Bancs.
3. G5 y G6, que se pueden resolver con configuración y una justificación escrita.
4. G9: video y presentación.

Cada corrección se hizo en commits con el ID de la brecha en el mensaje (`fix(G1,G2,G3,G6): ...`, `test(G4): ...`). G1, G2, G3 y G6 van en un mismo commit porque están acopladas en `transactions.service.ts`.

## 4. Estado de las correcciones

| Brecha | Estado | Commit |
|---|---|---|
| G1 Outbox transaccional | ✅ Corregida: tabla `outbox_events` + relay `SKIP LOCKED`; consumidor de recomendaciones idempotente. En la segunda revisión: *publisher confirms*, reconexión indefinida y DLQ del consumidor de IA | `fix(G1,G2,G3,G6)`, `fix(review)`, `fix(ai-service)` |
| G2 Idempotency-Key | ✅ Corregida en API y frontend. En la segunda revisión: CORS permite el header (antes el navegador bloqueaba la transferencia) y la misma clave con otro payload responde 422 | `fix(G1,G2,G3,G6)`, `feat(G2)`, `fix(review)` |
| G3 Deadlocks y timeouts | ✅ Corregida: SQLSTATE, `lock_timeout`, `statement_timeout`, reintento con backoff. En la segunda revisión: el pool agotado se clasifica como `POOL_TIMEOUT` y responde 503 | `fix(G1,G2,G3,G6)`, `fix(review)` |
| G4 Prueba de concurrencia | ✅ `npm run test:int`: 4 escenarios iniciales contra PostgreSQL real (falla si se quita el lock), ampliados a 12 en la segunda revisión (montos al centavo, idempotencia estricta, pool agotado, relay con confirmaciones) | `test(G4)`, `fix(review)` |
| G5 10k TPS | ⏳ Pendiente: PgBouncer documentado como acción preventiva | — |
| G6 `synchronize` | ✅ Corregida. En la segunda revisión también `backend/.env.example` pasó a `DB_SYNCHRONIZE=false` | `fix(G1,G2,G3,G6)`, `fix(review)` |
| G7 Consulta exacta | ✅ `pg_stat_statements`, `log_lock_waits`, runbook en `sql/00-observability.sql`. En la segunda revisión: `db-diagnostics` usa `pg_blocking_pids` y solo se habilita con `SIMULATION_ENABLED=true` | `feat(G7)`, `fix(review)` |
| G8 Ritmo hacia Bancs | ⏳ Parcial: el evento sale del outbox a una cola durable; el worker con rate limiting queda diseñado. La DLQ implementada es la de la cola de IA, no la de Bancs | — |
| G9 Video y presentación | ⏳ Pendiente. Los datos de prueba ya están descritos en el README | — |
| G10 Métrica del pool | ✅ Corregida | `fix(G10)` |

`fix(review)` y `fix(ai-service)` abrevian los commits `fix(review): correcciones del backend…` y `fix(ai-service): sin perdida de mensajes…` de la segunda revisión.

## 5. Segunda revisión con equipo de agentes

Con las brechas G1–G10 atendidas, un equipo de agentes de Claude Code revisó el repositorio completo con cuatro roles: concurrencia y base de datos, SRE y observabilidad, coherencia entre documentación y código, y diagramador. Los informes están en [docs/revision/](revision/README.md) y describen el código **antes** de la ronda de correcciones que vino después.

Hallazgos de severidad ALTA y su resolución:

- **Dinero y concurrencia:** montos con más de 2 decimales creaban un centavo por operación (C1), el relay marcaba eventos como publicados sin confirmación del broker (C4) y `backend/.env.example` activaba `synchronize` (C3). Corregidos con validación del DTO y aritmética en `NUMERIC`, *publisher confirms* y `DB_SYNCHRONIZE=false`.
- **Demo rota:** CORS bloqueaba el header `Idempotency-Key`, así que ninguna transferencia desde la UI llegaba al backend (C2/D1). Corregido.
- **Mensajes perdidos:** el ai-service hacía ack aunque el backend fallara (O1) y el backend dejaba de reconectar a RabbitMQ tras unos 15 s (O2). Corregidos con reintentos del POST, DLQ `smartbancs.ai.dlq`, reconexión indefinida con backoff y healthcheck de RabbitMQ.
- **Documentación y UI:** afirmaciones sin respaldo en el código (UI con valores fijos, motor de IA fijo, modelo Gemini desactualizado en `.env.example`, imagen de arquitectura desactualizada, autoría de las notas). Corregidas en la UI, el README, los diagramas y la declaración de IA; el documento técnico y el de IA se reescriben en la misma ronda.

El estado por hallazgo, los commits y los pendientes conocidos (worker de Bancs, purga del outbox, alertas no configuradas, ADR, video) están en [docs/revision/README.md](revision/README.md). Pruebas después de la ronda: `npm test` 31/31, `npm run test:int` 12/12 y `pytest` 16/16.
