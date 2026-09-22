# SmartBancs App - Diagramas de arquitectura

Diagramas derivados del código fuente, no de la documentación. Reflejan el estado del repositorio después de la ronda de correcciones de la segunda revisión ([docs/revision/](revision/README.md)).

Convención: lo marcado como **(diseño)** no existe en el código del MVP; solo está descrito en [DOCUMENTO_TECNICO.md](DOCUMENTO_TECNICO.md). Todo lo demás se verificó en `docker-compose.yml`, `backend/src`, `backend/sql`, `ai-service`, `etl-bancs`, `frontend/src/services/api.ts` y `docker/`.

Los bloques Mermaid se validaron con `mermaid-cli` (`mmdc`): los ocho renderizan sin errores.

## 1. Vista de contenedores (C4 nivel 2)

Siete contenedores definidos en `docker-compose.yml` sobre la red `smartbancs-network`. El navegador llama directamente al backend en `:4000`: el nginx del frontend solo sirve estáticos y no hace proxy de `/api`. PostgreSQL y RabbitMQ tienen healthcheck, y el backend espera a ambos con `condition: service_healthy`. El core Bancs no existe como servicio: la cola `smartbancs.bancs.sync.queue` se declara y recibe mensajes, pero ningún proceso la consume.

```mermaid
flowchart LR
    user(["Cliente / Operador<br/>navegador"])

    subgraph compose["docker compose - red smartbancs-network"]
        fe["frontend<br/>React + Vite servido por nginx<br/>:3000 -> 80"]
        be["backend<br/>NestJS + TypeORM + prom-client<br/>relay del outbox<br/>:4000"]
        pg[("postgres 16<br/>:5432, healthcheck<br/>vol postgres_data")]
        mq{{"rabbitmq 3.13<br/>AMQP :5672 / UI :15672, healthcheck<br/>exchange smartbancs.events topic<br/>DLX smartbancs.dlx"}}
        ai["ai-service<br/>FastAPI + pika<br/>:8000"]
        prom["prometheus v2.51<br/>:9090"]
        graf["grafana 10.4<br/>:3001 -> 3000"]
    end

    etl["etl-bancs<br/>script Python pandas<br/>ejecución manual, fuera del compose"]
    gem["Google Gemini API<br/>gemini-3.6-flash<br/>externo, opcional"]
    worker["Worker hacia Bancs<br/>rate limiting<br/>(diseño)"]
    bancs["Core Bancs legado<br/>externo"]

    user -->|"HTTP :3000 estáticos"| fe
    user -->|"HTTP REST :4000 /api/v1"| be
    be -->|"SQL, pool pg max 30"| pg
    be -->|"AMQP confirm channel<br/>relay del outbox"| mq
    mq -->|"AMQP smartbancs.ai.queue"| ai
    ai -->|"HTTP POST /api/v1/recommendations<br/>3 intentos"| be
    ai -->|"HTTPS generateContent<br/>solo con GEMINI_API_KEY"| gem
    prom -->|"scrape /metrics cada 5 s"| be
    graf -->|"PromQL"| prom
    mq -.->|"smartbancs.bancs.sync.queue"| worker
    worker -.-> bancs
    bancs -.->|"CSV crudo bancs_raw_transactions.csv"| etl
```

## 2. Secuencia de una transferencia (camino síncrono)

Todo ocurre en una sola transacción `READ COMMITTED` y la respuesta sale tras el `COMMIT`. El débito y el crédito se calculan en `NUMERIC` dentro de PostgreSQL (`UPDATE ... SET balance = balance - $1::numeric ... WHERE balance >= $1`), no en `float` de JavaScript. `TX_MAX_ATTEMPTS=3` son tres intentos en total, es decir, hasta dos reintentos.

