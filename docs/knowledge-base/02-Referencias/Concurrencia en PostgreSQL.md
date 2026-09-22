---
tags: [referencia, postgresql, concurrencia, locks, deadlocks]
requisitos: [R3.1b, R3.1d, R3.1e, R3.4d, R3.5a, R3.5b, R3.5c, R3.5d, R3.6d, RNF-2]
fuentes:
  - https://www.postgresql.org/docs/current/explicit-locking.html
  - https://www.postgresql.org/docs/current/transaction-iso.html
  - https://www.postgresql.org/docs/current/sql-select.html
  - https://www.postgresql.org/docs/current/mvcc-serialization-failure-handling.html
  - https://www.postgresql.org/docs/current/runtime-config-client.html
  - https://www.postgresql.org/docs/current/runtime-config-locks.html
  - https://www.postgresql.org/docs/current/errcodes-appendix.html
estado: borrador
---

# Concurrencia en PostgreSQL: bloqueo pesimista vs optimista, orden de locks, deadlocks, timeouts

## Qué es
Son las herramientas de PostgreSQL para que dos transferencias simultáneas sobre la misma cuenta no produzcan un **lost update** (saldo incorrecto) ni un sobregiro:
- **Pesimista**: se bloquea la fila antes de leerla y modificarla (`SELECT ... FOR UPDATE`, o un `UPDATE` atómico condicionado).
- **Optimista**: sin lock, con una columna `version`: `UPDATE ... WHERE id=? AND version=?`. Si afecta 0 filas, hubo conflicto y se reintenta.
- **Aislamiento**: el default es *Read Committed*. En *Repeatable Read* y *Serializable*, los conflictos terminan en error `40001` y la app debe reintentar.

## Problema que resuelve
Race condition clásica: A y B leen `saldo = 100` y cada una debita 80. Las dos escriben 20 y se pierde un débito, o el saldo queda negativo. En *Read Committed*, un `UPDATE` que encuentra la fila modificada por otra transacción **espera** y luego **re-evalúa el `WHERE`** sobre la versión nueva. Por eso un `UPDATE` atómico con condición es seguro, pero el patrón *leer en la app, calcular y escribir* no lo es.

## Cómo se implementa
**1. Débito atómico condicionado.** Es la opción más simple y rápida para un solo saldo:
```sql
UPDATE accounts SET balance = balance - $1, updated_at = now()
WHERE id = $2 AND balance >= $1;      -- 0 filas ⇒ saldo insuficiente
```
**2. Transferencia entre dos cuentas (pesimista con orden de locks):**
```sql
BEGIN;
SET LOCAL lock_timeout = '500ms';     -- no esperar indefinidamente
SET LOCAL statement_timeout = '1500ms';
SELECT id, balance FROM accounts
 WHERE id IN ($from, $to)
 ORDER BY id                            -- ORDEN CONSISTENTE ⇒ evita deadlock
 FOR UPDATE;
-- validar saldo en la app, luego:
UPDATE accounts SET balance = balance - $amt WHERE id = $from;
UPDATE accounts SET balance = balance + $amt WHERE id = $to;
INSERT INTO transactions (...); INSERT INTO outbox (...);
COMMIT;
```
- **Deadlock**: la documentación usa exactamente el caso de dos transferencias cruzadas (11111→22222 y 22222→11111). Su recomendación: *"acquire locks on multiple objects in a consistent order"*. También recomienda que el primer lock sobre un objeto sea el modo más restrictivo que se vaya a necesitar (por eso `FOR UPDATE` y no un `SELECT` simple seguido de `UPDATE`).
- PostgreSQL detecta el deadlock después de `deadlock_timeout` (default **1 s**) y **aborta una de las transacciones**; no se puede predecir cuál. El error es `40P01 deadlock_detected`.
- **`NOWAIT`**: el lock falla de inmediato en vez de esperar. **`SKIP LOCKED`**: salta filas bloqueadas; es útil solo para colas (el relay de [[Transactional Outbox]]), porque *"provides an inconsistent view of the data"*.
- **Optimista** (alternativa): la columna `version int`. Funciona bien cuando la contención es baja, y se degrada con cuentas "calientes" por la cantidad de reintentos.

**3. Timeouts (por sesión o transacción, no globales).** La documentación desaconseja fijarlos en `postgresql.conf` porque afectan a todas las sesiones.

