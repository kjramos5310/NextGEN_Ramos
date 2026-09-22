---
tags: [referencia, patrones, consistencia, mensajeria]
requisitos: [R3.1d, R3.1e, R3.2a, R3.2b, R3.3b, RNF-3, RNF-4]
fuentes:
  - https://microservices.io/patterns/data/transactional-outbox.html
  - https://microservices.io/patterns/data/polling-publisher.html
  - https://microservices.io/patterns/data/transaction-log-tailing.html
  - https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html
estado: borrador
---

# Transactional Outbox (y el problema del dual-write)

## Qué es
Es un patrón en el que el servicio escribe el cambio de negocio y el evento que lo describe **en la misma transacción local** de su BD. El evento queda en una tabla `outbox`, y un proceso aparte (*message relay*) lo publica después en el broker.

## Problema que resuelve
Se trata del **dual-write**. Hay que actualizar la BD y publicar un mensaje, y no existe una transacción que cubra las dos cosas. Si se publica después del `COMMIT`, el servicio puede caerse antes de publicar y el evento se pierde. Si se publica antes, el `COMMIT` puede fallar y queda publicado un evento fantasma. La alternativa clásica, 2PC/XA, microservices.io la descarta por frágil y porque muchos brokers no la soportan.

Según microservices.io, con outbox *"messages are guaranteed to be sent if and only if the database transaction commits"*.

## Cómo se implementa
1. En la transacción de negocio: `INSERT` en `transactions`, `UPDATE` de saldos e `INSERT` en `outbox`. Después, un solo `COMMIT`.
2. El relay lee la outbox y publica. Tiene dos variantes:
   - **Polling publisher**: un `SELECT ... FOR UPDATE SKIP LOCKED` periódico sobre filas no publicadas. Funciona en cualquier BD SQL, pero añade latencia de sondeo, más carga sobre la BD y un orden de publicación más difícil de garantizar.
   - **Transaction log tailing**: se lee el WAL, ver [[CDC con Debezium]]. Tiene menos carga y menos latencia, pero depende del motor de BD.
3. Columnas que espera el Outbox Event Router de Debezium: `id` (UUID del evento), `aggregatetype` (define el tópico), `aggregateid` (se usa como clave del mensaje y da el orden por agregado) y `payload`. Debezium trata la outbox **solo con INSERT**, como una cola.
4. Consumidores **idempotentes**: el relay puede publicar duplicados si se cae después de publicar y antes de marcar la fila. Ver [[Idempotency Keys]] y [[Mensajeria asincrona y DLQ]].

Tabla mínima propuesta:
```sql
CREATE TABLE outbox (
  id            uuid PRIMARY KEY,
  aggregatetype text        NOT NULL,   -- 'transfer'
  aggregateid   text        NOT NULL,   -- id de la transferencia / cuenta
  type          text        NOT NULL,   -- 'TransferCompleted'
  payload       jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz            -- solo para polling publisher
);
CREATE INDEX ON outbox (created_at) WHERE published_at IS NULL;
```

## Trade-offs
| A favor | En contra |
|---|---|
| Atomicidad entre estado y evento sin 2PC | Entrega *at-least-once*: obliga a tener consumidores idempotentes |
| El evento sale en el mismo orden que el commit (por agregado) | La tabla crece y hay que purgarla o particionarla |
| La API no espera al broker: la latencia de la transferencia no depende de RabbitMQ/Kafka | Consistencia eventual hacia Bancs y la IA |
| Es fácil de probar y de explicar | Con polling: latencia extra y carga de sondeo sobre la BD |

## Aplicación a SmartBancs
- `POST /transfers` hace, en una sola transacción, lo siguiente: débito/crédito, `INSERT` en `transactions` e `INSERT` en `outbox` con `TransferCompleted`. La respuesta sale apenas termina el `COMMIT` (RNF-2).
- Hay dos consumidores del evento:
  - **Sincronizador con Bancs**, a ritmo controlado (ver [[Sincronizacion con core legado]]; RNF-4, R3.2b).
  - **Servicio de IA**, para recomendaciones (R3.3b, RNF-3). La IA nunca queda en el camino crítico.
- MVP: *polling publisher* con `SKIP LOCKED`, que es simple y no necesita Kafka Connect. En producción: Debezium sobre el WAL. Esta decisión va a un ADR en `03-Decisiones/`.
- Relacionado: [[Concurrencia en PostgreSQL]] y [[Observabilidad]] (hay que propagar el `trace_id` dentro del `payload` o en headers).

## Preguntas que podría hacer el jurado
- *¿Por qué no publicar directamente a la cola después del commit?* Por el dual-write: una caída entre el commit y la publicación pierde el evento.
- *¿Qué pasa si el relay publica dos veces?* Es *at-least-once* por diseño. El consumidor deduplica por `event_id`.
- *¿Cómo garantizas el orden?* Por agregado, usando `aggregateid` como clave de partición. No hay orden global, y no hace falta.
- *¿La outbox no se vuelve un cuello de botella a 10k TPS?* Es un `INSERT` más en la misma transacción, que cuesta poco. El riesgo está en el sondeo: índice parcial, lotes y `SKIP LOCKED`, o pasar a CDC.
- *¿Cuándo purgas la tabla?* Con un job que borra filas publicadas de más de N horas, o con particiones por día y `DROP PARTITION`.
