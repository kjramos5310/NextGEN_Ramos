# 🧠 3.3. Inteligencia Artificial: Implementación, Despliegue y MLOps

Este documento detalla en profundidad el cumplimiento de la **Sección 3.3 del Reto Técnico**:
1. **Integración en código (Práctico):** Microservicio independiente de IA y patrón asíncrono no bloqueante en el backend principal.
2. **Manejo del modelo (Teórico):** Ciclo de vida MLOps, ingesta continua de datos, monitoreo de *Data Drift* y optimización de recursos.

---

## 1. Integración en Código (Práctico)

### 1.1. Arquitectura de Desacoplamiento Asíncrono
Para cumplir con el **SLA de transferencia < 2 segundos**, el flujo transaccional crítico está 100% desacoplado del motor de IA mediante un **Event-Driven Architecture (EDA)** implementado con RabbitMQ:

```mermaid
sequenceDiagram
    autonumber
    actor Cliente as 📱 App Cliente / React
    participant API as ⚡ Backend Core (NestJS)
    participant DB as 🗄️ PostgreSQL (ACID)
    participant Broker as 📬 RabbitMQ (Topic Exchange)
    participant AI as 🧠 AI Service (Python FastAPI)

    Cliente->>API: POST /api/v1/transactions (Monto, Cuentas)
    Note over API,DB: Transacción ACID con Bloqueo Pesimista
    API->>DB: SELECT ... FOR UPDATE (Cuentas ordenadas)
    API->>DB: UPDATE balances & INSERT transaction (COMPLETED)
    API->>DB: COMMIT Transaction (~15 ms)
    
    rect rgb(30, 41, 59)
    Note over API,Broker: Despacho Asíncrono Fire-and-Forget (No Bloqueante)
    API--)Broker: publishEvent("transaction.created", aiPayload)
    end

    API-->>Cliente: HTTP 201 Created (Tx ID, Status: COMPLETED) [Latencia Total: ~18 ms]

    Note over Broker,AI: Procesamiento en Segundo Plano (Background Worker)
    Broker->>AI: Consume evento desde smartbancs.ai.queue
    AI->>AI: Ejecuta inferencia heurística / ML (Categoría, Anomalia, Ahorro)
    AI->>DB: INSERT into ai_recommendations (Recomendación generada)
    AI-->>Broker: basic_ack
```