```mermaid
sequenceDiagram
    autonumber
    participant FE as Frontend
    participant API as TransactionsController
    participant SVC as TransactionsService
    participant DB as PostgreSQL

    FE->>API: POST /api/v1/transactions<br/>Idempotency-Key + x-correlation-id
    API->>API: DTO: amount 0.01..1000000 con máx. 2 decimales, currency USD<br/>Idempotency-Key de máx. 64 caracteres (si no, 400)
    API->>SVC: processTransaction(dto, correlationId, idempotencyKey)
    SVC->>DB: SELECT transactions WHERE idempotency_key
    alt clave ya usada con el mismo origen, destino y monto
        SVC-->>FE: 201 con la transacción original, sin nuevo débito
    else clave ya usada con otro payload
        SVC-->>FE: 422 Unprocessable Entity
    else clave nueva o sin clave
        loop intento 1..3
            SVC->>DB: BEGIN READ COMMITTED
            SVC->>DB: SET LOCAL lock_timeout 2000ms, statement_timeout 5000ms
            SVC->>DB: SELECT accounts FOR UPDATE, cuentas en orden sort()
            SVC->>SVC: valida ACTIVE y misma moneda (si no, 400 o 404)
            SVC->>DB: UPDATE balance - monto WHERE balance >= monto RETURNING
            SVC->>DB: UPDATE balance + monto del destino
            SVC->>DB: INSERT transactions COMPLETED
            SVC->>DB: INSERT outbox_events transaction.created y bancs.sync
            SVC->>DB: COMMIT
            opt 40P01 deadlock o 40001 serialización
                SVC->>SVC: ROLLBACK, retries_total++, backoff con jitter
            end
        end
        alt éxito
            SVC-->>FE: 201 Created
        else UPDATE sin filas (fondos insuficientes)
            SVC-->>FE: 400 Bad Request, sin mover dinero
        else 55P03 lock_timeout, 57014 statement_timeout, POOL_TIMEOUT o reintentos agotados
            SVC-->>FE: 503 Service Unavailable y smartbancs_db_errors_total por SQLSTATE
        else 23505 carrera con la misma Idempotency-Key
            SVC-->>FE: 201 con la transacción ganadora, o 422 si el payload difiere
        end
    end
```

## 3. Secuencia asíncrona: relay, IA y DLQ

Fuera del camino crítico. El relay sondea cada `OUTBOX_POLL_INTERVAL_MS` (500 ms en compose) con lotes de `OUTBOX_BATCH_SIZE=100` y repite lotes mientras haya backlog (hasta 10 por ciclo). Solo marca `published_at` en los eventos que el broker confirmó (*publisher confirms*). El ai-service hace `ack` solo cuando el backend confirmó la persistencia; si no, `nack` sin requeue y RabbitMQ enruta el mensaje a `smartbancs.ai.dlq`.

```mermaid
sequenceDiagram
    autonumber
    participant RL as OutboxRelayService
    participant DB as PostgreSQL
    participant MQ as RabbitMQ
    participant AI as ai-service consumer
    participant GEM as Gemini API
    participant API as backend /recommendations
    participant DLQ as smartbancs.ai.dlq

    RL->>DB: BEGIN, SELECT outbox_events WHERE published_at IS NULL<br/>ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED
    RL->>MQ: publish del lote en smartbancs.events (persistent, messageId = eventId)
    MQ-->>RL: ack o nack por mensaje (timeout 5 s = no confirmado)
    RL->>DB: UPDATE published_at = now() WHERE id = ANY(confirmados)
    RL->>DB: UPDATE attempts + 1, last_error WHERE id = ANY(no confirmados)
    RL->>DB: COMMIT
    Note over RL,MQ: Broker caído: publishEvent devuelve false sin publicar,<br/>el evento queda pendiente y el backend reconecta con backoff (tope 30 s)

    MQ->>AI: smartbancs.ai.queue, prefetch 5
    alt JSON inválido o sin data.accountNumber
        AI->>MQ: basic_nack requeue=false
        MQ->>DLQ: dead-letter vía smartbancs.dlx
    else mensaje válido
        alt GEMINI_API_KEY configurada
            AI->>GEM: generateContent, timeout 10 s
            GEM-->>AI: JSON de recomendación
        end
        Note over AI: sin key, 429, timeout o respuesta inválida:<br/>motor heurístico local, metadata.engine = heuristic-fallback
        loop hasta 3 intentos (espera 0.5 s y 1 s)
            AI->>API: POST /api/v1/recommendations + x-correlation-id<br/>metadata.engine, inferenceLatencyMs, eventId
        end
        alt 2xx o 409
            API->>DB: INSERT ai_recommendations (idempotente por transaction_id)
            AI->>MQ: basic_ack
        else 4xx, o timeout / conexión / 5xx en los 3 intentos
            AI->>MQ: basic_nack requeue=false
            MQ->>DLQ: dead-letter vía smartbancs.dlx
        end
    end
```

