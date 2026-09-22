---
tags: [referencia, postgresql, pgbouncer, rendimiento, escalabilidad]
requisitos: [R3.1f, R3.5b, R3.5d, R3.6c, RNF-1, RNF-2, RNF-5]
fuentes:
  - https://wiki.postgresql.org/wiki/Number_Of_Database_Connections
  - https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing
  - https://www.pgbouncer.org/config.html
  - https://www.pgbouncer.org/features.html
  - https://www.pgbouncer.org/usage.html
  - https://learn.microsoft.com/en-us/azure/architecture/patterns/queue-based-load-leveling
estado: borrador
---

# Connection pooling (PgBouncer) y escalado a 10k TPS

## Qué es
- **Pool en la aplicación** (HikariCP, asyncpg, pgx): cada instancia reutiliza un conjunto fijo de conexiones.
- **PgBouncer**: un pooler externo y liviano entre muchas instancias de la app y PostgreSQL. Multiplexa miles de conexiones cliente sobre pocas conexiones reales. Tiene tres modos: `session` (default), `transaction` y `statement`.

## Problema que resuelve
Cada conexión PostgreSQL es un **proceso** del sistema operativo. La wiki de PostgreSQL explica que, pasado el "codo", más conexiones activas **bajan** el throughput: aumentan el *context switching*, la contención de spinlocks, la presión de memoria (`work_mem` × conexiones) y la invalidación de caché. En la quincena, 50 pods × 50 conexiones = 2 500 backends, y ese es el camino directo a los **timeouts de conexión** del incidente (R3.5b).

## Cómo se implementa
**Tamaño del pool.** La fórmula de la wiki de PostgreSQL, citada también por HikariCP, es:
> conexiones activas ≈ `(core_count × 2) + effective_spindle_count`

(núcleos físicos; `spindle` = 0 si los datos caben en RAM). Para un servidor de 16 núcleos son unas **32–40 conexiones activas**, no 2 000. HikariCP cita una demo de Oracle en la que *reducir* el pool bajó el tiempo de respuesta de ~100 ms a ~2 ms, y resume: *"a small pool, saturated with threads waiting for connections"*. La cola de espera va en el pool, no en la BD.

**PgBouncer en modo `transaction`:**
```ini
[pgbouncer]
pool_mode = transaction
max_client_conn = 5000       ; conexiones de las apps (default 100)
default_pool_size = 40       ; conexiones reales por user/db (default 20)
query_wait_timeout = 2       ; s en cola antes de desconectar (default 120)
max_prepared_statements = 200 ; habilita prepared statements en transaction mode
```
- Modo `transaction`: la conexión real vuelve al pool al terminar cada transacción. **No funcionan** `SET` de sesión, `LISTEN`, cursores `WITH HOLD`, `PREPARE` SQL explícito ni **advisory locks de sesión** (tabla de features de PgBouncer). Por eso los timeouts se fijan con `SET LOCAL` dentro de la transacción (ver [[Concurrencia en PostgreSQL]]).
- `query_wait_timeout` bajo implementa *fail fast*: es mejor rechazar a los 2 s que dejar al cliente colgado 120 s (RNF-2).

**Cómo llegar a 10k TPS (presupuesto de latencia):**
- Si cada transferencia retiene la conexión unos 4 ms (lock + 2 `UPDATE` + 2 `INSERT` + commit), 10 000 TPS × 0,004 s ≈ **40 conexiones ocupadas en promedio** (ley de Little). Encaja con la fórmula, *si* la transacción es corta.
- Por eso la transacción no debe contener **ninguna llamada de red** (ni IA ni Bancs): se usa [[Transactional Outbox]].
- Otros ingredientes: índices en PK/FK, `synchronous_commit` y WAL en disco rápido, particionar `transactions`/`outbox` por fecha, réplicas de lectura para consultas de historial, escalado horizontal stateless de la API y *load shedding* cuando el pool está saturado (ver [[Incidentes y Post Mortem]]).
- **Límite honesto**: 10k TPS de escritura en un solo primario es alcanzable, pero depende del hardware y de la contención por cuenta. Más allá está el *sharding* por `account_id` (Citus, etc.). Se anota como evolución. **El MVP no demostrará 10k TPS en un portátil**: demostrará el diseño y medirá el throughput real con una prueba de carga.

## Trade-offs
| Opción | A favor | En contra |
|---|---|---|
| Solo pool en la app | Simple, sin otro componente | N réplicas × pool = demasiadas conexiones al escalar |
| PgBouncer `transaction` | Miles de clientes sobre ~40 backends y tolera picos | Pierde features de sesión y es un punto más a operar o duplicar |
| PgBouncer `session` | Compatible con todo | Multiplexa poco y no resuelve el pico |
| Pool grande "por si acaso" | — | Empeora la latencia (evidencia de la wiki PG y HikariCP) |

## Aplicación a SmartBancs
- `docker-compose` (R3.1f): `postgres` + `pgbouncer` + `api`. La API se conecta a PgBouncer.
- La API mantiene un pool pequeño (p. ej. 10–20 por instancia) con **timeout de adquisición** de unos 500 ms y la métrica `db_pool_wait_seconds` (ver [[Observabilidad]]).
- Métricas de saturación (USE): conexiones activas o en espera en PgBouncer (`SHOW POOLS`: `cl_waiting` = clientes esperando servidor; `maxwait` = espera del más antiguo, *"if this starts increasing, then the current pool of servers does not handle requests quickly enough"*), `pg_stat_activity` por `state` y la utilización del pool de la app.
- **Incidente (R3.5d)**: si `cl_waiting` crece, **no** hay que subir `max_connections`. Primero se busca la transacción larga o bloqueada (ver [[Incidentes y Post Mortem]]).

## Preguntas que podría hacer el jurado
- *¿Por qué no subir `max_connections` a 5 000?* Porque cada conexión es un proceso. Pasado el codo, más conexiones bajan el rendimiento (wiki PostgreSQL). La cola va en el pooler.
- *¿Cómo calculaste el tamaño del pool?* Con `(núcleos × 2) + spindles` como punto de partida, verificado con la ley de Little (TPS × duración de la transacción), y después medido.
- *¿Qué pierdes con transaction pooling?* Estado de sesión (SET, LISTEN, advisory locks de sesión, PREPARE explícito). Mi diseño no los usa y usa `SET LOCAL`.
- *¿Realmente soportas 10k TPS?* El diseño está orientado a eso: transacción corta, sin I/O externo, pool dimensionado y outbox. El MVP mide el throughput real y extrapola. No afirmo más de lo que mido.
