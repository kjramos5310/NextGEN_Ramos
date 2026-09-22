---
tags: [referencia, sre, incidentes, postmortem, operaciones]
requisitos: [R3.5a, R3.5b, R3.5c, R3.5d, R3.6a, R3.6b, R3.6c, R3.6d]
fuentes:
  - https://sre.google/sre-book/managing-incidents/
  - https://sre.google/sre-book/postmortem-culture/
  - https://sre.google/sre-book/example-postmortem/
  - https://sre.google/workbook/postmortem-culture/
  - https://sre.google/sre-book/addressing-cascading-failures/
  - https://response.pagerduty.com/before/severity_levels/
  - https://www.postgresql.org/docs/current/functions-admin.html
  - https://www.postgresql.org/docs/current/functions-info.html
  - https://www.postgresql.org/docs/current/monitoring-stats.html
estado: borrador
---

# Gestión de incidentes y post mortem blameless (Google SRE)

## Qué es
- **Gestión de incidentes**: un proceso con roles claros para **mitigar primero** y entender después. Google SRE define cuatro roles: **Incident Commander** (tiene el estado global y asigna), **Operations** (el único que toca producción), **Communication** (actualiza a los interesados) y **Planning** (logística, bugs, relevos). Se trabaja con un **documento vivo** del incidente y relevos explícitos.
- **Post mortem blameless**: un registro escrito del incidente, su impacto, las acciones, las causas y las acciones de seguimiento. Se enfoca en sistemas y procesos, no en culpables: *"You can't 'fix' people, but you can fix systems and processes."*

## Problema que resuelve
En un incidente sin estructura, varias personas cambian producción a la vez, nadie comunica y se pierde el hilo. Sin post mortem, el mismo incidente se repite en la siguiente quincena.

## Cómo se implementa
### A. Escalamiento (R3.6b)
- **Cuándo declarar un incidente** (SRE): hace falta otro equipo, el impacto es **visible al cliente** o no se resuelve tras **1 h** de análisis.
- **Severidad** (PagerDuty): SEV-1 (crítico, gran impacto en clientes) … SEV-5 (cosmético). *"If you are unsure which level … treat it as the higher one."* **Transferencias que no se completan en la quincena = SEV-1.**
- Cadena: alerta → on-call de la plataforma (IC inicial) → DBA on-call + dueño del servicio → comunicación a negocio y atención al cliente → dirección si pasan más de X min en SEV-1.

### B. Acciones inmediatas en el escenario de quincena (R3.5d)
Hay que **estabilizar antes de diagnosticar a fondo**. Orden sugerido, de menor a mayor impacto:
1. **Confirmar el alcance con datos** ([[Observabilidad]]): p99, tasa de errores por `sqlstate`, `db_pool_wait`, `cl_waiting` de PgBouncer.
2. **Encontrar a los bloqueadores:**
   ```sql
   SELECT pid, pg_blocking_pids(pid) AS blocked_by, state, wait_event_type,
          now() - xact_start AS xact_age, left(query, 120) AS query
   FROM pg_stat_activity
   WHERE cardinality(pg_blocking_pids(pid)) > 0
      OR state = 'idle in transaction'
   ORDER BY xact_age DESC;
   ```
   (`pg_blocking_pids` pide acceso exclusivo breve al lock manager: no hay que llamarlo en un bucle agresivo.)
3. **Liberar locks**: `pg_cancel_backend(pid)` cancela solo la consulta, que es lo primero que se intenta. `pg_terminate_backend(pid, timeout)` termina la sesión. Se usa sobre la **cabeza** de la cadena de bloqueo o sobre sesiones `idle in transaction` viejas.
4. **Cortar la fuente de espera**: `SET` en caliente (vía `ALTER ROLE ... SET`, para las sesiones nuevas) de `lock_timeout` o `idle_in_transaction_session_timeout` para fallar rápido en lugar de encolar (ver [[Concurrencia en PostgreSQL]]).
5. **Quitar carga no esencial** (SRE: *eliminate batch load*): pausar los consumidores de la IA y los jobs de ETL o reportes, y abrir manualmente el circuit breaker de la IA. La transferencia no depende de ellos (ver [[Resiliencia - timeouts reintentos y circuit breaker]]).
6. **Load shedding / rate limit** en el gateway: devolver `503` + `Retry-After` antes de saturar la BD. Proteger lo que sí se puede atender.
7. **Balancear y escalar** donde ayuda: más réplicas de la API **solo si el cuello no es la BD**. Hay que revisar el pool: más pods × pool puede empeorar las cosas (ver [[Connection Pooling y 10k TPS]]). Mover lecturas a una réplica.
8. **Revertir** el último despliegue o cambio de configuración si coincide con el inicio.
9. Registrar cada acción con su hora en el documento vivo.