## 4. Modelo de datos

Exacto a `backend/sql/schema.sql`. No hay claves foráneas declaradas: las relaciones son lógicas por `account_number` y por id de transacción (línea discontinua). `ai_recommendations.transaction_id` y `outbox_events.aggregate_id` son `varchar(64)` que guardan el UUID de `transactions.id`. Las unicidades de `idempotency_key` y `transaction_id` son índices únicos parciales (`WHERE ... IS NOT NULL`). La idempotencia compara origen, destino y monto de la transacción guardada; no hay columna de hash del request.

```mermaid
erDiagram
    accounts {
        uuid id PK "gen_random_uuid"
        varchar(20) account_number UK "NOT NULL"
        varchar(100) account_holder "NOT NULL"
        varchar(50) client_id "idx"
        account_type_enum type "SAVINGS CHECKING INVESTMENT"
        numeric balance "18,2 CHECK >= 0"
        varchar(3) currency "USD"
        account_status_enum status "ACTIVE BLOCKED INACTIVE"
        int version "default 1"
        timestamptz created_at
        timestamptz updated_at
    }
    transactions {
        uuid id PK
        varchar(64) correlation_id "idx"
        varchar(20) source_account_number "idx"
        varchar(20) target_account_number "idx"
        numeric amount "18,2 CHECK > 0"
        varchar(3) currency
        varchar(255) description
        transaction_category_enum category
        transaction_status_enum status "PENDING COMPLETED FAILED"
        varchar(500) error_message
        int execution_time_ms
        varchar(64) idempotency_key UK "único parcial"
        timestamptz created_at "idx DESC"
    }
    ai_recommendations {
        uuid id PK
        varchar(20) account_number "idx"
        varchar(64) transaction_id UK "único parcial"
        recommendation_type_enum type
        varchar(150) title
        text message
        numeric confidence_score "5,4"
        jsonb metadata "engine, inferenceLatencyMs, eventId"
        boolean is_read
        timestamptz created_at "idx DESC"
    }
    outbox_events {
        uuid id PK "viaja como eventId y messageId"
        varchar(50) aggregate_type "transaction"
        varchar(64) aggregate_id "id de transactions"
        varchar(100) event_type "routing key"
        jsonb payload
        varchar(64) correlation_id
        int attempts "default 0"
        varchar(500) last_error
        timestamptz created_at "idx parcial pendientes"
        timestamptz published_at "NULL = pendiente"
    }
    accounts ||..o{ transactions : "source/target_account_number, lógica"
    accounts ||..o{ ai_recommendations : "account_number, lógica"
    transactions ||..o| ai_recommendations : "transaction_id, lógica"
    transactions ||..|{ outbox_events : "aggregate_id, 2 eventos por tx"
```

## 5. Sincronización con Bancs y ETL

Implementado: el evento `bancs.sync` en el outbox, su publicación con confirmación y la cola durable `smartbancs.bancs.sync.queue`; el pipeline ETL batch. Diseñado pero sin código: el worker con rate limiting hacia Bancs y el conector CDC. La DLQ existe solo para la cola de IA; la cola de Bancs no tiene DLX, `x-max-length` ni consumidor.

