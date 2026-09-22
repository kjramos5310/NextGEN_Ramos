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

| Req | Estado | Evidencia en el código |
|---|---|---|
| R3.1a Endpoint transaccional | ✅ | `backend/src/modules/transactions/transactions.controller.ts` |
| R3.1b DDL | ✅ | `backend/sql/schema.sql` (CHECK de saldo ≥ 0, `NUMERIC(18,2)`, índices) |
| R3.1c DML semilla | ✅ | `backend/sql/seed.sql`, `backend/src/database/seeds/seed.service.ts` |
| R3.1d Interacción real con BD | ✅ | TypeORM + `queryRunner` en `transactions.service.ts` |
| R3.1e Concurrencia sin race conditions | ⚠️ | Lock pesimista ordenado (`transactions.service.ts:50-70`), pero sin prueba automatizada de concurrencia (ver **G4**) |
| R3.1f IaC un comando | ✅ | `docker-compose.yml` (7 servicios, healthchecks, `depends_on`) |
| R3.2a/b Estrategia Bancs | ⚠️ | Documentada; el patrón Outbox está **declarado pero no implementado** (ver **G1**) |
| R3.2c–f ETL | ✅ | `etl-bancs/etl_bancs_processor.py` (nulos, fechas, feature engineering, salida JSON) |
| R3.3a Servicio IA independiente | ✅ | `ai-service/` (FastAPI + consumidor RabbitMQ) |
| R3.3b/c Consumo asíncrono | ⚠️ | No bloqueante (`transactions.service.ts:132`), pero con riesgo de pérdida de evento (**G1**) |
| R3.3d–f MLOps teórico | ✅ | `docs/IA_IMPLEMENTACION_Y_DESPLIEGUE.md` |
| R3.4a–c Logs críticos | ✅ | `common/logger/logger.service.ts`, interceptor de logging |
| R3.4d Log de interacciones con BD | ⚠️ | `DB_LOGGING` está en `false` por defecto (`app.module.ts:40`); no hay log de consultas lentas (**G7**) |
| R3.4e–g Métricas | ✅ | `metrics.service.ts`: contador e histograma de transacciones, HTTP, deadlocks, latencia de IA |
| R3.4h Trazabilidad | ✅ | `x-correlation-id` en middleware, en el payload de RabbitMQ y en `ai-service/consumer.py:19,33` |
| R3.4i/j Diseño teórico | ✅ | `docs/DOCUMENTO_TECNICO.md` §4.2 |
| R3.5a Consulta exacta del cuello de botella | ❌ | No hay `pg_stat_statements` ni `auto_explain` (**G7**) |
| R3.5b Timeouts de BD | ⚠️ | Hay `connectionTimeoutMillis`, pero falta `statement_timeout`/`lock_timeout` (**G3**) |
| R3.5c Deadlocks | ⚠️ | Se detectan comparando texto del mensaje (`transactions.service.ts:141`) en vez del código SQLSTATE (**G3**) |
| R3.5d / R3.6a–d Teórico | ✅ | `docs/DOCUMENTO_TECNICO.md` §5-6 |
| RNF-1 10k TPS | ⚠️ | Pool configurado (`max` 25-30), sin PgBouncer ni prueba de carga que lo respalde (**G5**) |
| RNF-2 < 2 s | ✅ | Medido por histograma; `execution_time_ms` persistido |
| RNF-3 IA no bloquea | ✅ | Despacho sin `await` bloqueante |
| RNF-4 Bancs sin alto volumen | ⚠️ | Solo se publica el evento; no hay rate limiting ni buffer reales (**G1**, **G8**) |
| E1–E3, E5 | ✅ | `docs/`, `README.md`, `AI_DISCLOSURE.md` |
| E4 Video y presentación | ❌ | No están en el repo (**G9**) |

## 2. Brechas priorizadas

### G1 — El "Transactional Outbox" está documentado pero no existe (dual-write)
- **Referencia:** [[Transactional Outbox]] — *"messages are guaranteed to be sent if and only if the database transaction commits"* (microservices.io).
- **Código:** `transactions.service.ts:132` llama a `dispatchAsyncEvents` **después** de `commitTransaction()`; `dispatchAsyncEvents` (`:162`) publica directo a RabbitMQ. No existe tabla `outbox` en `backend/sql/schema.sql`.
- **Impacto:** si el proceso o RabbitMQ caen entre el commit y la publicación, el evento se pierde de forma silenciosa. La transferencia queda registrada, pero Bancs nunca se entera. Además, el documento técnico y el guion afirman que se usa Outbox, así que hoy hay una inconsistencia entre lo que se dice y lo que se hace.
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

## 3. Orden sugerido de ejecución
1. G1, G2, G3 y G4, que son el núcleo técnico y lo que el jurado va a cuestionar.
2. G7 y G8, que cierran el escenario del incidente y el de Bancs.
3. G5 y G6, que se pueden resolver con configuración y una justificación escrita.
4. G9: video y presentación.

Cada corrección va en su propio commit, con el ID de la brecha en el mensaje (`fix(G1): ...`).