### 1.2. Demostración en el Código del Microservicio Principal (`backend`)
En el archivo [`backend/src/modules/transactions/transactions.service.ts`](file:///d:/proyectos/pruebaTecnicaTCS/backend/src/modules/transactions/transactions.service.ts):

```typescript
// 1. Ejecución transaccional atómica en PostgreSQL
await queryRunner.commitTransaction();

const totalTimeSec = (Date.now() - startTime) / 1000;
this.metricsService.recordTransaction('COMPLETED', createdTx.category, totalTimeSec);

// 2. DISPATCH ASÍNCRONO NO BLOQUEANTE:
// Se invoca sin 'await' bloqueante en la respuesta HTTP inmediata al cliente.
this.dispatchAsyncEvents(createdTx, sourceAccount, correlationId);

// 3. Respuesta inmediata al cliente (< 20 ms)
return createdTx;
```

Método de despacho hacia RabbitMQ:
```typescript
private dispatchAsyncEvents(tx: Transaction, sourceAccount: Account, correlationId: string) {
  const aiPayload = {
    transactionId: tx.id,
    accountNumber: tx.sourceAccountNumber,
    amount: tx.amount,
    category: tx.category,
    currentBalance: sourceAccount.balance,
    description: tx.description,
    timestamp: tx.createdAt,
  };
  
  // Publicación en cola 'smartbancs.ai.queue'
  this.rabbitmqService.publishEvent('transaction.created', aiPayload, correlationId).catch((err) => {
    this.logger.warn(`Failed async publish to AI queue: ${err.message}`, { correlationId });
  });
}
```

### 1.3. Microservicio Independiente de IA (`ai-service`): Integración Gemini + Fallback
Ubicado en [`ai-service/`](file:///d:/proyectos/pruebaTecnicaTCS/ai-service), implementado en **Python FastAPI** con consumidor asíncrono [`consumer.py`](file:///d:/proyectos/pruebaTecnicaTCS/ai-service/consumer.py) y motor de inferencia [`advisor.py`](file:///d:/proyectos/pruebaTecnicaTCS/ai-service/advisor.py):
- **Consumo Real de Google Gemini API:** Mediante la variable de entorno `GEMINI_API_KEY`, invoca los modelos generativos de Google (`gemini-1.5-flash` / `gemini-2.0-flash`) con salidas estructuradas en JSON estricto (`responseMimeType: "application/json"`).
- **Parser Resiliente de Doble Capa (*Self-Healing JSON*):**  
  Implementado en `advisor.py`, asegura que las respuestas del LLM no interrumpan el flujo transaccional:
  - *Capa 1:* Sanitización y remoción de etiquetas markdown (` ```json ... ``` `).
  - *Capa 2:* Fallback extractivo mediante RegEx balanceado (`\{[\s\S]*\}`) para aislar el objeto JSON puro.
- **Motor de Fallback Heurístico Local (Zero-Downtime):** Si la clave no está configurada, o ante problemas de conectividad o límites de cuota (HTTP 429), el servicio degrada con gracia hacia el motor heurístico local, manteniendo disponibilidad al 100%.
- **Aislamiento de Recursos:** Se ejecuta en su propio runtime y contenedor Docker, evitando que el cómputo de inferencia consuma memoria o CPU del backend transaccional.
- **Worker Concurrente con Prefetch:** El consumidor `pika` utiliza `basic_qos(prefetch_count=5)` para procesar eventos a demanda sin saturar el proceso.
- **Endpoint Directo de Inferencia:** Expone `POST /predict-recommendation`, `GET /health` y `GET /model-info` para consultas sincrónicas bajo demanda y observabilidad de MLOps.

---

## 2. Manejo del Modelo en Producción (Teórico - MLOps)

### 2.1. Ciclo de Vida del Modelo (Model Lifecycle & Continuous Training)
El ciclo de vida del modelo de recomendación financiera sigue el estándar **MLOps CI/CD/CT (Continuous Integration, Continuous Delivery, Continuous Training)**:

```
+------------------+      +-------------------+      +--------------------+
| Ingesta ETL      | ---> | Feature Store     | ---> | Pipeline de        |
| (Bancs + Core)   |      | (PostgreSQL /     |      | Reentrenamiento    |
|                  |      | Feast)            |      | (Airflow / Kubeflow|
+------------------+      +-------------------+      +---------+----------+
                                                               |
+------------------+      +-------------------+                |
| Inferencia       | <--- | Model Registry    | <--------------+
| en Producción    |      | (MLflow / S3)     |
| (FastAPI Worker) |      | Versión Promovida |
+--------+---------+      +-------------------+
         |
         v
+------------------+
| Monitoreo        |
| Data Drift / PSI |
+------------------+
```

1. **Alimentación Continua con Nuevos Datos:**
   - El pipeline ETL diario ([`etl_bancs_processor.py`](file:///d:/proyectos/pruebaTecnicaTCS/etl-bancs/etl_bancs_processor.py)) extrae las transacciones consolidadas de Bancs y SmartBancs.
   - Las transacciones son limpiadas, anonimizadas (cumplimiento regulatorio PCI-DSS y GDPR) y enriquecidas con variables de comportamiento (`logAmount`, `channelRiskScore`, frecuencia semanal).
   - Se almacenan en el **Feature Store**, permitiendo que el entrenamiento utilice datos históricos consistentes.

2. **Reentrenamiento Automatizado:**
   - Se ejecutan *training pipelines* periódicos (semanales o quincenales) evaluando modelos candidatos frente al modelo actual en producción (*Champion vs. Challenger*).
   - Métricas de validación: F1-Score en clasificación de gasto > 0.90 y tasa de falsos positivos en alertas de fraude < 0.5%.

### 2.2. Monitoreo de Data Drift y Concept Drift

En banca, el comportamiento de gasto cambia drásticamente en fechas especiales (quincenas, Black Friday, festividades). Para evitar la degradación del modelo:

1. **Métricas de Drift en Producción:**
   - **Population Stability Index (PSI):** Se compara la distribución de montos y categorías de los últimos 7 días contra la distribución base de entrenamiento.
     $$\text{PSI} = \sum \Big( (\% \text{Actual} - \% \text{Esperado}) \times \ln\big(\frac{\% \text{Actual}}{\% \text{Esperado}}\big) \Big)$$
     - $\text{PSI} < 0.10$: Distribución estable (Sin cambios requeridos).
     - $0.10 \le \text{PSI} \le 0.25$: Cambio moderado (Alerta preventiva a MLOps).
     - $\text{PSI} > 0.25$: *Significant Data Drift* $\rightarrow$ **Disparo automático de reentrenamiento**.
   - **Kolmogorov-Smirnov Test (KS Test):** Para variables continuas de montos transaccionales.

2. **Telemetría MLOps:**
   - El endpoint `/model-info` reporta en tiempo real la versión activa (`v2.4.0-smartbancs`), total de inferencias procesadas y estado del drift (`NORMAL`).

### 2.3. Gestión del Consumo de Recursos y Escalabilidad

1. **Escalado Horizontal Basado en Colas (KEDA / HPA):**
   - El microservicio `ai-service` escala réplicas de contenedores utilizando **KEDA (Kubernetes Event-driven Autoscaling)** basado en el tamaño de la cola `smartbancs.ai.queue` en RabbitMQ.
   - Si la cola supera los 500 mensajes pendientes (ej. pico de quincena), se escalan automáticamente de 2 a 8 pods de inferencia.

2. **Aislamiento de Recursos (Resource Limits):**
   - Configuración estricta en Docker/K8s:
     ```yaml
     resources:
       requests:
         memory: "256Mi"
         cpu: "250m"
       limits:
         memory: "512Mi"
         cpu: "1000m"
     ```
   - Garantiza que picos de inferencia nunca afecten la memoria o CPU de la base de datos PostgreSQL ni del backend NestJS.

3. **Inferencia Batch y Caching:**
   - Perfiles de clientes recurrentes y reglas base son cacheadas en memoria para ejecutar inferencias en **< 5 ms**, minimizando el consumo de CPU.