```mermaid
flowchart LR
    subgraph impl_out["Salida hacia Bancs - implementado hasta la cola"]
        tx["TransactionsService<br/>INSERT outbox_events<br/>event_type bancs.sync"]
        relay["OutboxRelayService<br/>SKIP LOCKED + publisher confirms"]
        q[["smartbancs.bancs.sync.queue<br/>binding bancs.sync<br/>durable, sin consumidor"]]
    end
    worker["Worker Bancs<br/>token bucket, micro-lotes<br/>(diseño)"]
    bancs[("Core Bancs legado<br/>(diseño)")]
    cdc["Conector CDC Debezium<br/>(diseño)"]

    subgraph etl["Pipeline ETL - etl_bancs_processor.py"]
        csv["EXTRACT<br/>bancs_raw_transactions.csv<br/>12 registros, read_csv dtype str"]
        t1["a. drop_duplicates TX_ID"]
        t2["b. limpia RAW_AMOUNT<br/>descarta montos nulos"]
        t3["c. descarta sin CORE_ACC_SRC"]
        t4["d. fechas a ISO-8601, asume UTC<br/>e. moneda upper, default USD"]
        t5["f. TX_TYPE_CODE a categoría<br/>g. imputa CLIENT_NOTE"]
        t6["h. features IA<br/>isHighValue, logAmount,<br/>channelRiskScore"]
        out["LOAD<br/>bancs_cleaned_features.json<br/>9 registros + metadata"]
    end
    viewer["frontend ETLViewer<br/>muestra de ejemplo fija en el código"]

    tx --> relay -->|"AMQP routing key bancs.sync"| q
    q -.->|"(diseño)"| worker -.->|"(diseño)"| bancs
    bancs -.->|"CDC (diseño)"| cdc
    bancs -.->|"export batch"| csv
    csv --> t1 --> t2 --> t3 --> t4 --> t5 --> t6 --> out
    out -.->|"no lo lee"| viewer
```

## 6. Observabilidad

Prometheus solo scrapea `backend:4000/metrics`; el ai-service no expone métricas Prometheus (sus contadores están en `GET /health` y `GET /model-info`). La latencia de inferencia llega al backend en `metadata.inferenceLatencyMs` y se registra en `smartbancs_ai_recommendation_duration_seconds{engine}`. El `x-correlation-id` se valida en `CorrelationIdMiddleware` (`^[A-Za-z0-9._:-]{1,64}$`, si no, uuid v4), se guarda en `transactions` y `outbox_events`, viaja en el mensaje AMQP y vuelve como header en el POST del ai-service. El dashboard provisionado tiene dos paneles: TPS por estado y latencia p95.

```mermaid
flowchart LR
    req["Petición HTTP"] --> mw["CorrelationIdMiddleware<br/>valida o genera uuid v4<br/>se devuelve en la respuesta"]
    mw --> li["LoggingInterceptor<br/>label route = patrón de ruta<br/>excluye /metrics"]
    li --> svc["TransactionsService<br/>OutboxRelayService<br/>RecommendationsService"]

    svc --> logs["winston a stdout<br/>JSON en producción (NODE_ENV=production)<br/>texto legible en desarrollo"]
    svc --> reg["prom-client Registry"]
    reg --> m1["http_requests_total<br/>http_request_duration_seconds"]
    reg --> m2["smartbancs_transactions_total<br/>smartbancs_transaction_duration_seconds"]
    reg --> m3["smartbancs_db_errors_total{sqlstate}<br/>incluye POOL_TIMEOUT<br/>smartbancs_deadlocks_detected_total<br/>smartbancs_transaction_retries_total"]
    reg --> m4["smartbancs_outbox_pending_events<br/>smartbancs_db_active_connections<br/>smartbancs_db_pool_waiting_requests"]
    reg --> m5["smartbancs_ai_recommendation_duration_seconds{engine}"]
    m1 & m2 & m3 & m4 & m5 --> ep["GET /metrics"]
    ep -->|"scrape 5 s"| prom["Prometheus :9090"]
    prom --> graf["Grafana :3001<br/>TPS por estado, latencia p95"]

    svc -->|"SQL"| pg[("PostgreSQL<br/>pg_stat_statements, log_lock_waits<br/>deadlock_timeout 1s<br/>log_min_duration_statement 500ms")]
    pg --> diag["GET /api/v1/simulation/db-diagnostics<br/>pg_blocking_pids, idle in transaction, pool<br/>solo con SIMULATION_ENABLED=true"]

    svc -->|"correlationId en el mensaje AMQP"| aiw["ai-service logs en texto<br/>corrId, txId y eventId en cada línea<br/>/health DEGRADED si el consumidor no está conectado"]
```

## 7. Estado de un evento del outbox