| Parámetro | Qué hace | Error |
|---|---|---|
| `lock_timeout` | Aborta la sentencia que espera un lock más de X | `55P03 lock_not_available` |
| `statement_timeout` | Aborta la sentencia que dura más de X | `57014 query_canceled` |
| `idle_in_transaction_session_timeout` | Termina las sesiones "idle in transaction" que retienen locks | cierre de sesión |
| `transaction_timeout` (PG 17+) | Limita la duración total de la transacción | cierre de sesión |

`lock_timeout` debe ser **menor** que `statement_timeout`; si no, no sirve de nada (lo dice la propia documentación).

**4. Política de reintentos** (según "Serialization Failure Handling"): reintentar la **transacción completa**, no solo la sentencia, ante `40001` y `40P01`, con backoff y jitter y un máximo de intentos (ver [[Resiliencia - timeouts reintentos y circuit breaker]]). Ante `55P03`, reintentar poco o fallar rápido con `409`/`503`. `23505` (unique violation) no se reintenta a ciegas: puede ser un duplicado real (ver [[Idempotency Keys]]).

**5. Diagnóstico** (R3.5a–c): `log_lock_waits = on` registra las esperas que superan `deadlock_timeout`. Los logs de `40P01` incluyen las sentencias involucradas. `pg_stat_activity` y `pg_blocking_pids()` muestran quién bloquea a quién (ver [[Observabilidad]] y [[Incidentes y Post Mortem]]).

## Trade-offs
| Estrategia | A favor | En contra |
|---|---|---|
| `UPDATE` atómico condicionado | Una sola sentencia, lock mínimo, sin reintentos | Solo sirve para una fila; con dos cuentas hace falta ordenar |
| Pesimista `FOR UPDATE` + orden | Correcto con dos cuentas, sin deadlocks entre transferencias | Serializa las cuentas calientes y la latencia sube con la contención |
| Optimista `version` | Sin esperas y bueno con contención baja | Tormenta de reintentos en cuentas calientes (p. ej. cuenta recaudadora en quincena) |
| `SERIALIZABLE` | Garantía fuerte sin razonar locks | Más abortos `40001` y costo de reintentos a 10k TPS |

## Aplicación a SmartBancs
- **Decisión propuesta (para ADR)**: *Read Committed* + `FOR UPDATE` ordenado por `id` + `lock_timeout` corto + reintento acotado ante `40P01`/`40001`. `CHECK (balance >= 0)` en el DDL como red de seguridad (R3.1b).
- **Prueba de concurrencia (R3.1e)**: N hilos transfieren al mismo tiempo entre las mismas cuentas en ambos sentidos. Se verifica que la suma total se conserva, que ningún saldo queda negativo y que no hay deadlocks sin manejar.
- **Cuentas calientes** (quincena: una cuenta empresa paga a miles de empleados): con orden de locks la cuenta origen se serializa. Mitigaciones: lotes de nómina procesados como una sola operación, o *sub-cuentas / saldo particionado*. Queda anotado como riesgo.
- **Log por operación de BD** con `sqlstate`, duración y nombre de la consulta, para que un timeout o deadlock señale la consulta exacta (R3.4d, R3.5a–c).

## Preguntas que podría hacer el jurado
- *¿Por qué no bastan las transacciones para evitar race conditions?* En *Read Committed* un leer-calcular-escribir en la app pierde actualizaciones. Hace falta un lock o una escritura atómica condicionada.
- *¿Cómo evitas deadlocks en A→B y B→A simultáneas?* Bloqueando las dos cuentas en orden ascendente de `id`. Si aun así ocurre, PostgreSQL aborta una con `40P01` y la reintento.
- *¿Pesimista u optimista?* En banca con cuentas calientes y dinero de por medio, pesimista: la espera es predecible y no genera tormentas de reintento.
- *¿Qué valor de `lock_timeout` pones?* Menos que el presupuesto de 2 s. Por ejemplo 500 ms de lock y 1,5 s de sentencia, calibrados con la prueba de carga.
- *¿`deadlock_timeout` en 1 s no es mucho?* Solo es el tiempo antes de *buscar* un deadlock. Con `lock_timeout` < 1 s la espera se corta antes. Se puede bajar para diagnosticar.
