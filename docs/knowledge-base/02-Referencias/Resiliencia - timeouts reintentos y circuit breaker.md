---
tags: [referencia, resiliencia, timeouts, circuit-breaker, async]
requisitos: [R3.3b, R3.3c, R3.5d, R3.6d, RNF-2, RNF-3, RNF-4]
fuentes:
  - https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker
  - https://learn.microsoft.com/en-us/azure/architecture/patterns/asynchronous-request-reply
  - https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
  - https://sre.google/sre-book/addressing-cascading-failures/
  - https://stripe.com/blog/idempotency
estado: borrador
---

# Resiliencia: timeouts, reintentos, circuit breaker y consumo no bloqueante

## Qué es
Son los mecanismos que evitan que una dependencia lenta (IA, Bancs, BD) arrastre al servicio de transferencias:
- **Timeout / deadline**: tiempo máximo de espera, propagado a lo largo de la cadena de llamadas.
- **Reintento con backoff + jitter**: solo para errores transitorios y solo sobre operaciones idempotentes.
- **Circuit breaker**: tiene tres estados. *Closed* (pasa todo y cuenta fallos), *Open* (falla de inmediato durante un tiempo) y *Half-Open* (deja pasar algunas pruebas: si fallan vuelve a Open, si funcionan cierra).
- **Consumo no bloqueante**: la llamada a la IA sale del camino crítico, sea por un evento (fire-and-forget) o por *Asynchronous Request-Reply* (`202 Accepted` + endpoint de estado).

## Problema que resuelve
- RNF-2 (< 2 s): sin timeouts, una dependencia lenta retiene hilos y conexiones hasta agotar el pool, que es la causa típica del incidente de quincena.
- RNF-3: la recomendación de IA **nunca** puede sumar latencia a la transferencia.
- Google SRE (*Addressing Cascading Failures*): los reintentos sin límite y la falta de deadlines convierten una degradación parcial en una caída total.

## Cómo se implementa
**Presupuesto de latencia para `POST /transfers` (objetivo p99 < 2 s):**
```
Gateway/API       50 ms
Adquirir conexión ≤ 500 ms  (timeout del pool → 503)
Transacción BD    ≤ 1500 ms (statement_timeout; lock_timeout 500 ms)
IA                0 ms      (asíncrona vía outbox/cola)
Bancs             0 ms      (asíncrono vía outbox/cola)
```
**IA no bloqueante (R3.3b):** hay dos variantes compatibles.
1. **Por eventos (preferida)**: la transferencia hace commit, responde `201` y el evento `TransferCompleted` llega a la IA. La recomendación se guarda o se notifica después (push, o `GET /recommendations`).
2. **Llamada async en proceso**: el handler lanza una tarea en segundo plano (`asyncio.create_task`, `CompletableFuture`, goroutine) con **timeout corto** y **circuit breaker**, *después* de responder. Es más simple, pero se pierde si el pod muere. Solo sirve como demo.
   - *Anti-patrón*: `await ai.recommend()` dentro del handler antes de responder.
3. Si el cliente necesita la recomendación en la misma pantalla: *Asynchronous Request-Reply*, donde `202` + `Location: /recommendations/{id}` y el cliente consulta después.

**Reintentos:**
- Máximo 2 o 3, con **full jitter**. Solo sobre operaciones idempotentes (ver [[Idempotency Keys]]).
- Reintentar en **una sola capa**: si el cliente, el gateway y el servicio reintentan cada uno 3 veces, la carga se multiplica por 27.
- SRE sugiere un **presupuesto de reintentos** por servicio, además de revisar el deadline restante antes de reintentar.

**Circuit breaker** hacia la IA y hacia Bancs:
- Umbral por tasa de error o timeout en una ventana deslizante.
- Microsoft recomienda *no* compartir un breaker entre recursos independientes y exponer su estado como métrica.
- Si está abierto hacia la IA: la transferencia sigue igual y la recomendación se degrada (sin recomendación, o una genérica por reglas).

## Trade-offs
| Mecanismo | A favor | En contra |
|---|---|---|
| Timeouts cortos | Liberan recursos y cumplen el SLO | Muy cortos provocan fallos espurios; se calibran con p99 |
| Reintentos | Absorben fallos transitorios | Amplifican la carga en incidentes; exigen idempotencia |
| Circuit breaker | Evita la cascada y da tiempo al downstream | Otro estado que configurar y probar; hay falsos positivos |
| IA por eventos | Aislamiento total, no pierde eventos | La recomendación llega con segundos de retraso |

## Aplicación a SmartBancs
- La API de transferencias **no tiene dependencia síncrona** de la IA ni de Bancs. Es el argumento central para RNF-2 y RNF-3.
- **Evidencia (R3.3c)**: una prueba que inyecta 5 s de latencia en el mock de IA y muestra que el p95 de `POST /transfers` **no cambia**. Se captura en `04-Evidencias/`.
- Métricas: `ai_request_duration_seconds`, `ai_requests_total{outcome}`, `circuit_breaker_state{target}` (ver [[Observabilidad]]).
- En el incidente (R3.5d) se puede **abrir manualmente** el breaker de la IA o apagar el consumidor para liberar recursos (*eliminate batch load*, SRE). Ver [[Incidentes y Post Mortem]].

## Preguntas que podría hacer el jurado
- *¿Cómo demuestras que la IA no afecta la transacción?* Con una prueba A/B de latencia del mock de IA (0 s contra 5 s): el p95 de transferencias no varía.
- *¿Qué pasa si la IA está caída una hora?* Las transferencias siguen, los eventos se acumulan en la cola (o en la DLQ tras N intentos) y la IA se pone al día al volver.
- *¿Dónde pondrías el circuit breaker?* En el cliente de la IA y en el worker de Bancs; nunca uno compartido entre ambos.
- *¿Por qué no reintentas en todas las capas?* Por la amplificación exponencial de reintentos. Se reintenta en un solo punto y con presupuesto.
