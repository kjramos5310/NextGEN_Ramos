# SmartBancs App — Documento Técnico de Arquitectura, Operaciones e IA

**Proyecto:** SmartBancs App (NextGen Engineering Solution)  
**Dominio:** Banca Digital Transaccional de Alta Concurrencia, Observabilidad e IA  
**Versión:** 1.0.0 (Producción MVP)

---

## 1. Arquitectura General y Decisiones Técnicas

### 1.1. Diagrama de Arquitectura del Sistema
```
+-----------------------------------------------------------------------------------+
|                              CAPA DE CLIENTE                                     |
|     [ React 18 + Vite Single Page Application ] (Dashboard & Banca Móvil)        |
+------------------------------------------+----------------------------------------+
                                           | HTTP REST (x-correlation-id) < 2s SLA
                                           v
+-----------------------------------------------------------------------------------+
|                              CAPA DE SERVICIOS                                    |
|   +---------------------------------------------------------------------------+   |
|   |                  SmartBancs Backend Core (NestJS + TypeScript)            |   |
|   |  - Módulo Transaccional (ACID + Pessimistic Locking ordenado)            |   |
|   |  - Middleware de Correlación Distribuida (x-correlation-id)              |   |
|   |  - Logging Interceptor & Métricas Prometheus (/metrics)                  |   |
|   +-------------------+-----------------------------------+-------------------+   |
+-----------------------|-----------------------------------|-----------------------+
                        |                                   | Eventos Asíncronos
       Transacción SQL  |                                   v (smartbancs.events)
       SELECT FOR UPDATE|                  +------------------------------------+
                        v                  |      RabbitMQ Message Broker       |
+---------------------------------------+  |   - smartbancs.ai.queue            |
|       PostgreSQL 16 (ACID DB)         |  |   - smartbancs.bancs.sync.queue    |
| - Cuentas Bancarias (accounts)        |  +-----------------+------------------+
| - Transacciones (transactions)        |                    |
| - Recomendaciones (ai_recommendations)|                    | Consumo Asíncrono
+---------------------------------------+                    v
                                           +------------------------------------+
                                           |  AI Advisor Microservice (FastAPI) |
                                           |  - Motor de Scoring Financiero     |
                                           |  - MLOps Telemetría & Data Drift   |
                                           +------------------------------------+
```

### 1.2. Justificación del Stack Tecnológico

| Componente | Elección | Justificación Técnica |
| :--- | :--- | :--- |
| **Backend Core** | **NestJS (Node.js/TypeScript)** | Proporciona tipado estricto para montos y entidades bancarias, arquitectura modular (Clean Architecture), inyección de dependencias y un Event Loop no-bloqueante capaz de sostener miles de peticiones simultáneas con baja latencia. |
| **Base de Datos** | **PostgreSQL 16** | Garantías transaccionales **ACID**. Soporte nativo para bloqueos a nivel de fila (*Row-Level Locks*) con `SELECT ... FOR UPDATE`, índices B-Tree optimizados y aislamiento transaccional `READ COMMITTED` / `SERIALIZABLE`. |
| **Broker de Mensajería** | **RabbitMQ** | Desacopla la invocación de IA y la sincronización con el core legado Bancs. Asegura que la API responda en **< 20 ms**, protegiendo el SLA de < 2 segundos mediante colas durables y buffers controlados. |
| **Microservicio IA** | **Python (FastAPI)** | Estándar de la industria para Inteligencia Artificial y Machine Learning. Consume eventos en segundo plano sin competir por memoria o CPU con el motor transaccional. |
| **Observabilidad** | **Prometheus + Grafana + Pino/Winston** | Trazabilidad distribuida extremo a extremo con `x-correlation-id`, histogramas de latencia (p50, p95, p99) y métricas de saturación del pool de conexiones para diagnóstico en tiempo real. |

---

## 2. Integración con el Core Legado "Bancs" y Manejo de Datos

### 2.1. Estrategia de Sincronización sin Saturar el Core Legado
El Core Bancario Legado (*Bancs*) presenta restricciones de concurrencia y no soporta consultas masivas. Para resolver esto:

1. **Patrón Transactional Outbox Asíncrono (Salida):**  
   Cuando se completa una transferencia en SmartBancs, se emite un evento a la cola `smartbancs.bancs.sync.queue` en RabbitMQ. Un worker dedicado con **Token Bucket Rate Limiting** despacha las actualizaciones al Core Bancs en micro-lotes (*micro-batches*) durante ventanas de baja carga, evitando picos de CPU en el mainframe/legado.