No hay columna de estado: se deriva de `published_at` (NULL = pendiente). Cada intento incrementa `attempts` y un fallo escribe `last_error`. No hay límite de intentos ni DLQ en el lado del outbox: un evento no confirmado se reintenta en el siguiente ciclo. La DLQ está después del broker, en el consumidor de IA (sección 8).

```mermaid
stateDiagram-v2
    [*] --> PENDIENTE: INSERT en la misma tx que el débito<br/>attempts 0, published_at NULL
    [*] --> Inexistente: ROLLBACK de la transferencia
    Inexistente --> [*]
    PENDIENTE --> Reclamado: relay SELECT FOR UPDATE SKIP LOCKED
    Reclamado --> PUBLICADO: ack del broker<br/>published_at now, attempts + 1
    Reclamado --> PENDIENTE: nack, timeout de confirmación o sin conexión<br/>attempts + 1, last_error
    Reclamado --> PENDIENTE: error de BD en el relay, ROLLBACK del lote
    PUBLICADO --> [*]
    note right of PUBLICADO
        Entrega at-least-once. Un duplicado se absorbe
        en el backend por ai_recommendations.transaction_id
    end note
```

## 8. Procesamiento de un mensaje en el ai-service

`ai-service/consumer.py`. La topología (DLX `smartbancs.dlx` tipo direct, cola `smartbancs.ai.dlq` y argumentos `x-dead-letter-*` de `smartbancs.ai.queue`) se declara igual en el backend y en el ai-service; si difiere, RabbitMQ responde `PRECONDITION_FAILED`.

```mermaid
stateDiagram-v2
    [*] --> Recibido: basic_consume, prefetch 5
    Recibido --> DLQ: JSON inválido o sin data.accountNumber
    Recibido --> Inferencia: mensaje válido
    Inferencia --> POST: Gemini o motor heurístico
    POST --> Confirmado: 2xx o 409
    POST --> Reintento: timeout, conexión o 5xx
    Reintento --> POST: intentos 2 y 3, espera 0.5 s y 1 s
    Reintento --> DLQ: 3 intentos agotados
    POST --> DLQ: 4xx permanente
    Inferencia --> DLQ: excepción inesperada
    Confirmado --> [*]: basic_ack
    DLQ --> [*]: basic_nack requeue=false, smartbancs.dlx a smartbancs.ai.dlq
```

## 9. Despliegue en Google Cloud

La misma solución desplegada con Terraform (`infra/terraform/`) y GitHub Actions (`.github/workflows/ci-cd.yml`). RabbitMQ va en una VM porque Cloud Run solo acepta tráfico HTTP entrante. Detalle en [infra/README.md](../infra/README.md).

```mermaid
flowchart LR
    dev(["git push a main"]) --> gha["GitHub Actions<br/>tests + build + deploy"]
    gha -->|"OIDC (Workload Identity<br/>Federation, sin llaves)"| ar["Artifact Registry<br/>imágenes por commit"]
    user(["Navegador"])

    subgraph gcp["Google Cloud (Terraform)"]
        fe["Cloud Run<br/>smartbancs-frontend<br/>nginx, min 0"]
        be["Cloud Run<br/>smartbancs-backend<br/>API + relay, min 1, CPU siempre"]
        ai["Cloud Run<br/>smartbancs-ai-service<br/>consumidor, min 1, privado"]
        job["Cloud Run Job<br/>smartbancs-db-migrate"]
        sql[("Cloud SQL<br/>PostgreSQL 16<br/>Query Insights")]
        subgraph vpc["VPC smartbancs-vpc 10.10.0.0/24"]
            mq["Compute Engine<br/>RabbitMQ 3.13<br/>solo IP interna :5672"]
        end
        sm["Secret Manager<br/>DB, AMQP, Gemini"]
    end
    gem["Gemini API"]

    gha -->|"migra con el job y despliega<br/>imágenes en Cloud Run"| gcp
    user --> fe
    user -->|"REST /api/v1"| be
    be -->|"conector Cloud SQL"| sql
    job --> sql
    be -->|"Direct VPC egress<br/>AMQP"| mq
    mq --> ai
    ai -->|"POST /recommendations"| be
    ai --> gem
    sm -.-> be
    sm -.-> ai
```

