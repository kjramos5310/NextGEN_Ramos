---
tags: [referencia, mensajeria, rabbitmq, kafka, dlq, reintentos]
requisitos: [R3.2a, R3.2b, R3.3a, R3.3b, R3.4b, RNF-3, RNF-4]
fuentes:
  - https://www.rabbitmq.com/docs/confirms
  - https://www.rabbitmq.com/docs/dlx
  - https://www.rabbitmq.com/docs/quorum-queues
  - https://docs.confluent.io/kafka/design/delivery-semantics.html
  - https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
  - https://learn.microsoft.com/en-us/azure/architecture/patterns/queue-based-load-leveling
estado: borrador
---

# Mensajería asíncrona (RabbitMQ/Kafka), DLQ y reintentos

## Qué es
Un broker desacopla al productor (API de transferencias, a través del relay de la outbox) de sus consumidores (IA, Bancs Sync):
- **RabbitMQ**: colas con *acks*. Las **quorum queues** (Raft, replicadas y durables) son la opción para datos críticos. Tienen *dead-lettering* nativo.
- **Kafka**: un log particionado y persistente, con orden por partición, *replay* por offset e idempotent producer / transacciones. Es el destino natural de [[CDC con Debezium]].
- **DLQ (dead letter queue)**: el destino de los mensajes que no se pueden procesar (*poison messages*), para que no bloqueen la cola ni se pierdan.

## Problema que resuelve
- **RNF-3**: la IA no bloquea la transferencia. El evento se publica y la IA lo procesa cuando puede.
- **RNF-4**: la cola nivela la carga hacia Bancs (ver [[Sincronizacion con core legado]]).
- Aísla fallos: si la IA cae, las transferencias siguen funcionando y los eventos esperan.

## Cómo se implementa
**Garantías de entrega** (Confluent/Kafka): *at-most-once* (puede perder), *at-least-once* (puede duplicar, nunca pierde) y *exactly-once* (solo dentro de Kafka, con transacciones). El default de Kafka es at-least-once. **En la práctica: at-least-once + consumidor idempotente** (ver [[Idempotency Keys]]).

**RabbitMQ:**
- **Publisher confirms**: el broker confirma (`basic.ack`) cuando el mensaje fue aceptado por todas las colas destino. El relay marca la fila de outbox como publicada **solo después del confirm**.
- **Acks manuales** del consumidor. El modo automático *"should be considered unsafe"*. Se hace ack después de procesar y persistir.
- **Prefetch** (`basic.qos`): limita los mensajes sin ack por canal; es el mecanismo de **backpressure**. RabbitMQ indica que *"values in the 100 through 300 range usually offer optimal throughput"*. Para Bancs conviene un valor bajo y controlado.
- **Dead-lettering** ocurre cuando: se rechaza con `requeue=false`, expira el TTL, se excede el largo de la cola o se supera el `delivery-limit` de una quorum queue. **Desde RabbitMQ 4.0 el `delivery-limit` default es 20.** Se configura por **policy** (recomendado) y no por argumentos `x-dead-letter-exchange`. El header `x-death` registra la cola, el motivo y el conteo.
- Por defecto el dead-lettering se re-publica **sin confirms**; las quorum queues soportan *at-least-once dead-lettering*.

**Reintentos:**
- Hay que distinguir **errores transitorios** (timeout, 503) de **errores permanentes** (validación, 4xx de negocio). Los permanentes van directo a la DLQ; los transitorios se reintentan con **backoff exponencial y jitter**.
- AWS demuestra que el backoff exponencial sin jitter sigue agrupando los reintentos en oleadas. **Full jitter**: `sleep = random(0, min(cap, base·2^n))`, que hace menos trabajo total. Ver [[Resiliencia - timeouts reintentos y circuit breaker]].
- Patrón de **colas de reintento con TTL**: `q.main → (nack) → q.retry.5s (TTL) → q.main …`; tras N intentos, `q.dlq`.
- La DLQ necesita **alerta** (profundidad > 0) y una herramienta de **re-procesamiento**, que es un runbook.

## Trade-offs
| | RabbitMQ | Kafka |
|---|---|---|
| Modelo | Cola con ack por mensaje, routing flexible | Log particionado, replay |
| DLQ/reintentos | Nativos (DLX, delivery-limit) | Se implementan en el consumidor (tópicos retry/DLT) |
| Orden | Por cola, con 1 consumidor | Por partición (clave = `aggregateid`) |
| Replay histórico | No (se consume y se borra) | Sí (retención). Útil para **reentrenar la IA** (ver [[MLOps y Data Drift]]) |
| Operación en MVP | Liviano: un contenedor | Más pesado (KRaft + Connect) |

## Aplicación a SmartBancs
- **MVP**: RabbitMQ, con exchange `transfers` (topic) y colas `ai.recommendations` y `bancs.sync`, cada una con su DLQ por policy y quorum queues. Es simple y muestra DLQ y reintentos de forma visible.
- **Producción**: Kafka + Debezium si hacen falta replay y alto volumen. Se justifica en el ADR.
- Consumidores idempotentes con `processed_events(event_id)`.
- Se propaga `traceparent` en los headers del mensaje para seguir la transacción de la API a la IA (ver [[Observabilidad]]).
- Métricas: profundidad por cola, edad del mensaje más antiguo, tasa de ack/nack, mensajes en DLQ.

## Preguntas que podría hacer el jurado
- *¿Qué garantía de entrega tienes?* At-least-once de punta a punta (outbox + confirms + acks manuales) y deduplicación en el consumidor. Así se logra el "efecto exactly-once".
- *¿Qué haces con un mensaje que siempre falla?* Después de N reintentos con backoff pasa a la DLQ. Hay una alerta, se revisa y se re-encola con una herramienta.
- *¿RabbitMQ o Kafka para 10k TPS?* Ambos lo soportan. Elegí RabbitMQ en el MVP por simplicidad y DLQ nativa, y Kafka en producción por replay y CDC. Está documentado en el ADR.
- *¿Cómo evitas que la IA sature si llegan 10k eventos/s?* Con prefetch acotado, consumidores escalables y, si hace falta, **muestreo o agregación**: no toda transacción necesita una recomendación inmediata.
