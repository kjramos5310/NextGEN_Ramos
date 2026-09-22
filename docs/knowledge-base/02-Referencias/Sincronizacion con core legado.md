---
tags: [referencia, legado, bancs, integracion, resiliencia]
requisitos: [R3.2a, R3.2b, RNF-1, RNF-2, RNF-4]
fuentes:
  - https://learn.microsoft.com/en-us/azure/architecture/patterns/queue-based-load-leveling
  - https://learn.microsoft.com/en-us/azure/architecture/patterns/rate-limiting-pattern
  - https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer
  - https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker
  - https://www.martinfowler.com/bliki/StranglerFigApplication.html
  - https://www.martinfowler.com/articles/patterns-legacy-displacement/event-interception.html
estado: borrador
---

# Sincronización con core legado: rate limiting, backpressure, micro-lotes, strangler fig

## Qué es
Es un conjunto de patrones para integrar un sistema nuevo de alto volumen con un core legado de capacidad fija, sin transferirle la carga pico:
- **Queue-Based Load Leveling**: una cola hace de amortiguador; el consumidor procesa a su ritmo.
- **Rate Limiting**: se envía al sistema destino como máximo a su capacidad conocida, en lugar de enviar y reintentar ante *throttling*.
- **Backpressure**: el consumidor solo pide más trabajo cuando termina el anterior (prefetch acotado), y la cola absorbe el resto.
- **Micro-lotes**: se agrupan N operaciones o T ms en una sola llamada al legado.
- **Anti-Corruption Layer (ACL)**: un adaptador traduce el modelo moderno al del legado (formatos, códigos, semántica).
- **Strangler Fig**: el legado se reemplaza poco a poco; mientras tanto conviven los dos con una *arquitectura transicional*.

## Problema que resuelve
Bancs *"no puede recibir un alto volumen de consultas directas sin degradarse"* (RNF-4), mientras SmartBancs debe aguantar 10k TPS (RNF-1). Si cada transferencia consultara o actualizara Bancs de forma síncrona, el pico de quincena caería directo sobre el legado. Microsoft muestra además que reintentar contra un servicio con *throttling* multiplica las peticiones: 10 000 registros pueden terminar en 30 000 llamadas.

## Cómo se implementa
1. **Fuente de verdad operativa en SmartBancs**: el saldo disponible vive en la BD de SmartBancs, que el servicio de transferencias usa para autorizar en < 2 s. Bancs es el **libro contable oficial** y se actualiza de forma asíncrona. *Supuesto a validar con el banco: qué saldo manda ante una discrepancia.*
2. **Salida (SmartBancs → Bancs)**: se usa [[Transactional Outbox]] → cola → **Bancs Sync Worker**:
   - un rate limiter (token bucket) fijado a la capacidad acordada con Bancs, liberado en intervalos cortos (p. ej. 20 ops/200 ms en vez de 100 ops/1 s, como recomienda el patrón);
   - micro-lotes (p. ej. 200 movimientos o 500 ms, lo que llegue primero) si Bancs acepta lotes;
   - prefetch acotado (backpressure);
   - **circuit breaker**: si Bancs falla o se degrada, el breaker se abre y deja de llamar; los mensajes esperan en la cola, sin perderse. En *half-open* deja pasar algunas pruebas;
   - idempotencia hacia Bancs: cada movimiento lleva `transfer_id`, y un reintento no duplica el asiento (ver [[Idempotency Keys]]);
   - DLQ para rechazos de negocio de Bancs, con conciliación manual (ver [[Mensajeria asincrona y DLQ]]).
3. **Entrada (Bancs → SmartBancs)**: saldos oficiales o movimientos que nacen en otros canales. Se capturan con CDC o un feed batch de Bancs hacia una réplica de lectura; nunca con consultas en línea por cada request (ver [[CDC con Debezium]]).
4. **Conciliación**: un job periódico compara totales y movimientos por cuenta y día entre SmartBancs y Bancs y alerta las diferencias.
5. **ACL**: el worker traduce el evento `TransferCompleted` al formato de Bancs (códigos de transacción, formato de montos o fechas, longitud fija si aplica).
6. **Strangler Fig** como estrategia de fondo: las nuevas capacidades (transferencias en tiempo real, IA) nacen fuera de Bancs, y con el tiempo se decide qué más "estrangular".

```
Cliente → API Transfers → PostgreSQL (saldo operativo + outbox)
                               │ relay
                               ▼
                           Cola / tópico  ──►  IA (recomendaciones)
                               │
                   Bancs Sync Worker [rate limit + micro-lote + CB + ACL]
                               │  ≤ capacidad Bancs
                               ▼
                             Bancs (libro oficial)
        Conciliación diaria ◄──┘
```

## Trade-offs
| A favor | En contra |
|---|---|
| Bancs recibe una carga plana y predecible (≈ promedio, no pico) | **Consistencia eventual**: Bancs va segundos o minutos atrás en el pico |
| La transferencia no depende de la disponibilidad de Bancs | Hay doble registro de saldos, lo que exige conciliación y reglas claras de "quién manda" |
| Se provisiona para la carga media, no la pico (Microsoft) | La cola puede crecer mucho en la quincena: hay que monitorear la profundidad y el tiempo de drenado |
| El breaker evita fallos en cascada | Riesgo regulatorio si el negocio exige un asiento síncrono en el core: hay que validarlo |

## Aplicación a SmartBancs
- **Teórico (R3.2a/b)**: el diagrama y la explicación de arriba van al documento técnico.
- **MVP**: el mock de Bancs tiene latencia configurable y un límite de TPS, para demostrar que el worker respeta el rate limit y que la cola absorbe el pico.
- **Métricas clave**: profundidad de cola, lag de sincronización (`now − created_at` del último evento aplicado), tasa de envíos a Bancs, estado del breaker y diferencias en la conciliación (ver [[Observabilidad]]).
- **Relación con la capacidad**: si el pico es 10k TPS durante 10 min y Bancs admite 2k TPS, se acumulan unos (10k − 2k) × 600 s = 4,8 M eventos. Se drenan en unos 40 min si el tráfico posterior es bajo; con tráfico de fondo T, el tiempo es 4,8 M / (2k − T). Hay que decir estos números en la defensa y ajustarlos al supuesto de capacidad real.

## Preguntas que podría hacer el jurado
- *¿Qué saldo ve el cliente si Bancs va atrasado?* El saldo operativo de SmartBancs, que ya incluye sus transferencias. Bancs converge después.
- *¿Y si una transferencia se rechaza en Bancs?* Va a la DLQ, pasa por conciliación y se aplica una compensación (reverso) mediante un evento. Es un mini-saga.
- *¿Cómo sabes la capacidad de Bancs?* Es un supuesto parametrizable (rate limit configurable). Se mide con pruebas de carga contra un ambiente de Bancs.
- *¿Por qué no llamar a Bancs síncronamente y cachear?* Una caché solo resuelve lecturas. Las escrituras seguirían cayendo en pico sobre Bancs, y su latencia se sumaría a los 2 s.
- *¿Por qué no un batch nocturno?* Porque la IA y la conciliación ganan con datos casi en tiempo real. Los micro-lotes son un punto medio.
