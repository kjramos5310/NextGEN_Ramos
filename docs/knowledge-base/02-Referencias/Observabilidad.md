---
tags: [referencia, observabilidad, metricas, logs, trazas, opentelemetry]
requisitos: [R3.4a, R3.4b, R3.4c, R3.4d, R3.4e, R3.4f, R3.4g, R3.4h, R3.4i, R3.4j, R3.5a, R3.5b, R3.5c, R3.3e]
fuentes:
  - https://sre.google/sre-book/monitoring-distributed-systems/
  - https://grafana.com/blog/the-red-method-how-to-instrument-your-services/
  - https://www.brendangregg.com/usemethod.html
  - https://opentelemetry.io/docs/concepts/context-propagation/
  - https://opentelemetry.io/docs/specs/semconv/db/database-spans/
  - https://www.w3.org/TR/trace-context/
  - https://prometheus.io/docs/practices/histograms/
  - https://www.postgresql.org/docs/current/pgstatstatements.html
  - https://www.postgresql.org/docs/current/monitoring-stats.html
  - https://www.postgresql.org/docs/current/auto-explain.html
  - https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
estado: borrador
---

# Observabilidad: golden signals, RED/USE, logs estructurados, correlation ID, OpenTelemetry

## Qué es
Es la capacidad de responder, con datos que el sistema ya emite, las dos preguntas de Google SRE: **qué está roto y por qué**. Se apoya en tres señales:
- **Métricas**: series numéricas agregables, para alertar y ver tendencias.
- **Logs**: eventos discretos con contexto, para el detalle.
- **Trazas**: el camino de una petición entre componentes, para saber dónde se fue el tiempo.

Hay tres marcos para elegir qué medir:
- **Golden signals** (SRE): latencia, tráfico, errores y saturación.
- **RED** (Tom Wilkie), por servicio: *Rate, Errors, Duration*.
- **USE** (Brendan Gregg), por recurso: *Utilization, Saturation, Errors*. Wilkie lo resume así: *"RED … caring about your users … USE … caring about your machines"*.

## Problema que resuelve
En la quincena (R3.5) el síntoma es "las transferencias no terminan". Sin datos adecuados no se sabe si la causa es la BD, un lock, el pool, la IA o Bancs. La observabilidad reduce el MTTD y el MTTR y permite escribir un post mortem con evidencia (ver [[Incidentes y Post Mortem]]).

## Cómo se implementa
**1. Métricas (Prometheus). Qué y por qué (R3.4e–g, R3.4i–j):**
| Métrica | Tipo | Marco | Para qué sirve |
|---|---|---|---|
| `transfers_total{status}` | counter | RED-Rate / tráfico | Volumen (TPS) y base para la tasa de error |
| `transfers_failed_total{reason}` (`insufficient_funds`, `lock_timeout`, `deadlock`, `db_timeout`, `internal`) | counter | RED-Errors | Separa errores de negocio de errores técnicos; solo los técnicos alertan |
| `http_request_duration_seconds` (histograma, por ruta y status) | histogram | RED-Duration / latencia | p95/p99 contra el SLO de 2 s. **Histogramas y no promedios**: SRE advierte que con 100 ms de promedio *"1% of requests might easily take 5 seconds"*. Se separa la latencia de éxitos y de errores |
| `db_query_duration_seconds{query_name}` | histogram | USE (BD) | **Señala la consulta exacta** que se degrada (R3.5a) |
| `db_errors_total{sqlstate}` (`40P01`, `55P03`, `57014`) | counter | USE-Errors | Deadlocks y timeouts por tipo (R3.5b, R3.5c) |
| `db_pool_in_use`, `db_pool_wait_seconds` | gauge / histogram | USE-Saturation | Pool agotado = antesala de los timeouts de conexión |
| `ai_request_duration_seconds`, `ai_requests_total{outcome}` | histogram / counter | RED (IA) | Demuestra que la IA es lenta **sin** que se mueva la latencia de transferencias |
| `queue_depth{queue}`, `outbox_lag_seconds`, `bancs_sync_lag_seconds` | gauge | Saturación | Backpressure hacia Bancs y la IA |
| `circuit_breaker_state{target}` | gauge | — | Degradación visible |

Los histogramas de Prometheus se agregan entre instancias, a diferencia de los *summaries*. Con histogramas nativos se calcula, por ejemplo, la fracción de requests por debajo de 0,3 s sin redeploy.

**2. Logs estructurados (R3.4a–d):** en JSON, una línea por evento, con campos fijos: `ts` (ISO 8601 UTC), `level`, `service`, `event`, `trace_id`, `span_id`, `transfer_id`, `duration_ms`, `outcome`.
- Eventos mínimos:
  - `transfer.completed`
  - `transfer.failed` (con `error.type` y `sqlstate`)
  - `ai.request` / `ai.response` / `ai.timeout`
  - `db.query` (con `query_name`, `duration_ms` y `rows`; nivel DEBUG en el camino feliz y WARN si supera un umbral)
  - `db.lock_timeout` / `db.deadlock` (ERROR)