## 10. Entrada para Archify

Componentes:

| Componente | Tipo | Tecnología | Estado |
|---|---|---|---|
| Cliente / Operador | Actor | Navegador | real |
| frontend | Web app (SPA) | React 18, Vite, Tailwind, nginx:alpine, puerto 3000->80 | implementado |
| backend | API / servicio | NestJS 10, TypeORM, winston, prom-client, amqplib (confirm channel), puerto 4000 | implementado |
| OutboxRelayService | Componente del backend | polling publisher, setInterval 500 ms, lotes de 100, SKIP LOCKED, publisher confirms | implementado |
| SimulationModule | Componente del backend | /api/v1/simulation (pico de quincena, db-diagnostics con pg_blocking_pids) | implementado, solo con SIMULATION_ENABLED=true |
| postgres | Base de datos | PostgreSQL 16-alpine, pg_stat_statements, healthcheck, volumen postgres_data, puerto 5432 | implementado |
| rabbitmq | Message broker | RabbitMQ 3.13-management, exchange topic smartbancs.events, healthcheck, puertos 5672 y 15672 | implementado |
| smartbancs.ai.queue | Cola | durable, binding transaction.created, x-dead-letter-exchange smartbancs.dlx | implementado |
| smartbancs.dlx | Exchange | direct, durable | implementado |
| smartbancs.ai.dlq | Cola (DLQ) | durable, binding smartbancs.ai.dlq | implementado |
| smartbancs.bancs.sync.queue | Cola | durable, binding bancs.sync, sin consumidor | implementado (solo cola) |
| ai-service | Microservicio IA | Python 3.11, FastAPI, uvicorn, pika, requests, puerto 8000 | implementado |
| Google Gemini API | SaaS externo | gemini-3.6-flash por defecto, opcional (GEMINI_API_KEY) | externo |
| Motor heurístico | Componente del ai-service | reglas locales, fallback | implementado |
| prometheus | Monitoreo | prom/prometheus v2.51.0, puerto 9090 | implementado |
| grafana | Dashboards | grafana 10.4.1, puerto 3001->3000 | implementado |
| etl-bancs | Job batch | Python, pandas, numpy, ejecución manual | implementado |
| Worker Bancs con rate limiting | Worker | token bucket | (diseño) |
| Conector CDC | Integración | Debezium / Kafka Connect | (diseño) |
| Core Bancs | Sistema legado externo | TCS BaNCS | (diseño) |

Conexiones:

| Origen | Destino | Protocolo | Detalle |
|---|---|---|---|
| Cliente | frontend | HTTP | estáticos en :3000 |
| Cliente (navegador) | backend | HTTP REST | /api/v1/accounts, /transactions, /recommendations en :4000; /simulation solo con SIMULATION_ENABLED=true |
| backend | postgres | SQL (TCP 5432) | pool pg max 30, lock_timeout 2 s, statement_timeout 5 s |
| OutboxRelayService | rabbitmq | AMQP 0-9-1 | publish con confirmación en smartbancs.events, routing keys transaction.created y bancs.sync; reconexión indefinida con backoff (tope 30 s) |
| rabbitmq | ai-service | AMQP 0-9-1 | consume smartbancs.ai.queue, prefetch 5, ack manual |
| rabbitmq | smartbancs.ai.dlq | AMQP dead-letter | nack sin requeue del ai-service, vía smartbancs.dlx |
| ai-service | Google Gemini API | HTTPS | POST generateContent, x-goog-api-key, timeout 10 s, fallback heurístico |
| ai-service | backend | HTTP REST | POST /api/v1/recommendations con x-correlation-id, hasta 3 intentos |
| prometheus | backend | HTTP scrape | GET /metrics cada 5 s |
| grafana | prometheus | HTTP PromQL | datasource provisionado |
| rabbitmq | Worker Bancs | AMQP | smartbancs.bancs.sync.queue (diseño) |
| Worker Bancs | Core Bancs | por definir | micro-lotes con rate limiting (diseño) |
| Core Bancs | Conector CDC | lectura de logs | (diseño) |
| Core Bancs | etl-bancs | archivo CSV | bancs_raw_transactions.csv -> bancs_cleaned_features.json |
