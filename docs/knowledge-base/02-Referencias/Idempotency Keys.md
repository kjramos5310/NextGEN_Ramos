---
tags: [referencia, api, pagos, idempotencia]
requisitos: [R3.1a, R3.1b, R3.1e, R3.2b, R3.6d, RNF-2]
fuentes:
  - https://docs.stripe.com/api/idempotent_requests
  - https://stripe.com/blog/idempotency
  - https://brandur.org/idempotency-keys
  - https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/
estado: borrador
---

# Idempotency keys en APIs de pagos

## Qué es
Es un identificador único que genera el **cliente** y envía en el header `Idempotency-Key` de un `POST`. El servidor guarda el resultado de la primera ejecución asociado a esa clave y, ante un reintento con la misma clave, **devuelve el mismo resultado sin volver a ejecutar** el efecto (el débito).

## Problema que resuelve
Stripe describe tres puntos en que puede fallar una petición: al conectar, a mitad de la ejecución, o **después de ejecutar pero antes de que llegue la respuesta**. En el último caso el cliente no sabe si la transferencia se hizo; si reintenta sin idempotencia, **debita dos veces**. Los timeouts de la quincena (R3.5) convierten este caso en algo frecuente.

## Cómo se implementa
Reglas de Stripe (docs oficiales):
- Se guarda **código de estado y cuerpo** de la primera respuesta, *"regardless of whether it succeeds or fails"*, incluidos los `500`.
- Las claves se sugieren como **UUID v4**, de hasta 255 caracteres, **sin datos sensibles**.
- Se pueden purgar después de **24 h**.
- Si llega la misma clave con **parámetros distintos**, se responde con error (por mal uso).
- No se guarda resultado si la validación falla o si hay **otra petición concurrente con la misma clave**; en ese caso el cliente puede reintentar.
- Solo aplica a `POST`: `GET`/`DELETE` ya son idempotentes.

El borrador IETF `draft-ietf-httpapi-idempotency-key-header` (expirado, sin llegar a RFC) propone: `400` si falta la clave cuando es obligatoria, `409` si hay una petición en curso con la misma clave y `422` si se reutiliza con otro payload.

Diseño en PostgreSQL (según brandur.org, ex-Stripe):
```sql
CREATE TABLE idempotency_keys (
  client_id        uuid        NOT NULL,
  idem_key         text        NOT NULL,
  request_hash     text        NOT NULL,          -- sha256 del body normalizado
  status           text        NOT NULL,          -- 'in_progress' | 'completed'
  response_code    int,
  response_body    jsonb,
  transfer_id      uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, idem_key)               -- unicidad por cliente
);
```
Flujo:
1. `INSERT ... ON CONFLICT DO NOTHING` **en la misma transacción** que la transferencia.
2. Si hubo conflicto: si el `request_hash` es distinto, `422`; si está `in_progress`, `409`; si está `completed`, se reenvía la respuesta guardada.
3. Si se insertó: se ejecuta la transferencia, se guarda la respuesta y se hace `COMMIT` de todo junto. Así la clave y el efecto son **atómicos**.
4. Brandur agrega *recovery points* y *atomic phases* para operaciones con efectos externos (llamadas a terceros). En SmartBancs no hacen falta en el camino síncrono, porque la llamada a Bancs es asíncrona (ver [[Transactional Outbox]]).

## Trade-offs
| A favor | En contra |
|---|---|
| Reintentos seguros ante timeouts: el cliente puede reintentar con backoff | Una escritura e índice más por transacción; es una tabla caliente a 10k TPS (hay que particionarla y purgarla) |
| Protege contra el doble clic y los reintentos de proxies | Obliga al cliente a generar y persistir la clave entre reintentos |
| La misma idea sirve para consumidores de eventos (`event_id`) | Hay que elegir la ventana de retención (24 h) y aceptar que después se tratará como petición nueva |

## Aplicación a SmartBancs
- `POST /transfers` exige `Idempotency-Key` (`400` si falta). Es parte de R3.1a y del DDL R3.1b.
- La clave se inserta en la **misma transacción** que el débito y la outbox, lo que la hace consistente con [[Concurrencia en PostgreSQL]].
- Consumidores (Bancs Sync, IA): tabla `processed_events(event_id PK)`, con el mismo principio (ver [[Mensajeria asincrona y DLQ]]).
- Hacia Bancs se envía `transfer_id` como referencia única, para que un reintento del worker no duplique el asiento (ver [[Sincronizacion con core legado]]).
- Prueba: 20 peticiones concurrentes con la misma clave deben producir **un** débito, una respuesta `201` y el resto `201` repetida o `409`.

## Preguntas que podría hacer el jurado
- *¿Quién genera la clave y por qué no el servidor?* El cliente, porque es quien reintenta. Si la generara el servidor, se perdería justo en el caso en que no llegó la respuesta.
- *¿Qué pasa si llegan dos peticiones con la misma clave al mismo tiempo?* La PK hace que solo una inserte. La otra ve `in_progress` y recibe `409`, o espera al lock de la fila y luego lee `completed`.
- *¿Y si la misma clave llega con otro monto?* El `request_hash` no coincide y se responde `422`: es un error del cliente.
- *¿Guardas también los errores?* Sí, igual que Stripe, para que el reintento vea el mismo resultado. La excepción son los errores de validación previos a la ejecución.
- *¿No basta con un `UNIQUE` en `transactions`?* Evita el duplicado, pero no devuelve la respuesta original ni detecta un payload distinto.