- **Seguridad (OWASP Logging Cheat Sheet)**: nunca registrar contraseñas, tokens, ids de sesión ni **datos de cuenta o tarjeta**. Se enmascaran los números de cuenta (`****1234`). Se registra *quién, qué, cuándo, dónde y resultado*.

**3. Trazas y correlation ID (R3.4h):**
- **W3C Trace Context**: header `traceparent = version-traceid-parentid-flags`, p. ej. `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`.
- **OpenTelemetry** propaga el contexto entre servicios y permite **correlacionar trazas, métricas y logs** con el mismo `trace_id`. Recorrido: API → span de BD → outbox (se guarda `traceparent` en el evento) → cola (header) → IA / Bancs Sync. Así una transferencia se sigue de punta a punta aunque sea asíncrona.
- Spans de BD con las convenciones semánticas estables de OTel: `db.system.name=postgresql`, `db.operation.name`, `db.collection.name`, `db.query.text` (**parametrizada**, sin valores) y `db.response.status_code` (el SQLSTATE).
- Se devuelve `trace_id` en un header de respuesta: el soporte lo usa para buscar el caso de un usuario.

**4. Del lado de PostgreSQL (R3.5a–c):**
- `pg_stat_statements` (se carga con `shared_preload_libraries`): consultas normalizadas con `calls`, `total_exec_time`, `mean_exec_time` y `rows`. Dice **qué consulta** consume el tiempo.
- `pg_stat_activity`: `state` (incluye `idle in transaction`), `wait_event_type` (p. ej. `Lock`), `query`, `xact_start`. `pg_blocking_pids(pid)` da **quién bloquea a quién**.
- `pg_stat_database.deadlocks`: contador de deadlocks.
- `log_lock_waits = on`, `log_min_duration_statement` y `auto_explain.log_min_duration` registran los planes de las consultas lentas. Hay que tener cuidado con `log_analyze`: agrega *timing* a **todas** las sentencias, con un *"extremely negative impact on performance"*.
- Exportador: `postgres_exporter` hacia Prometheus.

**5. Qué alertar (R3.4i).** Se alerta sobre **síntomas**, no causas (SRE):
- p99 de `POST /transfers` > 1,5 s durante 5 min (margen antes de los 2 s);
- tasa de errores técnicos > 1 %;
- `db_pool_wait` p95 > 200 ms (saturación temprana);
- `rate(db_errors_total{sqlstate="40P01"})` > 0 sostenido;
- `bancs_sync_lag` > N min;
- mensajes en la DLQ > 0;
- PSI de un feature clave ≥ 0,2 ([[MLOps y Data Drift]]).

## Trade-offs
| Decisión | A favor | En contra |
|---|---|---|
| OTel + Prometheus + Grafana (+ Jaeger/Tempo) | Estándar abierto, sin lock-in | Varios contenedores más en el compose |
| Logs de cada consulta | Máximo detalle | Volumen y costo a 10k TPS: usar DEBUG + muestreo; métricas siempre |
| Muestreo de trazas | Controla el costo | Puede perder la traza del caso raro: *tail sampling* de errores |
| Etiquetas de alta cardinalidad (`account_id`) | Detalle | **Explota Prometheus**: van en logs y trazas, no en labels |

## Aplicación a SmartBancs
- **Práctico (MVP)**: middleware que crea o lee `traceparent`, logger JSON con `trace_id`, endpoint `/metrics`, un wrapper de BD que mide y etiqueta cada consulta por `query_name` y captura el SQLSTATE, y propagación en los headers de la cola.
- **Compose**: `prometheus` + `grafana` (dashboard RED + USE de BD) + `jaeger` (o el exportador de consola de OTel si hay poca memoria).
- **Teórico (R3.4i–j)**: la tabla del punto 1 con la columna "para qué sirve" es la justificación que pide el reto.
- Relación: [[Concurrencia en PostgreSQL]] (códigos SQLSTATE), [[Connection Pooling y 10k TPS]] (saturación), [[Incidentes y Post Mortem]] (uso durante el incidente).

## Preguntas que podría hacer el jurado
- *¿Por qué histogramas y no promedio de latencia?* El promedio oculta la cola. El SLO de 2 s se cumple o no en el p99.
- *¿Cómo sigues una transferencia hasta la IA si es asíncrona?* El `traceparent` viaja en la fila de la outbox y en el header del mensaje; la IA continúa la misma traza.
- *¿Cómo identificas la consulta exacta del deadlock?* Por el SQLSTATE `40P01` en la métrica y el log con `query_name`, el log de PostgreSQL (que incluye las sentencias en conflicto) y `pg_stat_activity` + `pg_blocking_pids()` en vivo.
- *¿Por qué no poner `account_id` como label?* Por la cardinalidad: millones de series. Va en los logs y las trazas.
- *¿Qué no registras?* Datos sensibles (OWASP): tokens, credenciales y números completos de cuenta.