2. **Change Data Capture - CDC (Entrada):**  
   Para sincronizar movimientos originados directamente en el Core Legado (cajeros físicos o cheques), se implementa un conector CDC (ej. Debezium / Kafka Connect) que lee los logs de transacciones del motor de Bancs sin ejecutar `SELECT` sobre tablas productivas.

### 2.2. Pipeline ETL/ELT (`etl_bancs_processor.py`)
El script implementado en Python procesa lotes crudos de transacciones legadas (`bancs_raw_transactions.csv`):
- **Limpieza de Nulos y Datos Corruptos:** Descarta registros huérfanos sin cuenta origen y transacciones con montos no numéricos (`NaN`).
- **Desduplicación:** Elimina transacciones repetidas por `TX_ID`.
- **Estandarización:** Normaliza monedas (`USD`), estandariza fechas heterogéneas al formato ISO-8601 UTC y homologa códigos de operación legados a categorías de dominio bancario (`TRANSFER`, `SHOPPING`, `FOOD_ENTERTAINMENT`).
- **Feature Engineering para IA:** Genera atributos predictivos (`logAmount`, `channelRiskScore`, `isHighValue`) exportando un dataset limpio en formato JSON (`bancs_cleaned_features.json`).

---

## 3. Inteligencia Artificial: Implementación, Despliegue y MLOps

### 3.1. Arquitectura Híbrida de Inferencia (Google Gemini API + Motor Local)
El microservicio `ai-service` opera bajo una arquitectura de alta resiliencia diseñada para entornos de misión crítica bancaria:
1. **Motor Primario (Google Gemini API):**  
   Si se configura la variable de entorno `GEMINI_API_KEY`, el servicio consume el endpoint de inferencia de Google Gemini (`gemini-1.5-flash` / `gemini-2.0-flash`) forzando salidas en JSON estructurado (`responseMimeType: "application/json"`).
