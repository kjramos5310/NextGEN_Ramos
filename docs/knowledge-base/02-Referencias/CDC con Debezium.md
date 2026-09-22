---
tags: [referencia, cdc, debezium, postgresql, integracion]
requisitos: [R3.2a, R3.2b, RNF-4, R3.3d]
fuentes:
  - https://debezium.io/documentation/reference/stable/connectors/postgresql.html
  - https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html
  - https://www.postgresql.org/docs/current/logicaldecoding-explanation.html
  - https://microservices.io/patterns/data/transaction-log-tailing.html
  - https://www.martinfowler.com/articles/patterns-legacy-displacement/event-interception.html
estado: borrador
---

# Change Data Capture (Debezium)

## Qué es
**CDC** consiste en capturar los cambios confirmados de una BD leyendo su log de transacciones, sin hacer consultas sobre las tablas. **Debezium** es un conjunto de conectores de Kafka Connect que convierten ese log en eventos (`c`/`u`/`d`/`r`). En PostgreSQL usa *logical decoding* con el plugin `pgoutput` (nativo desde PG 10) y un **replication slot**.

## Problema que resuelve
- Propaga cambios sin *polling* sobre la BD de origen y sin dual-write (ver [[Transactional Outbox]]).
- Martin Fowler lo describe como una forma de *Event Interception*: mantiene sincronizados el sistema nuevo y el legado sin tocar mucho el legado (ver [[Sincronizacion con core legado]]).

## Cómo se implementa
- Servidor: `wal_level = logical`. Se crea una publicación y un slot; Debezium puede crearlos solo.
- Primer arranque: **snapshot** inicial (eventos `r`). Luego hace streaming desde el LSN registrado, de modo que no se pierden los cambios ocurridos entre el snapshot y el streaming.
- Con outbox, el SMT **Outbox Event Router** lleva cada fila al tópico `outbox.event.<aggregatetype>` y usa `aggregateid` como clave.
- `heartbeat.interval.ms` emite latidos cuando no hay cambios, para que el offset avance y el slot no retenga WAL de más.
- Garantía: **at-least-once**. Después de una caída pueden repetirse eventos. La documentación de PostgreSQL dice: *"Logical decoding clients are responsible for avoiding ill effects from handling the same message more than once."*

## Trade-offs
| A favor | En contra |
|---|---|
| Latencia baja (ms) y carga casi nula en las tablas | Hay que operar Kafka + Kafka Connect + Debezium: mucha infraestructura para un MVP |
| El orden del commit se respeta por clave | **Riesgo de disco**: un slot sin consumidor retiene WAL indefinidamente. En casos extremos puede forzar el apagado de la BD para prevenir *transaction ID wraparound*. Hay que monitorear el lag del slot o fijar `max_slot_wal_keep_size` |
| No cambia el código de la app (con outbox, un cambio mínimo) | Hace falta idempotencia en el consumidor |
| Es reproducible: se puede re-snapshot | Acoplamiento al esquema físico si no se usa outbox (se filtra el modelo interno) |

## Aplicación a SmartBancs
- **Producción**: Debezium lee la `outbox` de la BD de SmartBancs y publica en Kafka. De ahí consumen el sincronizador de Bancs y la IA.
- **Del lado de Bancs**, si es posible leer su log (mainframe/DB2 con herramientas de CDC propietarias), se puede traer saldos oficiales a una **réplica de lectura** sin consultar Bancs en línea (RNF-4). Es un supuesto: hay que confirmar qué expone Bancs.
- **MVP**: no se implementa Debezium; se usa *polling publisher*. Se documenta como evolución en el ADR.
- La alerta del lag del replication slot entra en [[Observabilidad]].

## Preguntas que podría hacer el jurado
- *¿Por qué CDC sobre la outbox y no sobre las tablas de negocio?* La outbox es un contrato de eventos estable. CDC sobre las tablas filtra el esquema interno y genera eventos "de fila", no de dominio.
- *¿Qué pasa si Debezium se cae un día entero?* El slot retiene WAL y el disco crece. Por eso existe la alerta de lag y `max_slot_wal_keep_size`. Al volver, Debezium sigue desde el último LSN.
- *¿Da exactly-once?* No. Da at-least-once y la deduplicación la hace el consumidor.
- *¿Por qué no en el MVP?* Por costo operativo frente al valor demostrable en la defensa. El patrón (outbox) es el mismo y solo cambia el relay.