### C. Estructura del post mortem (R3.6a)
Se basa en el ejemplo de Google SRE:
1. **Resumen**, **estado** y **autores**
2. **Impacto**: usuarios o transferencias afectadas, duración, dinero en tránsito, violación del SLO
3. **Causas raíz** (y factores contribuyentes)
4. **Disparador** (*trigger*)
5. **Resolución**
6. **Detección**: ¿cómo lo supimos? ¿alertó el monitoreo o avisaron los usuarios?
7. **Acciones**: tabla *Acción | Tipo (mitigar / prevenir / proceso) | Dueño | Ticket*
8. **Lecciones aprendidas**: qué salió bien, qué salió mal, dónde tuvimos suerte
9. **Línea de tiempo**
10. **Información de soporte**: gráficas, consultas, logs

Se escribe cuando hay impacto visible, pérdida de datos, intervención de on-call, resolución más allá del umbral o falla del monitoreo. Pasa por revisión de pares y se publica en un repositorio de incidentes.

### D. Acciones preventivas (R3.6c, R3.6d)
**Infraestructura:**
- PgBouncer en modo transaction, con pool dimensionado y `query_wait_timeout` corto.
- Réplicas de lectura para consultas de saldo o historial.
- Particionar `transactions` y `outbox`.
- Alertas de saturación temprana (`db_pool_wait`, `cl_waiting`, lock waits).
- **Pruebas de carga que reproduzcan la quincena** antes de cada fecha pico (SRE: *load test until failure*).
- Autoescalado con tope coordinado con el pool de BD.
- Runbook versionado de este incidente.

**Código:**
- Orden de locks consistente.
- Transacciones cortas **sin I/O externo**.
- `lock_timeout` y `statement_timeout` por transacción.
- Reintentos acotados con jitter solo ante `40P01`/`40001`.
- Idempotency keys.
- Outbox para la IA y Bancs.
- Circuit breakers.
- Métricas por `query_name` y `sqlstate`.
- Pruebas automatizadas de concurrencia en CI.
- Estrategia para cuentas calientes (nómina por lote).

## Trade-offs
| Acción | A favor | En contra |
|---|---|---|
| `pg_terminate_backend` | Libera el bloqueo al instante | Aborta la transacción del cliente; hay que confiar en la idempotencia y los reintentos |
| Load shedding | Protege al resto y evita la cascada | Rechaza usuarios de forma deliberada |
| Subir recursos | Rápido | Si la causa es un lock, no ayuda y puede empeorar |
| Post mortem detallado | Aprendizaje real | Cuesta tiempo; requiere cultura blameless |

## Aplicación a SmartBancs
- Documento técnico: escalamiento (A), runbook de acciones inmediatas (B), plantilla de post mortem (C) completada con el incidente simulado, y acciones preventivas (D).
- Repositorio: `docs/runbooks/quincena.md` con las consultas SQL y `docs/postmortem/2026-xx-quincena.md` como ejemplo. Idealmente una **simulación reproducible** (script que genera contención y deadlocks) para mostrar en el video cómo se ve en métricas y logs.

## Preguntas que podría hacer el jurado
- *Llega la alerta, ¿qué es lo primero que haces?* Declarar el incidente, asumir o asignar el IC, confirmar el alcance con métricas y buscar a los bloqueadores con `pg_stat_activity` y `pg_blocking_pids`.
- *¿Matarías conexiones en producción?* Sí, primero `pg_cancel_backend` y luego `pg_terminate_backend` sobre la cabeza del bloqueo. Es seguro porque las transferencias son transaccionales e idempotentes.
- *¿Por qué no simplemente escalar pods?* Si la BD es el cuello, más pods traen más conexiones y más contención.
- *¿Qué hace blameless a un post mortem?* Asume buena intención y busca fallas del sistema y del proceso, no culpables. Sin eso la gente oculta información.
- *¿Cómo evitas que se repita?* Con acciones con dueño y ticket, revisadas, más una prueba de carga de quincena como compuerta antes de cada pico.