2. **Parser Resiliente de Doble Capa (*Self-Healing JSON*):**  
   Para evitar caídas por delimitadores de texto o formateo no determinista del LLM:
   - *Capa 1:* Sanitización y remoción de bloques markdown (\`\`\`json ... \`\`\`).
   - *Capa 2 (Fallback regex):* Si el parseo estándar falla, una expresión regular aísla el primer objeto JSON `{ ... }` balanceado del texto crudo, recuperando el payload sin error.
3. **Motor Secundario de Fallback Heurístico (Zero-Downtime):**  
   Si no se proporciona una API Key, o ante errores de red, timeouts (>4.5s) o límites de cuota (HTTP 429), el servicio conmuta automáticamente a un motor de reglas financieras locales. Esto garantiza que el procesamiento transaccional continúe al 100% de disponibilidad.

### 3.2. Desacoplamiento Asíncrono (Garantía de SLA < 2 Segundos)
El cálculo de recomendaciones de IA no se realiza dentro del ciclo de vida de la petición HTTP del usuario:
- El endpoint `POST /api/v1/transactions` procesa el débito/crédito en base de datos (~15 ms), emite un evento a RabbitMQ (`smartbancs.ai.queue`) y retorna inmediatamente el código `201 Created` con el ID de transacción y el `correlation_id`.
- El worker de IA en Python (`consumer.py`) consume el mensaje de la cola de manera asíncrona, evalúa la transacción con Gemini (o el motor de fallback) y persiste la recomendación en la tabla `ai_recommendations` mediante llamadas al endpoint `/api/v1/recommendations`.

### 3.3. Ciclo de Vida del Modelo en Producción (MLOps)
1. **In-Context Learning & Feature Store:** El modelo se alimenta dinámicamente con perfiles de cliente y el dataset limpio generado por el pipeline ETL (`bancs_cleaned_features.json`).
2. **Monitoreo de Data Drift:** Se evalúa la distribución de montos y categorías entrantes utilizando la métrica *Population Stability Index (PSI)*. Desviaciones con `confidenceScore < 0.50` desvían la operación a revisión manual.
3. **Gestión de Recursos y Cuotas:** Despliegue en contenedor independiente con límites de memoria y CPU, aislamiento de hilos de ejecución y control de cuotas RPM para no saturar la API Key de Gemini.

---

## 4. Observabilidad y Trazabilidad Distribuida

### 4.1. Instrumentación Implementada (Práctico)
- **Logs Estructurados (JSON):** Cada log contiene timestamp ISO, nivel, servicio emisor, duración en ms y el `correlationId` para trazabilidad unificada. Implementado en `common/logger/logger.service.ts` con Winston.
- **Métricas Prometheus (`/metrics`):** Implementadas en `common/metrics/metrics.service.ts` con `prom-client`:
  - `smartbancs_transactions_total`: Contador de transacciones agrupadas por estado (`COMPLETED`, `FAILED`) y categoría.
  - `smartbancs_transaction_duration_seconds`: Histograma de latencia transaccional (buckets: 5ms, 10ms, 20ms, 50ms, 100ms, 500ms, 1s, 2s).
  - `smartbancs_deadlocks_detected_total`: Contador de bloqueos mutuos o timeouts de locks.
  - `smartbancs_db_active_connections`: Medición de conexiones activas en el connection pool.
  - `http_requests_total` / `http_request_duration_seconds`: Tráfico HTTP general por método, ruta y código de estado.
- **Trazabilidad Distribuida:** Middleware `correlation-id.middleware.ts` inyecta automáticamente un UUID `x-correlation-id` en cada petición HTTP. Este ID se propaga a los logs del backend, a los mensajes publicados en RabbitMQ y al microservicio de IA, permitiendo reconstruir la trazabilidad completa de una transacción a través de todos los componentes.
- **Interceptor de Auditoría:** `logging.interceptor.ts` registra método HTTP, URL, código de estado, duración y correlationId de cada petición, además de alimentar los contadores de Prometheus.

### 4.2. Diseño de Observabilidad (Teórico)

Para identificar problemas de rendimiento, degradación del servicio o fallos, se definen los siguientes pilares de observabilidad y la justificación de cada dato seleccionado:

#### A. Métricas Clave y su Utilidad Diagnóstica

| Métrica | Tipo | Utilidad para Diagnóstico |
| :--- | :--- | :--- |
| `smartbancs_transaction_duration_seconds` (p95, p99) | Histograma | **Indicador primario de degradación.** Si el percentil 95 supera 500ms, indica contención en la BD (locks o pool agotado). Si supera 2s, hay violación del SLA. Permite distinguir entre degradación gradual (leak de conexiones) y fallo abrupto (deadlock masivo). |
| `smartbancs_transactions_total` (rate por minuto) | Counter + Rate | **Volumen transaccional (TPS).** Permite detectar picos anómalos (quincena, Black Friday) y correlacionar con latencia. Una caída súbita de TPS con latencia alta sugiere bloqueo generalizado. |
| `smartbancs_deadlocks_detected_total` | Counter | **Señal de alarma de concurrencia.** Cualquier incremento > 0 requiere investigación inmediata. En nuestro diseño con lock ordering, un deadlock sería indicativo de un bug o una ruta de código no protegida. |
| `http_request_duration_seconds` por ruta | Histograma | **Localización del cuello de botella.** Si solo `/api/v1/transactions` tiene latencia alta pero `/api/v1/accounts` responde en < 5ms, el problema está en la lógica transaccional y no en la red o el servidor. |
| Logs con `correlationId` y `durationMs` | Texto estructurado | **Trazabilidad de flujo completo.** Permite reconstruir la secuencia exacta de eventos de una transacción fallida: desde la recepción HTTP → lock en BD → commit → publicación a RabbitMQ → consumo por IA. Esencial para el análisis post-mortem. |

#### B. Alertas Propuestas (Prometheus → Alertmanager)

| Alerta | Condición | Severidad | Acción |
| :--- | :--- | :--- | :--- |
| `HighTransactionLatency` | `histogram_quantile(0.95, smartbancs_transaction_duration_seconds) > 1.0` durante 2 min | WARNING | Notificar en Slack al equipo de guardia |
| `SLAViolation` | `histogram_quantile(0.95, ...) > 2.0` durante 1 min | CRITICAL | Pager al SRE + ejecutar runbook de mitigación |
| `DeadlockDetected` | `rate(smartbancs_deadlocks_detected_total[1m]) > 0` | CRITICAL | Investigación inmediata + consulta `pg_locks` |
| `ConnectionPoolExhaustion` | `smartbancs_db_active_connections > 20` (80% de max=25) | WARNING | Evaluar escalado o PgBouncer |
| `HighErrorRate` | `rate(http_requests_total{status_code=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05` | CRITICAL | Circuit breaker + diagnóstico de logs |

#### C. Dashboards de Grafana Propuestos
1. **Panel Transaccional:** TPS en tiempo real, latencia p50/p95/p99, tasa de éxito/fallo, distribución por categoría.
2. **Panel de Infraestructura BD:** Conexiones activas del pool, queries activas en `pg_stat_activity`, locks en tablas `accounts`/`transactions`.
3. **Panel de RabbitMQ:** Profundidad de colas `ai.queue` y `bancs.sync.queue`, tasa de consumo, mensajes sin ack.
4. **Panel de IA:** Latencia de inferencia, total de recomendaciones generadas, distribución por tipo.

La combinación de métricas cuantitativas (Prometheus), logs cualitativos con trazabilidad (Winston + correlationId) y visualización agregada (Grafana) proporciona los **tres pilares de la observabilidad** (métricas, logs y trazas) necesarios para diagnosticar cualquier incidente en la plataforma.

---

## 5. Operaciones: Incidente Crítico Simulado de Quincena

### 5.1. Descripción del Escenario
Durante un pico de quincena, se genera un alto volumen de transferencias concurrentes. Sin un diseño adecuado, esto causaría:
1. **Deadlocks:** Transacción 1 bloquea Cuenta A y espera Cuenta B; Transacción 2 bloquea Cuenta B y espera Cuenta A.
2. **Agotamiento del Connection Pool:** Conexiones retenidas indefinidamente esperando locks, disparando errores de timeout.

### 5.2. Solución y Prevención en Código
1. **Ordenamiento Determinista de Bloqueos:**
   En `transactions.service.ts`, los números de cuenta siempre se ordenan alfabéticamente antes de solicitar el lock pesimista:
   ```typescript
   const accountsToLock = [sourceAccountNumber, targetAccountNumber].sort();
   // Siempre se bloquea primero la cuenta menor y luego la mayor
   ```
   Esto elimina matemáticamente la posibilidad de un ciclo de espera circular (condición de Coffman), **impidiendo que ocurra un deadlock**.
2. **Ajuste de Connection Pool y Timeouts:**
   Configuración de `idleTimeoutMillis: 30000` y `connectionTimeoutMillis: 5000` en TypeORM/Postgres para liberar recursos rápidamente en situaciones de estrés.
3. **Detección de Deadlocks en Código:**
   En el bloque `catch` de `processTransaction()`, se detectan errores de deadlock (`error.message.includes('deadlock')`) y se registran en la métrica `smartbancs_deadlocks_detected_total`, lo que dispara la alerta `DeadlockDetected` en Prometheus.

### 5.3. Monitoreo Práctico en Código
El endpoint `GET /api/v1/simulation/db-diagnostics` (implementado en `simulation.service.ts`) ejecuta directamente contra PostgreSQL:
- **`pg_stat_activity`:** Identifica qué queries están activas, en qué estado (`active`, `idle in transaction`), su duración y si están esperando un evento de bloqueo (`wait_event_type`, `wait_event`). Esto permite encontrar el proceso exacto que causa el cuello de botella.
- **`pg_locks`:** Muestra qué filas de las tablas `accounts` y `transactions` están bloqueadas, en qué modo (`RowExclusiveLock`, `ShareLock`) y si el lock fue concedido o está en espera. Un lock `granted = false` sobre una tabla indica contención activa.

### 5.4. Plan de Mitigación Inmediata (Runbook de Emergencia)
En caso de presentarse degradación en quincena:
1. **Finalizar conexiones bloqueadas** — Libera inmediatamente locks retenidos:
   ```sql
   SELECT pg_terminate_backend(pid) FROM pg_stat_activity
   WHERE state = 'idle in transaction' AND now() - state_change > interval '5 seconds';
   ```
2. **Habilitar Rate Limiting** en API Gateway (NGINX/Kong) para admitir hasta 10,000 req/s y encolar el excedente con respuesta `429 Too Many Requests`.
3. **Escalar horizontalmente** réplicas de lectura para queries de saldos (`GET /accounts/:id/balance`), descargando la primaria.
4. **Reducir `DB_POOL_MAX`** temporalmente si se detecta que las conexiones están siendo retenidas sin liberarse (evita que la BD se sature con conexiones zombi).

---

## 6. Gestión de Incidentes TI: Post-Mortem

### 6.1. Ficha del Incidente

| Campo | Detalle |
| :--- | :--- |
| **Identificador** | INC-202609-001 |
| **Título** | Incremento severo de latencia y timeouts en transferencias durante pico de quincena |
| **Severidad** | P1 (Crítica — impacto directo en clientes) |
| **Servicios Afectados** | SmartBancs Backend Core (NestJS), PostgreSQL |
| **Tiempo de Detección (MTTD)** | 2 minutos |
| **Tiempo de Recuperación (MTTR)** | 12 minutos |
| **Impacto** | ~350 transferencias fallidas, ~2,000 usuarios con timeouts durante la ventana de incidente |

### 6.2. Línea de Tiempo del Incidente

| Hora (UTC) | Evento |
| :--- | :--- |
| **15:00** | Inicio del pico transaccional de quincena. TPS sube de 200 a 3,500 req/s. |
| **15:02** | Alerta `HighTransactionLatency` disparada: p95 supera 1.0s. Equipo de guardia notificado por Slack. |
| **15:03** | Alerta `SLAViolation` disparada: p95 supera 2.0s. Pager al SRE on-call. |
| **15:04** | SRE consulta dashboard Grafana. Detecta: `db_active_connections = 25/25` (pool agotado), múltiples queries en estado `idle in transaction` con duración > 8s. |
| **15:05** | SRE ejecuta `pg_stat_activity` vía endpoint `/db-diagnostics`. Identifica que las queries bloqueadas son `SELECT ... FOR UPDATE` sobre la tabla `accounts` con locks cruzados entre pares de cuentas. |
| **15:06** | SRE ejecuta el runbook: `pg_terminate_backend()` sobre las 12 conexiones en `idle in transaction` > 5 segundos. Libera locks inmediatamente. |
| **15:07** | Latencia p95 baja a 800ms. Pool de conexiones recupera disponibilidad (15/25 activas). |
| **15:09** | SRE habilita rate limiting temporal: 5,000 req/s max con cola de espera en NGINX. |
| **15:12** | Latencia p95 estabilizada en 120ms. TPS normalizado a 2,800 req/s. Incidente declarado **RESUELTO**. |
| **15:30** | Post-mortem iniciado. |

### 6.3. Causa Raíz (Root Cause Analysis)
El endpoint de transferencias adquiría locks pesimistas sobre las cuentas sin un orden determinista. Bajo alta concurrencia, dos transacciones concurrentes podían intentar bloquear las mismas cuentas en orden inverso, generando un ciclo de espera circular (deadlock). PostgreSQL detectaba y abortaba algunos de estos deadlocks, pero las transacciones reintentadas saturaban el connection pool (25 conexiones max), provocando timeouts en cascada para todas las operaciones.

### 6.4. Corrección Aplicada (Fix Permanente)
Se implementó el **ordenamiento lexicográfico de cuentas** antes de adquirir el lock pesimista en `transactions.service.ts`:
```typescript
const accountsToLock = [sourceAccountNumber, targetAccountNumber].sort();
```
Esta corrección elimina la posibilidad matemática de deadlocks por la ausencia de la condición de espera circular (una de las 4 condiciones de Coffman).

### 6.5. Acciones Preventivas (Plan de Acción)

| Ámbito | Acción | Responsable | Plazo |
| :--- | :--- | :--- | :--- |
| **Código** | Implementar circuit breaker (ej. `opossum`) con timeout de 1.5s por operación transaccional. Si la BD no responde en 1.5s, retornar `503 Service Unavailable` en lugar de retener la conexión. | Backend Team | Sprint 1 |
| **Código** | Agregar prueba de concurrencia automatizada: 50 transferencias simultáneas sobre las mismas cuentas, verificando que no se produzcan deadlocks ni inconsistencias de saldo. | QA/Backend | Sprint 1 |
| **Infraestructura** | Desplegar **PgBouncer** como proxy de connection pooling frente a PostgreSQL para soportar hasta 10,000 conexiones lógicas con un pool físico de 50 conexiones. | SRE/Infra | Sprint 2 |
| **Infraestructura** | Configurar réplicas de lectura de PostgreSQL para descargar queries de consulta (`GET /accounts`, `GET /transactions`) de la instancia primaria. | SRE/Infra | Sprint 2 |
| **Monitoreo** | Crear alerta `ConnectionPoolSaturation` que dispare cuando `db_active_connections` supere el 80% del máximo configurado (`DB_POOL_MAX`). | SRE | Sprint 1 |
| **Monitoreo** | Agregar runbook automatizado: si `DeadlockDetected` se dispara 3 veces en 1 minuto, ejecutar automáticamente la terminación de sesiones bloqueadas. | SRE | Sprint 2 |
| **Proceso** | Realizar pruebas de carga periódicas (mensualmente) simulando el escenario de quincena con el endpoint `POST /simulation/quincena-spike` antes de cada ventana de alto tráfico. | QA/Ops | Recurrente |
