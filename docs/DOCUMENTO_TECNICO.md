# SmartBancs App: documento técnico de arquitectura, operaciones e IA

**Proyecto:** SmartBancs App (reto técnico TCS NextGen)
**Alcance:** MVP ejecutable con `docker compose` más el diseño para producción.
**Versión:** 1.0 (MVP)

**Convención de este documento.** Cada afirmación va marcada como una de estas dos cosas:

- **Implementado:** existe en el repositorio. Se cita el archivo y la función.
- **Diseño / propuesta:** es cómo se haría en producción. No está en el código del MVP.

Las cifras de latencia o de TPS que aparecen son **objetivos** del enunciado, **techos calculados a partir de la configuración** o **mediciones de la simulación de quincena** (sección 5.2), indicando siempre en qué entorno se midieron.

**Dónde está cada punto del reto:**

| Reto | Tema | Sección |
|---|---|---|
| 3.1 | Infraestructura, base de datos y backend | [1](#1-reto-31-arquitectura-general-y-decisiones-técnicas) y [README](../README.md) |
| 3.2 | Bancs: sincronización y ETL | [2](#2-reto-32-integración-con-el-core-legado-bancs-y-manejo-de-datos) |
| 3.3 | Inteligencia artificial | [3](#3-reto-33-inteligencia-artificial-resumen) e [IA_IMPLEMENTACION_Y_DESPLIEGUE.md](IA_IMPLEMENTACION_Y_DESPLIEGUE.md) |
| 3.4 | Observabilidad | [4](#4-reto-34-observabilidad-y-trazabilidad) |
| 3.5 | Incidente crítico simulado (quincena) | [5](#5-reto-35-operaciones-incidente-crítico-simulado-de-quincena) |
| 3.6 | Gestión de incidentes: escalamiento y post mortem | [6](#6-reto-36-gestión-de-incidentes-ti-escalamiento-y-post-mortem) |

---

## 1. Reto 3.1: arquitectura general y decisiones técnicas

### 1.1. Diagrama de componentes (MVP)

```
 React 18 + Vite (frontend, :3000)
        | HTTP REST  (x-correlation-id, Idempotency-Key)
        v
 +--------------------------- Backend NestJS (:4000) ----------------------------+
 |  POST /api/v1/transactions                                                     |
 |   1 transacción READ COMMITTED:                                                |
 |     SET LOCAL lock_timeout / statement_timeout                                 |
 |     SELECT ... FOR UPDATE (cuentas en orden determinista)                      |
 |     UPDATE saldos (aritmética NUMERIC en SQL) + INSERT transactions            |
 |     INSERT outbox_events (transaction.created, bancs.sync)  -> COMMIT -> 201   |
 |                                                                                |
 |  OutboxRelayService (en segundo plano, cada 500 ms)                            |
 |     SELECT ... FOR UPDATE SKIP LOCKED -> publish (publisher confirms)          |
 |     -> UPDATE published_at solo de los mensajes confirmados                    |
 |  GET /metrics (prom-client)                                                    |
 +------------+-----------------------------------------------+-------------------+
              |                                               |
              v                                               v
   PostgreSQL 16 (:5432)                          RabbitMQ 3.13 (exchange topic smartbancs.events)
   accounts, transactions,                          - smartbancs.ai.queue  (DLX smartbancs.dlx -> smartbancs.ai.dlq)
   ai_recommendations, outbox_events                - smartbancs.bancs.sync.queue (sin consumidor en el MVP)
   pg_stat_statements, log_lock_waits                         |
              ^                                               v
              |                          ai-service (FastAPI + consumidor pika, :8000)
              |                            Gemini (GEMINI_MODEL, por defecto gemini-3.6-flash)
              |                            o motor heurístico local (fallback)
              +---- POST /api/v1/recommendations (idempotente por transaction_id) ----+

 Prometheus (:9090) scrapea backend:4000/metrics  ->  Grafana (:3001)
 ETL (etl-bancs/etl_bancs_processor.py): CSV crudo -> bancs_cleaned_features.json (no escribe en la BD)
```

El diagrama de secuencia del flujo asíncrono de la IA está en [IA_IMPLEMENTACION_Y_DESPLIEGUE.md](IA_IMPLEMENTACION_Y_DESPLIEGUE.md); el resto de diagramas, en [ARQUITECTURA_DIAGRAMAS.md](ARQUITECTURA_DIAGRAMAS.md).

### 1.2. Justificación del stack (rendimiento, seguridad, escalabilidad)

| Componente | Elección | Rendimiento | Seguridad | Escalabilidad |
| :--- | :--- | :--- | :--- | :--- |
| Backend | NestJS 10 + TypeScript | El event loop no bloqueante encaja con un trabajo por petición que es sobre todo E/S (BD); no hace cómputo pesado. | Tipado estricto y validación declarativa de DTOs (`class-validator`, `whitelist` + `forbidNonWhitelisted`, en [validation.ts](../backend/src/common/validation.ts)). | El servicio es *stateless*: se escala con réplicas detrás de un balanceador. El relay del outbox es seguro con varias réplicas gracias a `SKIP LOCKED`. |
| Base de datos | PostgreSQL 16 | Locks de fila (`SELECT ... FOR UPDATE`), `NUMERIC(18,2)` para montos e índices B-Tree y parciales. | `CHECK (balance >= 0)` y `CHECK (amount > 0)` en [schema.sql](../backend/sql/schema.sql) como red de seguridad ante bugs de aplicación. | Escala vertical y réplicas de lectura. Para 10k TPS: PgBouncer y particionado (ver 1.3, diseño). |
| Mensajería | RabbitMQ 3.13 | Saca la IA y Bancs del camino crítico de la transferencia. | Colas durables, mensajes persistentes y *publisher confirms*. | Consumidores competitivos por cola; DLQ para mensajes que no se pueden procesar. |
| IA | Python 3.11 + FastAPI + pika | Proceso y contenedor separados: la inferencia no compite por el event loop del backend. | La API key de Gemini se lee de una variable de entorno y viaja en el header `x-goog-api-key`, no en la URL ([advisor.py](../ai-service/advisor.py)). | Réplicas del consumidor sobre la misma cola (diseño de autoescalado en el documento de IA). |
| Observabilidad | Winston + prom-client + Prometheus + Grafana | Métricas agregadas de bajo costo. Los logs son JSON en `NODE_ENV=production`. | El correlation ID del cliente se valida (`^[A-Za-z0-9._:-]{1,64}$`) antes de usarse ([correlation-id.middleware.ts](../backend/src/common/middleware/correlation-id.middleware.ts)). | Prometheus federable; los logs JSON se pueden enviar a Loki o ELK (diseño). |
| IaC | Docker Compose (local) + Terraform (Google Cloud) + GitHub Actions | Un solo comando levanta los 7 servicios en local. En la nube, Terraform crea Cloud Run, Cloud SQL, la VM de RabbitMQ, Secret Manager y Workload Identity Federation; el pipeline prueba, migra y despliega en cada push a `main`. | Compose usa credenciales de ejemplo en texto plano (solo local); en la nube los secretos están en Secret Manager. | Cloud Run escala por instancias; más allá, Kubernetes + HPA/KEDA (diseño). |

### 1.3. Estrategia para 10.000 TPS (diseño) y qué valida el MVP

El MVP **no demuestra** 10.000 TPS: corre en un solo host con un pool de 30 conexiones (`DB_POOL_MAX=30` en [docker-compose.yml](../docker-compose.yml)). Lo que sigue es el diseño para llegar a esa cifra y los límites que tiene.

**Diseño para producción (no implementado):**

1. **Réplicas stateless del backend** detrás de un balanceador, con autoescalado por CPU y latencia. Se escala la API solo si el cuello de botella no es la BD: más réplicas × pool por réplica puede agotar `max_connections` de PostgreSQL.
2. **PgBouncer en modo `transaction`** entre las réplicas y PostgreSQL. Así se tienen miles de conexiones lógicas sobre un pool físico pequeño. El código es compatible: los timeouts se fijan con `SET LOCAL`, que vive dentro de la transacción ([transactions.service.ts](../backend/src/modules/transactions/transactions.service.ts), `executeTransfer`), y no se usan `SET` de sesión.
3. **Particionado o *sharding* por número de cuenta.** Cada shard atiende una fracción de las cuentas. Las transferencias entre shards requieren una saga (débito, crédito y compensación) o 2PC. Es el principal *trade-off* del diseño y queda fuera del MVP.
4. **Cuentas calientes.** Una cuenta pagadora de nómina serializa todas las transferencias que la tocan, porque cada una toma su lock de fila. El techo por cuenta es aproximadamente `1 / (tiempo que se retiene el lock)`. Se mitiga con subcuentas de dispersión, con el procesamiento de la nómina como lote en el core, o sacando la cuenta pagadora del camino síncrono.
5. **Relay por CDC.** El relay por sondeo del MVP se reemplaza por Debezium (Outbox Event Router) leyendo el WAL. Con dos eventos por transferencia, 10k TPS son unos 20k eventos/s. El relay por sondeo tiene un techo configurado de 10 lotes × 100 eventos por tick de 500 ms (`MAX_BATCHES_PER_TICK` en [outbox-relay.service.ts](../backend/src/modules/outbox/outbox-relay.service.ts)); el techo real es menor porque cada lote espera las confirmaciones del broker y no está medido.
6. **Colas como amortiguador**: IA y Bancs consumen a su propio ritmo, y la transferencia no espera a ninguno.
7. **Control de admisión** en el API Gateway: rate limit por cliente y `429`/`503` con `Retry-After` antes de saturar la BD.

**Qué valida el MVP (implementado y probado):**

- Corrección bajo concurrencia. [concurrency.int-spec.ts](../backend/test/concurrency.int-spec.ts) tiene 12 pruebas contra PostgreSQL real (`npm run test:int`), entre ellas: 400 transferencias cruzadas en paralelo conservan el total; 50 débitos simultáneos de $10 sobre $100 aprueban exactamente 10; 300 transferencias de 0.01/0.10/0.20 conservan el total al centavo; idempotencia con 20 reintentos concurrentes; pool agotado → `503` + `POOL_TIMEOUT`.
- Falla rápida: `lock_timeout`, `statement_timeout` y timeout de pool → `503`, en vez de dejar la conexión retenida.
- Semántica del outbox: los eventos no confirmados siguen pendientes. Se prueba con un broker simulado (stub), no con un RabbitMQ real. La semántica de ack, nack y timeout de los *publisher confirms* se prueba con un canal simulado en [rabbitmq.service.spec.ts](../backend/src/modules/rabbitmq/rabbitmq.service.spec.ts).

**Qué no valida el MVP:** el throughput (TPS), el p95 bajo carga sostenida, el failover de un broker real, CDC, PgBouncer ni el sharding.

**Cómo medirlo:**

- Endpoint de simulación `POST /api/v1/simulation/quincena-spike` (tope de 500 operaciones, `concurrentWorkers` ≤ 100; [simulation.service.ts](../backend/src/modules/simulation/simulation.service.ts)). Devuelve p95, promedio y errores.
- Métrica `smartbancs_transaction_duration_seconds` en Prometheus.
- Para el objetivo de 10k TPS hace falta una herramienta externa (k6, Gatling) contra un entorno de staging dimensionado.

### 1.4. Seguridad: estado del MVP y diseño

**Implementado:**

- Validación de entrada: montos con máximo 2 decimales, entre 0.01 y 1.000.000; moneda `USD`; longitudes máximas ([create-transaction.dto.ts](../backend/src/modules/transactions/dto/create-transaction.dto.ts)).
- `Idempotency-Key` de hasta 64 caracteres. Si llega la misma clave con otro payload, responde `422`.
- Correlation ID validado.
- La API key de Gemini va en un header y no se imprime (`check_gemini.py` solo muestra su longitud).
- Los endpoints de simulación solo se registran con `SIMULATION_ENABLED=true` ([app.module.ts](../backend/src/app.module.ts)).

**No implementado (limitaciones conocidas):**

- No hay autenticación ni autorización.
- CORS con `origin: '*'` ([main.ts](../backend/src/main.ts)).
- Credenciales de ejemplo en `docker-compose.yml`.
- `SIMULATION_ENABLED` está en `"true"` en compose para la demo.
- `POST /api/v1/recommendations` (lo usa el ai-service) no tiene DTO de validación ni autenticación.

**Diseño para producción:**

- OAuth2/OIDC con JWT en el gateway y autorización por dueño de cuenta.
- mTLS o red privada entre servicios; el endpoint de recomendaciones solo accesible para el ai-service.
- Secretos en un gestor (Vault o Secret Manager).
- CORS restringido al dominio del frontend.
- Simulación deshabilitada en producción.

---

## 2. Reto 3.2: integración con el core legado Bancs y manejo de datos

### 2.1. Flujo de datos SmartBancs → Bancs sin saturar el core

1. **Transactional Outbox (implementado).** La transferencia escribe en una sola transacción ACID el débito, el crédito, la fila de `transactions` y dos filas en `outbox_events` (`transaction.created` para la IA y `bancs.sync` para Bancs) (`TransactionsService.executeTransfer` y `buildOutboxEvents`). Si hay rollback, los eventos no existen. Si RabbitMQ está caído, esperan en la tabla. No hay *dual-write* en la petición HTTP.

2. **Relay con *publisher confirms* (implementado).** `OutboxRelayService.flushBatch` hace lo siguiente:
   - Lee hasta 100 pendientes con `SELECT ... FOR UPDATE SKIP LOCKED`.
   - Los publica por un `ConfirmChannel` (`RabbitMQService.publishEvent` resuelve `true` solo con el ack del broker, y `false` ante nack, error, timeout de 5 s o falta de conexión).
   - Marca `published_at` solo en los confirmados, con un `UPDATE ... WHERE id = ANY($1)`. A los no confirmados les suma `attempts` y les guarda `last_error`.

   `drain` repite lotes mientras estén llenos, con un máximo de 10 por tick. La conexión a RabbitMQ se reintenta sin límite, con backoff exponencial y tope de 30 s, también tras un `close` de la conexión o del canal ([rabbitmq.service.ts](../backend/src/modules/rabbitmq/rabbitmq.service.ts)). La entrega es *at-least-once*: cada mensaje lleva `eventId` (en el body y como `messageId`) y los consumidores deben ser idempotentes.

3. **Cola durable hacia Bancs (implementado)** `smartbancs.bancs.sync.queue`. **En el MVP no tiene consumidor**, ni `x-max-length` ni TTL: los mensajes se acumulan.

4. **Worker de Bancs con rate limiting (diseño).** Un consumidor dedicado con *token bucket* aplicaría las actualizaciones al core en micro-lotes, a un ritmo acordado con el equipo de Bancs (por ejemplo, N operaciones/s configurables). Tendría reintentos con backoff, DLQ propia y una política `max-length` + `reject-publish` para acotar la cola. Bancs nunca recibe el pico directo: recibe un flujo constante.

5. **Lecturas de saldo sin consultar Bancs (diseño).** SmartBancs mantiene su propio libro de saldos (tabla `accounts`) como fuente para la app. Bancs sigue siendo el sistema de registro y se concilia en diferido.

6. **CDC desde Bancs hacia SmartBancs (diseño).** Los movimientos originados en el core (cajeros, cheques, ventanilla) se capturarían con un conector CDC sobre el log de transacciones de Bancs (Debezium o el mecanismo que exponga el legado). Así no se ejecutan `SELECT` masivos sobre tablas productivas. Además, un job de conciliación nocturno compararía los saldos de ambos lados.

### 2.2. Pipeline ETL (implementado: [etl_bancs_processor.py](../etl-bancs/etl_bancs_processor.py))

Procesa [bancs_raw_transactions.csv](../etl-bancs/bancs_raw_transactions.csv) (12 registros) y produce [bancs_cleaned_features.json](../etl-bancs/bancs_cleaned_features.json) (9 válidos):

- **Desduplicación** por `TX_ID`.
- **Nulos y corruptos:**
  - Descarta montos nulos o no numéricos (quita `$` y `,` antes de convertir).
  - Descarta registros sin cuenta origen.
  - Imputa la moneda nula como `USD` y la nota nula como `"Transaccion sin descripcion"`.
- **Estandarización:**
  - Fechas en 5 formatos → ISO-8601 con sufijo `Z`. No convierte zonas horarias: asume que la entrada ya está en UTC.
  - Moneda en mayúsculas.
  - Códigos legados → categorías (`TRANSFER`, `SHOPPING`, `FOOD_ENTERTAINMENT`, `UNKNOWN`, `OTHER`). Estas categorías son propias del dataset y no coinciden 1:1 con el enum del backend.
- **Features para IA:** `isHighValue` (≥ 1000), `logAmount` (`log1p`) y `channelRiskScore` (por canal; 0.50 si el canal es desconocido).
- **Límites:**
  - La salida es un JSON y no se carga en la BD.
  - El ai-service no la consume.
  - No anonimiza los números de cuenta (en producción se aplicaría un hash, ver el documento de IA).

---

## 3. Reto 3.3: inteligencia artificial (resumen)

El detalle está en [IA_IMPLEMENTACION_Y_DESPLIEGUE.md](IA_IMPLEMENTACION_Y_DESPLIEGUE.md). Resumen de lo implementado:

- **Fuera del camino crítico.** `TransactionsService` no depende de RabbitMQ ni de la IA: su constructor solo recibe `DataSource`, el repositorio, métricas, logger y configuración. La transferencia responde `201` tras el `COMMIT`. El evento `transaction.created` sale del outbox por el relay.
- **Consumidor** ([consumer.py](../ai-service/consumer.py)):
  - `prefetch_count=5` y ack manual.
  - Hace el POST al backend con hasta 3 intentos ante timeout, error de conexión o 5xx.
  - Ante 4xx, mensaje inválido o reintentos agotados: `basic_nack(requeue=False)` → DLQ `smartbancs.ai.dlq`.
- **Inferencia** ([advisor.py](../ai-service/advisor.py)):
  - Gemini (`GEMINI_MODEL`, por defecto `gemini-3.6-flash`) con `responseMimeType: application/json` y timeout de 30 s (`GEMINI_TIMEOUT_SECONDS`).
  - Valida la respuesta: `type` dentro del enum y `title` de hasta 150 caracteres.
  - Si no hay API key, o ante error, 429, timeout o respuesta inválida, usa el motor heurístico local.
- **Persistencia idempotente:** `POST /api/v1/recommendations` deduplica por `transaction_id` (índice único `uq_ai_recs_transaction` + captura de `23505`).
- **Manejo del modelo** (ciclo de vida, monitoreo, recursos): no se entrena un modelo propio, se consume Gemini. Se monitorea la proporción de respuestas del motor de reglas frente a Gemini, la latencia por motor y la DLQ (implementado); la comparación de distribuciones de entrada y salida es diseño. Detalle en [IA_IMPLEMENTACION_Y_DESPLIEGUE.md](IA_IMPLEMENTACION_Y_DESPLIEGUE.md) §2.

---

## 4. Reto 3.4: observabilidad y trazabilidad

### 4.1. Instrumentación implementada

**Logs (R3.4a–d).**

- **Backend** ([logger.service.ts](../backend/src/common/logger/logger.service.ts), Winston):
  - Con `NODE_ENV=production` (el valor de compose) o `LOG_FORMAT=json`, emite una línea JSON por evento con `timestamp` ISO-8601, `level`, `service`, `environment`, `message` y los campos de contexto (`correlationId`, `transactionId`, `durationMs`, `sqlstate`, `attempt`, `query`).
  - En desarrollo usa un formato legible.
- **Qué se registra en el backend:**
  - Inicio y fin de cada transferencia, con duración.
  - Errores con SQLSTATE, número de intento y la consulta que falló (`error.query`).
  - Reintentos por conflicto.
  - Replays idempotentes.
  - Publicación confirmada o no confirmada de cada evento.
  - Backlog del outbox.
  - Cada petición HTTP (el interceptor [logging.interceptor.ts](../backend/src/common/interceptors/logging.interceptor.ts) registra método, URL, estado, duración y correlationId).
- **ai-service** ([log_context.py](../ai-service/log_context.py)): logs de texto (no JSON) con `corrId`, `txId` y `eventId` en cada línea que se emite mientras se procesa un evento. Registra las llamadas a Gemini (latencia, 429, timeout, respuesta inválida), el uso del fallback, el POST al backend y los envíos a la DLQ.
- **PostgreSQL** (flags en [docker-compose.yml](../docker-compose.yml)):
  - `log_min_duration_statement=500`: toda sentencia de más de 500 ms queda en el log.
  - `log_lock_waits=on` con `deadlock_timeout=1s`: registra la espera y el PID que bloquea.
  - `pg_stat_statements`, creado por [00-observability.sql](../backend/sql/00-observability.sql).
  - `DB_LOGGING` de TypeORM está desactivado.

**Métricas Prometheus (R3.4e–g).** La lista es exacta y viene de [metrics.service.ts](../backend/src/common/metrics/metrics.service.ts). Todas llevan la etiqueta por defecto `app="smartbancs-backend"` y se exponen en `GET /metrics` del backend. También se exportan las métricas por defecto de `prom-client` (`process_*`, `nodejs_*`).

| Métrica | Tipo | Labels | Qué mide |
| :--- | :--- | :--- | :--- |
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Peticiones HTTP. `route` es la plantilla de la ruta (p. ej. `/api/v1/transactions/:id`), o `unmatched` si no hubo ruta. `/metrics` se excluye. |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | Latencia HTTP. Buckets: 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5 s. |
| `smartbancs_transactions_total` | Counter | `status` (`COMPLETED`, `FAILED`), `category` | Transferencias procesadas. `FAILED` incluye rechazos de negocio (fondos insuficientes, 404, 422) y errores técnicos. Los replays idempotentes no se cuentan. |
| `smartbancs_transaction_duration_seconds` | Histogram | `status` | Duración de la transferencia en el servicio, incluidos la espera de conexión del pool y los reintentos. Buckets: 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2 s. |
| `smartbancs_db_errors_total` | Counter | `sqlstate` | Errores de BD por SQLSTATE (`40P01`, `40001`, `55P03`, `57014`, `23505`, ...) y `POOL_TIMEOUT` cuando el pool no entrega conexión en `connectionTimeoutMillis` (5 s). |
| `smartbancs_deadlocks_detected_total` | Counter | `sqlstate` (`40P01`, `55P03`) | Deadlocks **y** lock timeouts. Para contar solo deadlocks hay que filtrar `sqlstate="40P01"`. |
| `smartbancs_transaction_retries_total` | Counter | `sqlstate` | Reintentos automáticos por `40P01` o `40001`. |
| `smartbancs_db_active_connections` | Gauge | — | Conexiones del pool en uso (`totalCount - idleCount`), leídas en cada scrape. |
| `smartbancs_db_pool_waiting_requests` | Gauge | — | Peticiones esperando conexión del pool, leídas en cada scrape (cada 5 s: puede no captar picos cortos). |
| `smartbancs_outbox_pending_events` | Gauge | — | Eventos del outbox sin publicar. Lo actualiza el relay tras cada lote. |
| `smartbancs_ai_recommendation_duration_seconds` | Histogram | `engine` (`gemini`, `heuristic`, `unknown`) | Latencia de inferencia que reporta el ai-service en `metadata.inferenceLatencyMs`. Se observa en el backend al recibir `POST /api/v1/recommendations`, incluidos los reenvíos duplicados. Buckets: 0.01 a 10 s. |

El ai-service **no expone `/metrics`**. Sus contadores (`totalInferences`, `geminiInferences`, `fallbackInferences`, `messagesAcked`, `messagesDeadLettered`) son variables en memoria que se ven en `GET /health` y `GET /model-info`. Prometheus solo scrapea el backend ([prometheus.yml](../docker/prometheus/prometheus.yml), `scrape_interval: 5s`). No se scrapean RabbitMQ ni PostgreSQL.

**Trazabilidad (R3.4h).** El recorrido del correlation ID es este:

1. `CorrelationIdMiddleware` acepta `x-correlation-id` del cliente si cumple `^[A-Za-z0-9._:-]{1,64}$`; si no, genera un UUID. Lo devuelve en la respuesta (el header está expuesto por CORS).
2. Se guarda en `transactions.correlation_id` y en `outbox_events.correlation_id`.
3. Viaja en el mensaje AMQP (body y `properties.correlationId`, con `messageId` = `eventId`).
4. El ai-service lo pone en el contexto de logs y lo reenvía como header `x-correlation-id` en el `POST /api/v1/recommendations`. Ese POST lo registra el interceptor del backend.

**Brechas:** `ai_recommendations` no guarda el correlation ID (sí guarda `metadata.eventId`), y el log "New AI recommendation saved" del servicio de recomendaciones no lo incluye. No hay trazas distribuidas (OpenTelemetry): la correlación es por ID en los logs.

**Dashboard Grafana (implementado, [smartbancs_dashboard.json](../docker/grafana/dashboards/smartbancs_dashboard.json)).** Hay un dashboard, "SmartBancs - Core Metrics Overview", con dos paneles:

- "SmartBancs Transactions Total": `sum by (status) (rate(smartbancs_transactions_total[1m]))`.
- "Transaction Latency (p95)": `histogram_quantile(0.95, sum(rate(smartbancs_transaction_duration_seconds_bucket[1m])) by (le))`.

El resto de los paneles de la sección 4.2 son propuestas. Hasta que existan, se consultan en Prometheus (`:9090`) con el PromQL de la tabla.

### 4.2. Diseño de observabilidad (R3.4i, R3.4j)

**Señales y por qué sirven.** Todas las consultas usan métricas que existen hoy.

| Señal | PromQL | Utilidad diagnóstica |
| :--- | :--- | :--- |
| Latencia p95/p99 de la transferencia | `histogram_quantile(0.95, sum by (le) (rate(smartbancs_transaction_duration_seconds_bucket{status="COMPLETED"}[5m])))` | Indicador directo del SLA de 2 s. El bucket finito más alto es 2 s: si el p95 cae en `+Inf`, `histogram_quantile` devuelve 2, y eso ya significa SLA violado. |
| Volumen (TPS) | `sum(rate(smartbancs_transactions_total{status="COMPLETED"}[1m]))` | Detecta el pico y lo correlaciona con la latencia. Si el TPS cae mientras la latencia sube, hay contención (locks o pool). |
| Tasa de error 5xx de transferencias | `sum(rate(http_requests_total{method="POST",route="/api/v1/transactions",status_code=~"5.."}[5m])) / sum(rate(http_requests_total{method="POST",route="/api/v1/transactions"}[5m]))` | Error visible al cliente. Se usa 5xx y no `FAILED` porque `FAILED` incluye rechazos de negocio legítimos. Las dos sumas agregan antes de dividir: si no, el cociente se evalúa serie a serie y da 1. |
| Causa del error por SQLSTATE | `sum by (sqlstate) (rate(smartbancs_db_errors_total[5m]))` | Distingue lock timeout (`55P03`, contención de fila), statement timeout (`57014`, consulta lenta), deadlock (`40P01`) y pool agotado (`POOL_TIMEOUT`). Cada uno lleva a una acción distinta. |
| Deadlocks reales | `sum(increase(smartbancs_deadlocks_detected_total{sqlstate="40P01"}[5m]))` | Con locks ordenados, un deadlock indica que otro proceso escribe `accounts` en otro orden. |
| Saturación del pool | `max(smartbancs_db_active_connections)` frente a `DB_POOL_MAX` (30); `max(smartbancs_db_pool_waiting_requests)` | Si hay espera sostenida en el pool, la latencia viene de la cola de conexiones y no de la consulta. |
| Reintentos | `sum by (sqlstate) (rate(smartbancs_transaction_retries_total[5m]))` | Muestra conflictos que se resolvieron sin error visible. Si suben, la contención está creciendo. |
| Backlog del outbox | `max(smartbancs_outbox_pending_events)` | Si crece de forma sostenida, el broker está caído o el relay no da abasto. La IA y Bancs se atrasan, pero las transferencias no. |
| Latencia de IA por motor | `histogram_quantile(0.95, sum by (le, engine) (rate(smartbancs_ai_recommendation_duration_seconds_bucket[5m])))` | Degradación de Gemini. La proporción de `engine="heuristic"` indica cuánto se usa el fallback. |
| Latencia HTTP por ruta | `histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))` | Localiza el problema: si solo la ruta de transferencias está lenta y las lecturas no, el problema está en la ruta de escritura. |
| Disponibilidad del backend | `up{job="smartbancs-backend"}` | Scrape fallido = proceso caído o inaccesible. |
| Logs con `correlationId` | (Loki/ELK, diseño) | Reconstruyen una transacción concreta: HTTP → BD → outbox → broker → IA → POST. |
| `pg_stat_statements`, `log_lock_waits`, `db-diagnostics` | SQL (sección 5.4) | Dan la consulta y el PID exactos: la métrica dice *qué* pasa y estas fuentes dicen *dónde*. |

**Alertas: PROPUESTA, no configurada.** `prometheus.yml` no tiene `rule_files` ni `alerting`, y compose no incluye Alertmanager. Las reglas propuestas son estas:

| Alerta | Expresión | `for` | Severidad |
| :--- | :--- | :--- | :--- |
| `TransferLatencyHigh` | `histogram_quantile(0.95, sum by (le) (rate(smartbancs_transaction_duration_seconds_bucket[5m]))) > 1` | 2m | SEV-3 (aviso) |
| `TransferSLAViolation` | `histogram_quantile(0.95, sum by (le) (rate(smartbancs_transaction_duration_seconds_bucket[5m]))) >= 2` | 1m | SEV-1 |
| `TransferErrorRateHigh` | Cociente 5xx de la tabla anterior `> 0.05` | 2m | SEV-1 |
| `DbPoolSaturated` | `max(smartbancs_db_pool_waiting_requests) > 0` o `max(smartbancs_db_active_connections) >= 24` (80 % de 30) | 1m | SEV-2 |
| `DbPoolTimeouts` | `sum(increase(smartbancs_db_errors_total{sqlstate="POOL_TIMEOUT"}[5m])) > 0` | 0m | SEV-2 |
| `LockContention` | `sum(rate(smartbancs_db_errors_total{sqlstate="55P03"}[5m])) > 1` | 2m | SEV-2 |
| `DeadlockDetected` | `sum(increase(smartbancs_deadlocks_detected_total{sqlstate="40P01"}[5m])) > 0` | 0m | SEV-2 |
| `OutboxBacklogGrowing` | `max(smartbancs_outbox_pending_events) > 1000` | 5m | SEV-3 |
| `BackendDown` | `up{job="smartbancs-backend"} == 0` | 1m | SEV-1 |

Los umbrales son valores iniciales y se calibran con la línea base de producción. Para demostrar las reglas no hace falta Alertmanager: basta con montarlas en `rule_files` y verlas en la pestaña Alerts de Prometheus.

**Dashboards propuestos (no existen en el repositorio):**

1. **Transaccional:** TPS, p50/p95/p99, 5xx por ruta, `FAILED` por categoría.
2. **Base de datos:** pool activo y en espera, errores por SQLSTATE, reintentos y, con `postgres_exporter` (diseño), locks y sesiones `idle in transaction`.
3. **Mensajería:** backlog del outbox y, con el plugin `rabbitmq_prometheus` (diseño), profundidad de `smartbancs.ai.queue`, `smartbancs.ai.dlq` y `smartbancs.bancs.sync.queue`.
4. **IA:** latencia p95 por motor y proporción de fallback. Los mensajes enviados a la DLQ requieren exponer `/metrics` en el ai-service (diseño).

---

## 5. Reto 3.5: operaciones, incidente crítico simulado de quincena

### 5.1. Escenario y mecanismo

El enunciado describe tres síntomas en un pico de quincena: latencia alta, timeouts de conexión con la BD y posibles deadlocks. Sobre este sistema, la cadena causal es esta:

1. **Contención de fila.** Cada transferencia toma `FOR UPDATE` sobre las dos cuentas y retiene los locks hasta el `COMMIT`. Si muchas transferencias tocan la misma cuenta (por ejemplo, la cuenta pagadora de nómina), se serializan.
2. **Pool retenido.** Mientras una transacción espera un lock, retiene una conexión del pool (máximo 30). Con suficientes esperas, el pool se llena.
3. **Timeout de conexión.** Las peticiones siguientes esperan conexión en la cola de `pg-pool` hasta `connectionTimeoutMillis` (5 s, [app.module.ts](../backend/src/app.module.ts)) y fallan con "timeout exceeded when trying to connect".
4. **Deadlocks.** Dos transferencias sobre las mismas cuentas no pueden hacer deadlock entre sí, porque ambas bloquean en el mismo orden. Un deadlock requiere otro proceso que escriba `accounts` en otro orden.

### 5.2. Simulación del pico en la aplicación

La consola *Simulación de Quincena* del frontend (o `POST /api/v1/simulation/quincena-spike`, con `SIMULATION_ENABLED=true`) dispara entre 1.000 y 10.000 transferencias concurrentes (50 en vuelo a la vez) entre las cuentas semilla, a través del mismo `TransactionsService` que usa la API. Con solo 5 cuentas, todas las transferencias compiten por las mismas filas: es el peor caso de contención, el que describe el enunciado.

Informa transferencias exitosas y fallidas, errores agrupados, latencia promedio y p95, **TPS medidos** y la **suma de saldos antes y después**, que debe ser idéntica (invariante ACID). La carga sintética no genera recomendaciones de IA, para no disparar miles de llamadas a Gemini; sí escribe el evento `bancs.sync` en el outbox, así que también se ve el backlog del relay (`smartbancs_outbox_pending_events`).

**Medición de referencia** (una instancia del backend, PostgreSQL 16 local, pool de 30):

| Transferencias | Exitosas | Duración | TPS medidos | p95 | Dinero total |
|---|---|---|---|---|---|
| 1.000 | 1.000 | 3,5 s | 287 | 480 ms | se conserva |
| 10.000 | 10.000 | 24,9 s | 402 | 361 ms | se conserva |

Estas cifras validan la corrección bajo concurrencia y el SLA de < 2 s con contención máxima. **No demuestran 10.000 TPS**: eso requiere escalar horizontalmente y repartir la carga entre muchas cuentas (sección 1.3).

### 5.3. Controles implementados en el código

| Control | Dónde | Efecto |
| :--- | :--- | :--- |
| Locks en orden determinista | `executeTransfer`: `const [firstAccNum, secondAccNum] = [sourceAccountNumber, targetAccountNumber].sort();` | Elimina el ciclo de espera entre dos transferencias sobre las mismas cuentas. El reintento por `40P01` queda como defensa en profundidad para rutas no previstas. |
| Aritmética en SQL | `UPDATE accounts SET balance = balance - $1::numeric ... WHERE account_number = $2 AND balance >= $1::numeric RETURNING balance` | El débito es condicional al saldo y exacto en `NUMERIC`: no hay errores de redondeo de `float` ni doble gasto. |
| `lock_timeout` y `statement_timeout` por transacción | `SET LOCAL lock_timeout = '2000ms'` y `SET LOCAL statement_timeout = '5000ms'` (`DB_LOCK_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`) | Una fila bloqueada o una consulta lenta no retienen la conexión indefinidamente. |
| Clasificación por SQLSTATE | `processTransaction`, `pgErrorCode`, `isPoolTimeout` | `40P01` y `40001` se reintentan hasta 2 veces (`TX_MAX_ATTEMPTS=3` intentos en total), con backoff `20·intento + jitter(0–30) ms`. Al agotarse, o ante `55P03`, `57014` o `POOL_TIMEOUT`, responde `503` (reintentable por el cliente). Todo queda en `smartbancs_db_errors_total`. |
| Idempotencia | Header `Idempotency-Key` + índice único parcial `uq_transactions_idempotency_key` | Un reintento del cliente tras un `503` o un timeout no produce un segundo débito. La misma clave con otro payload responde `422`. |
| Outbox | La sección 2.1 | Una caída del broker o de la IA no afecta a la transferencia. |
| Prueba automatizada | [concurrency.int-spec.ts](../backend/test/concurrency.int-spec.ts) (12 pruebas) | Conservación de saldos, doble gasto, montos al centavo, idempotencia, pool agotado → `503` + `POOL_TIMEOUT`, y relay con confirmaciones. |

No está configurado: `idle_in_transaction_session_timeout` (se propone en la sección 6), circuit breaker, rate limiting en la API ni PgBouncer.

### 5.4. Cómo se identifica el proceso exacto (R3.5a–c, implementado)

- **Cuello de botella y consulta exacta (R3.5a):**
  - `GET /api/v1/simulation/db-diagnostics` (`SimulationService.getDatabaseDiagnostics`, requiere `SIMULATION_ENABLED=true`) devuelve lo siguiente:
    - `blockingChains`: quién bloquea a quién, con `pg_blocking_pids`, la consulta de ambos lados, los segundos de espera y la antigüedad de la transacción que bloquea.
    - `activeQueries` de `pg_stat_activity`, con `wait_event` y duración.
    - Conteo de sesiones `idle in transaction` de más de 5 s.
    - Estado del pool (`total`, `idle`, `waiting`).
    - Un `healthStatus` calculado a partir de esos datos (`HEALTHY`, `DEGRADED` o `CRITICAL`), con una acción recomendada.
  - Además: `pg_stat_statements` (ranking por tiempo total y medio) y `log_min_duration_statement`. Las consultas del runbook están en [00-observability.sql](../backend/sql/00-observability.sql).
- **Timeouts de conexión (R3.5b):** `smartbancs_db_errors_total{sqlstate="POOL_TIMEOUT"}`, los gauges `smartbancs_db_active_connections` y `smartbancs_db_pool_waiting_requests`, y el log de error con `sqlstate: "POOL_TIMEOUT"` y `correlationId`.
- **Deadlocks y locks (R3.5c):**
  - `smartbancs_db_errors_total{sqlstate="40P01"}` y `{sqlstate="55P03"}`, y `smartbancs_transaction_retries_total`.
  - El log de error del backend incluye `sqlstate`, `attempt` y `query`.
  - El log de PostgreSQL registra, gracias a `log_lock_waits` y a su propio detector de deadlocks, las sentencias y los PIDs involucrados.

### 5.5. Acciones inmediatas (R3.5d, runbook)

Principio: estabilizar primero y diagnosticar a fondo después. Los pasos van en orden de menor a mayor impacto.

1. **Confirmar el alcance con datos.** Mirar el p95, la tasa 5xx, los errores por SQLSTATE y el pool (consultas de la sección 4.2). Decidir la severidad (sección 6.2).
2. **Encontrar la cabeza de la cadena de bloqueo** con `db-diagnostics` (`blockingChains.blocking_pid`) o con la consulta 2 de `00-observability.sql`.
3. **Liberar locks.** Primero `SELECT pg_cancel_backend(<pid>);`, que cancela solo la consulta. Si la sesión está `idle in transaction` o no cede, usar `SELECT pg_terminate_backend(<pid>);`. Se aplica a la cabeza de la cadena, no a todas las sesiones en espera.
4. **Quitar carga no esencial.**
   - Pausar jobs batch que escriban `accounts` y los reportes pesados.
   - Si hace falta, detener el ai-service (sus eventos esperan en la cola).
   - Si el broker es el problema, desplegar las réplicas sobrantes con `OUTBOX_RELAY_ENABLED=false` (requiere reiniciarlas; los eventos esperan en `outbox_events`).
5. **Control de admisión y red.**
   - Rate limit en el gateway o balanceador (diseño: no hay gateway en el MVP), respondiendo `429`/`503` con `Retry-After`.
   - Alinear los timeouts del gateway con los del servicio para que no reintente peticiones que el backend ya está procesando.
   - Drenar el tráfico de nodos degradados.
6. **Balancear y escalar con criterio.** Agregar réplicas de la API solo si el cuello no es la BD. Si es el pool o los locks, más réplicas empeoran la situación. Mover las lecturas de saldo e historial a una réplica de lectura (diseño).
7. **Revertir** el último despliegue o cambio de configuración si coincide con el inicio del incidente.
8. Registrar cada acción con su hora en el documento vivo del incidente.

---

## 6. Reto 3.6: gestión de incidentes TI, escalamiento y post mortem

### 6.1. Proceso de escalamiento (R3.6b, propuesta de proceso)

**Severidades:**

| Severidad | Criterio | Acuse de recibo | Quién se involucra | Comunicación |
| :--- | :--- | :--- | :--- | :--- |
| SEV-1 | Transferencias fallando o SLA de 2 s violado para una fracción visible de clientes (p. ej. p95 ≥ 2 s o 5xx > 5 % durante más de 1 min). Si hay duda, se clasifica como SEV-1. | 5 min | On-call SRE (Incident Commander inicial), on-call backend, DBA on-call | Estado a negocio y a atención al cliente cada 30 min |
| SEV-2 | Degradación parcial sin pérdida de transferencias: pool en espera, lock timeouts, IA o Bancs atrasados. | 15 min | On-call SRE y dueño del servicio | Canal del incidente cada 60 min |
| SEV-3 | Riesgo sin impacto al cliente: backlog del outbox o fallback de IA. | Horario laboral | Equipo dueño | Ticket |

**Cadena:**

1. Alerta.
2. On-call SRE: confirma y declara, y asume el rol de Incident Commander.
3. En SEV-1, a los 10 min: DBA on-call + on-call backend. Se asignan los roles de Operaciones (el único que toca producción), Comunicación y Planificación.
4. Si el SEV-1 no está mitigado en 30 min: jefe de ingeniería y responsable de negocio. Si hay riesgo sobre saldos o Bancs: equipo del core Bancs.
5. Cierre: el IC declara el incidente resuelto tras 30 min estables y abre el post mortem, que se entrega en un máximo de 5 días hábiles.

**Criterio para declarar un incidente:** hay impacto visible al cliente, hace falta otro equipo, o no se resuelve en 1 h de análisis.

### 6.2. Post mortem INC-QUINCENA-01 (R3.6a)

> **Nota.** Es un incidente **simulado** para el reto. El escenario, el proceso batch y todas las cifras (horas, volúmenes, impacto) son hipotéticos y sirven para ilustrar el análisis. Los mecanismos, métricas, archivos y valores de configuración que se citan son los reales del repositorio. Se asume un despliegue productivo con las alertas propuestas en la sección 4.2 ya configuradas (en el MVP no existen).

**Resumen.** Durante el pico de quincena, las transferencias que involucraban la cuenta pagadora de nómina y otras cuentas de alto tráfico empezaron a responder `503` y, luego, con demoras de más de 5 s. La causa fue contención de locks sobre filas calientes de `accounts`, amplificada por un proceso batch de conciliación (hipotético) que escribía `accounts` en un orden distinto al de la API. Estado: resuelto. Autores: SRE on-call y equipo backend. El formato es *blameless*.

**Impacto (ilustrativo).**

- 22 minutos de degradación (15:04–15:26), de los cuales 14 con el SLA violado (p95 ≥ 2 s).
- Alrededor de 4 % de las transferencias respondieron `503` en la ventana. No hubo pérdida ni duplicación de dinero, por el `CHECK (balance >= 0)`, la aritmética condicional y la `Idempotency-Key`.
- Las recomendaciones de IA y los eventos hacia Bancs se atrasaron unos minutos, pero no se perdieron: quedaron en el outbox y en las colas.

**Línea de tiempo (UTC, ilustrativa).**

| Hora | Evento |
| :--- | :--- |
| 15:00 | Empieza la dispersión de nómina: el TPS sobre la cuenta pagadora sube de forma abrupta. |
| 15:02 | Arranca el job batch de conciliación, que actualiza saldos de `accounts` cuenta por cuenta en el orden del archivo recibido. |
| 15:04 | `smartbancs_db_errors_total{sqlstate="55P03"}` sube: las transferencias en espera agotan el `lock_timeout` de 2 s y responden `503`. `smartbancs_transaction_retries_total{sqlstate="40P01"}` también sube. |
| 15:06 | Se dispara `LockContention` (SEV-2). El on-call SRE acusa recibo. |
| 15:09 | `smartbancs_db_active_connections` = 30/30 y `smartbancs_db_pool_waiting_requests` > 0. Aparecen `POOL_TIMEOUT`. Se disparan `DbPoolSaturated` y `DbPoolTimeouts`. |
| 15:12 | Se dispara `TransferSLAViolation`: el p95 cae en el bucket `+Inf` (≥ 2 s). El IC declara SEV-1 y escala al DBA y al on-call backend. |
| 15:15 | `db-diagnostics` devuelve `healthStatus: CRITICAL`. Las cabezas de `blockingChains` son sesiones del job batch con transacciones largas, y un grupo de transferencias espera sobre la fila de la cuenta pagadora. El log de PostgreSQL (`log_lock_waits`) muestra las esperas y los PIDs. |
| 15:18 | Mitigación 1: se pausa el job batch y se cancelan sus sesiones (`pg_cancel_backend`, luego `pg_terminate_backend` para dos sesiones `idle in transaction`). Los `40P01` bajan a 0. |
| 15:22 | Mitigación 2: rate limit temporal en el gateway para la cuenta pagadora. El pool deja de tener espera. |
| 15:26 | El p95 vuelve bajo 1 s. `smartbancs_outbox_pending_events` drena el backlog. |
| 15:56 | Tras 30 min estables, el IC declara el incidente resuelto, retira el rate limit temporal y abre el post mortem. El job batch queda suspendido hasta corregirlo (acciones 1 y 2). |

**Detección.** Los primeros síntomas los detectaron las alertas propuestas de lock timeout y pool, antes de la violación del SLA. Punto débil: la alerta de SLA llegó 8 minutos después de los primeros `503`. En el MVP real no hay alertas configuradas: se habría detectado por reportes de usuarios o por el panel de p95 de Grafana.

**Causa raíz.**

1. **Hot row.** Todas las transferencias de nómina toman `FOR UPDATE` sobre la misma fila (la cuenta pagadora) y se serializan. Cuando la llegada supera el ritmo al que se libera ese lock, las esperas crecen hasta `lock_timeout` → **latencia** y `503` (`55P03`).
2. **Pool retenido.** Cada transacción en espera retiene una de las 30 conexiones del pool durante hasta 2 s. Con el pool lleno, las peticiones nuevas esperan hasta 5 s en `pg-pool` → **timeouts de conexión** (`POOL_TIMEOUT`).
3. **Orden de locks inconsistente entre procesos.** El job batch escribía `accounts` sin respetar el orden por `account_number` que usa la API. Se formaron ciclos de espera API ↔ batch → **deadlocks** (`40P01`). PostgreSQL los resuelve tras `deadlock_timeout` (1 s), pero mientras tanto cada ciclo retiene locks y conexiones.

**Factores contribuyentes:** no hay control de admisión antes del pool; el job batch no tiene `lock_timeout` ni límite de duración de transacción; y no hay `idle_in_transaction_session_timeout`.

**Resolución.** Se pausó el batch, se terminaron las sesiones que bloqueaban y se aplicó el rate limit. No hizo falta reiniciar la API. Los eventos pendientes se publicaron solos al drenar el outbox.

**Lecciones aprendidas.**

- **Qué funcionó:**
  - La falla rápida (`lock_timeout` + `503`) evitó que las peticiones se colgaran indefinidamente.
  - La clasificación por SQLSTATE separó contención (`55P03`), pool (`POOL_TIMEOUT`) y deadlock (`40P01`), y cada señal llevó a una acción distinta.
  - El outbox aisló la IA y Bancs.
- **Qué falló:**
  - Faltaban un control de admisión y una regla común de orden de locks para todo proceso que escriba `accounts`.
  - El único dashboard tenía dos paneles; el diagnóstico del pool se hizo con consultas manuales en Prometheus.
- **Dónde hubo suerte:** el pico cayó en horario laboral, con el DBA disponible.

**Acciones: ya implementadas en el repositorio (evidencia).**

| Acción | Ámbito | Evidencia |
| :--- | :--- | :--- |
| `lock_timeout` y `statement_timeout` por transacción, con `503` | Código | `transactions.service.ts`, `executeTransfer` |
| Reintento de `40P01`/`40001` con backoff y jitter; `503` al agotarse | Código | `transactions.service.ts`, `processTransaction` |
| `POOL_TIMEOUT` → `503` + métrica | Código | `isPoolTimeout`, [prueba "Pool agotado"](../backend/test/concurrency.int-spec.ts) |
| Idempotencia estricta (`422` con otro payload) | Código | `assertSameRequest`, índice `uq_transactions_idempotency_key` |
| Diagnóstico con `pg_blocking_pids` y `healthStatus` calculado | Código | `simulation.service.ts`, `getDatabaseDiagnostics` |
| `pg_stat_statements`, `log_lock_waits`, `log_min_duration_statement` | Infraestructura | [docker-compose.yml](../docker-compose.yml), [00-observability.sql](../backend/sql/00-observability.sql) |
| Simulación de pico acotada (≤ 500 operaciones, ≤ 100 concurrentes) y deshabilitable | Código | `quincena-spike.dto.ts`, `SIMULATION_ENABLED` |

**Acciones: propuestas (no implementadas).**

| # | Acción | Tipo | Ámbito | Responsable | Plazo |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Una sola función de lock para todo escritor de `accounts` (orden por `account_number`), más una regla de revisión de código | Prevenir | Código | Líder backend | Sprint 1 |
| 2 | `lock_timeout` y duración máxima de transacción para roles batch (`ALTER ROLE batch SET lock_timeout = '2s'`); lotes cortos con commits frecuentes | Prevenir | Código / BD | DBA + dueño del job | Sprint 1 |
| 3 | `idle_in_transaction_session_timeout = 10s` en PostgreSQL | Prevenir | Infraestructura | DBA | Sprint 1 |
| 4 | Reglas de alerta de la sección 4.2 en `rule_files` + Alertmanager con rutas por severidad | Detectar | Infraestructura | SRE | Sprint 1 |
| 5 | Paneles de pool, SQLSTATE, reintentos y outbox en Grafana | Detectar | Infraestructura | SRE | Sprint 1 |
| 6 | Control de admisión en el gateway (rate limit por cliente y por cuenta) y circuit breaker que corte ante 503 sostenido | Mitigar | Infraestructura / Código | SRE + backend | Sprint 2 |
| 7 | Tratamiento de la cuenta pagadora: subcuentas de dispersión o nómina como lote en el core | Prevenir | Código / Negocio | Arquitectura + negocio | Sprint 3 |
| 8 | PgBouncer en modo transaction; réplicas de lectura para saldos e historial | Prevenir | Infraestructura | SRE / DBA | Sprint 2 |
| 9 | Prueba de carga de quincena en **staging** antes de cada fecha pico (k6 + `quincena-spike`), con p95 y TPS versionados como evidencia | Proceso | QA / SRE | QA | Recurrente |
| 10 | Ejecutar `npm run test:int` en CI en cada merge | Proceso | Código | Backend | Sprint 1 |

**Información de soporte:** las consultas de la sección 5.4, el export del dashboard y los logs filtrados por `correlationId` de transacciones fallidas.

---

## 7. Trazabilidad con el reto

Estados: **Implementado** = existe en el código y se puede ejecutar; **Diseño** = descrito en este documento, sin implementación; **Parcial** = una parte implementada y el resto en diseño.

| ID | Requisito | Dónde | Estado |
| :--- | :--- | :--- | :--- |
| R3.1a | Endpoint de transacción | [transactions.controller.ts](../backend/src/modules/transactions/transactions.controller.ts) (`POST /api/v1/transactions`) | Implementado |
| R3.1b | DDL | [schema.sql](../backend/sql/schema.sql) | Implementado |
| R3.1c | DML semilla | [seed.sql](../backend/sql/seed.sql), `database/seeds/seed.service.ts` | Implementado |
| R3.1d | Interacción real con BD | `transactions.service.ts` (TypeORM `QueryRunner` + SQL) | Implementado |
| R3.1e | Concurrencia sin race conditions, con prueba | Sección 5.2; [concurrency.int-spec.ts](../backend/test/concurrency.int-spec.ts) | Implementado |
| R3.1f | IaC en un comando | [docker-compose.yml](../docker-compose.yml); despliegue en la nube con [infra/terraform](../infra/terraform) y [CI/CD](../.github/workflows/ci-cd.yml) | Implementado |
| R3.2a | Flujo app ↔ Bancs | Sección 2.1 | Parcial (outbox y cola implementados; CDC desde Bancs en diseño) |
| R3.2b | Saldos sin saturar Bancs | Sección 2.1 (cola durable; worker con rate limiting) | Parcial (cola implementada; worker en diseño) |
| R3.2c | Script ETL | [etl_bancs_processor.py](../etl-bancs/etl_bancs_processor.py) | Implementado |
| R3.2d | Manejo de nulos | Sección 2.2 | Implementado |
| R3.2e | Estandarización | Sección 2.2 | Implementado |
| R3.2f | Salida para IA | `bancs_cleaned_features.json` | Implementado |
| R3.3a | Servicio de IA independiente | `ai-service/` | Implementado |
| R3.3b | Consumo asíncrono | Outbox → relay → RabbitMQ → `consumer.py` | Implementado |
| R3.3c | La IA no afecta la latencia | `TransactionsService` sin dependencia de broker ni IA; prueba unitaria del outbox en [transactions.service.spec.ts](../backend/src/modules/transactions/transactions.service.spec.ts) | Implementado (sin medición de carga) |
| R3.3d | Ciclo de vida del modelo | [IA_IMPLEMENTACION_Y_DESPLIEGUE.md](IA_IMPLEMENTACION_Y_DESPLIEGUE.md) §2.1: datos por inferencia y versión del modelo por configuración | Parcial |
| R3.3e | Data drift | Ídem §2.2: con un LLM consumido por API se monitorean entrada, salida y proveedor (métrica por `engine`, DLQ) | Parcial |
| R3.3f | Consumo de recursos | Ídem §2.4 (prefetch, timeouts, límite de tokens y límites de CPU/memoria en Cloud Run) | Parcial |
| R3.4a | Log de transacciones exitosas | Sección 4.1 | Implementado |
| R3.4b | Log de errores | Sección 4.1 | Implementado |
| R3.4c | Log de llamadas a IA | `advisor.py`, `consumer.py` | Implementado |
| R3.4d | Log de interacciones con BD | Logs de transacción con `query`/`sqlstate`, logs de PostgreSQL | Implementado |
| R3.4e | Métrica de volumen | `smartbancs_transactions_total`, `http_requests_total` | Implementado |
| R3.4f | Métrica de errores | `smartbancs_db_errors_total`, 5xx en `http_requests_total` | Implementado |
| R3.4g | Métrica de latencia | `smartbancs_transaction_duration_seconds`, `http_request_duration_seconds` | Implementado |
| R3.4h | Trazabilidad entre componentes | Sección 4.1 (correlation ID de punta a punta) | Implementado (sin OpenTelemetry) |
| R3.4i | Señales de degradación | Sección 4.2 (alertas propuestas) | Diseño |
| R3.4j | Justificación de cada dato | Sección 4.2 | Diseño |
| R3.5a | Consulta exacta del cuello de botella | `db-diagnostics`, `pg_stat_statements`, logs | Implementado |
| R3.5b | Timeouts de conexión | `POOL_TIMEOUT`, gauges del pool | Implementado |
| R3.5c | Deadlocks | SQLSTATE `40P01`, `log_lock_waits`, reintentos | Implementado |
| R3.5d | Acciones inmediatas | Sección 5.5 | Diseño (runbook) |
| R3.6a | Estructura del post mortem | Sección 6.2 | Diseño |
| R3.6b | Escalamiento | Sección 6.1 | Diseño |
| R3.6c | Prevención en infraestructura | Sección 6.2 (acciones 3, 4, 5, 6, 8) | Diseño |
| R3.6d | Prevención en código | Sección 6.2 (implementadas + acciones 1, 2, 7) | Parcial |
| RNF-1 | 10.000 TPS | Sección 1.3 | Diseño. Medido en el MVP: 402 TPS con una instancia y 5 cuentas en máxima contención (sección 5.2) |
| RNF-2 | Transferencia < 2 s | Transferencia sin dependencias externas en el camino crítico; timeouts de 2 s (lock) y 5 s (sentencia, pool); métrica p95 | Implementado: p95 de 361 ms con 10.000 transferencias concurrentes en la simulación (sección 5.2, entorno local) |
| RNF-3 | La IA no bloquea | Outbox + cola (sección 2.1, sección 3) | Implementado |
| RNF-4 | Bancs sin alto volumen directo | Cola durable implementada; worker con rate limiting y CDC en diseño | Parcial |
| RNF-5 | Stack justificado | Secciones 1.2 y 1.4 | Diseño (documento) |
