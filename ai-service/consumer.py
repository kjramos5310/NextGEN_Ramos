"""Consumidor de eventos `transaction.created` (RabbitMQ) del ai-service.

Garantías:
- ack SOLO cuando el backend confirmó la persistencia (2xx, o 409 de duplicado).
- Errores transitorios del POST (timeout, conexión, 5xx): reintentos con backoff.
- Reintentos agotados o mensaje inválido (JSON roto, 4xx): basic_nack(requeue=False),
  y RabbitMQ lo enruta a la DLQ (smartbancs.dlx -> smartbancs.ai.dlq).
- Idempotencia: el backend deduplica por transaction_id (índice único), así que
  reenviar un POST duplicado es seguro. El eventId del outbox se loguea para trazabilidad.
"""
import json
import logging
import os
import threading
import time
from typing import Any, Dict, Optional

import pika
import requests

from advisor import advisor
from log_context import configure_logging, event_context

configure_logging()
logger = logging.getLogger("AI-Worker")

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
BACKEND_API_URL = os.getenv("BACKEND_API_URL", "http://localhost:4000")

# Contrato de colas COMPARTIDO con el backend (rabbitmq.service.ts). Debe ser idéntico,
# si no RabbitMQ responde PRECONDITION_FAILED al declarar la cola.
QUEUE_NAME = "smartbancs.ai.queue"
DLX_EXCHANGE = "smartbancs.dlx"
DLQ_NAME = "smartbancs.ai.dlq"
DLQ_ROUTING_KEY = "smartbancs.ai.dlq"
QUEUE_ARGUMENTS = {
    "x-dead-letter-exchange": DLX_EXCHANGE,
    "x-dead-letter-routing-key": DLQ_ROUTING_KEY,
}

# Intentos totales del POST al backend y espera antes de cada reintento.
BACKEND_MAX_ATTEMPTS = 3
BACKEND_RETRY_BACKOFF_SECONDS = (0.5, 1.0, 2.0)
BACKEND_TIMEOUT_SECONDS = 5.0

# Campos que acepta POST /api/v1/recommendations
_BACKEND_FIELDS = ("accountNumber", "transactionId", "type", "title", "message", "confidenceScore")


class ConsumerState:
    """Estado del consumidor expuesto en /health (conectado y último mensaje)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.connected = False
        self.last_message_at: Optional[float] = None
        self.acked = 0
        self.dead_lettered = 0

    def set_connected(self, value: bool) -> None:
        with self._lock:
            self.connected = value

    def record(self, acked: bool) -> None:
        with self._lock:
            self.last_message_at = time.time()
            if acked:
                self.acked += 1
            else:
                self.dead_lettered += 1

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "connected": self.connected,
                "lastMessageAt": self.last_message_at,
                "messagesAcked": self.acked,
                "messagesDeadLettered": self.dead_lettered,
            }


consumer_state = ConsumerState()


def build_backend_payload(
    recommendation: Dict[str, Any], inference_latency_ms: float, event_id: Optional[str]
) -> Dict[str, Any]:
    payload = {k: recommendation.get(k) for k in _BACKEND_FIELDS if recommendation.get(k) is not None}
    metadata = dict(recommendation.get("metadata") or {})
    metadata["engine"] = recommendation.get("engine")
    metadata["inferenceLatencyMs"] = round(float(inference_latency_ms), 3)
    if event_id:
        metadata["eventId"] = event_id
    payload["metadata"] = metadata
    return payload


def post_recommendation_with_retries(payload: Dict[str, Any], correlation_id: str) -> bool:
    """POST al backend. True = persistido (o duplicado ya persistido); False = debe ir a la DLQ."""
    endpoint = f"{BACKEND_API_URL}/api/v1/recommendations"
    headers = {"x-correlation-id": correlation_id, "Content-Type": "application/json"}

    for attempt in range(1, BACKEND_MAX_ATTEMPTS + 1):
        reason: str
        try:
            resp = requests.post(endpoint, json=payload, headers=headers, timeout=BACKEND_TIMEOUT_SECONDS)
        except requests.exceptions.Timeout:
            reason = f"timeout (> {BACKEND_TIMEOUT_SECONDS:.0f} s)"
        except requests.exceptions.ConnectionError as e:
            reason = f"error de conexión: {str(e)[:200]}"
        else:
            status = resp.status_code
            if 200 <= status < 300:
                logger.info(f"[BACKEND-POST] Recomendación persistida (HTTP {status}, intento {attempt}/{BACKEND_MAX_ATTEMPTS})")
                return True
            if status == 409:
                logger.info(f"[BACKEND-POST] Recomendación duplicada ya persistida (HTTP 409). Se considera entregada.")
                return True
            if status < 500:
                logger.error(f"[BACKEND-POST] Error permanente HTTP {status}: {resp.text[:200]}. Sin reintento.")
                return False
            reason = f"HTTP {status}: {resp.text[:200]}"

        if attempt < BACKEND_MAX_ATTEMPTS:
            wait = BACKEND_RETRY_BACKOFF_SECONDS[min(attempt - 1, len(BACKEND_RETRY_BACKOFF_SECONDS) - 1)]
            logger.warning(
                f"[BACKEND-POST] Fallo transitorio en intento {attempt}/{BACKEND_MAX_ATTEMPTS} ({reason}). "
                f"Reintentando en {wait:.1f} s"
            )
            time.sleep(wait)
        else:
            logger.error(f"[BACKEND-POST] Fallo transitorio en intento {attempt}/{BACKEND_MAX_ATTEMPTS} ({reason}). Reintentos agotados.")
    return False


def _ack(ch, delivery_tag) -> None:
    ch.basic_ack(delivery_tag=delivery_tag)
    consumer_state.record(acked=True)


def _dead_letter(ch, delivery_tag, reason: str) -> None:
    logger.error(f"[DLQ] Mensaje enviado a {DLQ_NAME} (nack requeue=False). Motivo: {reason}")
    ch.basic_nack(delivery_tag=delivery_tag, requeue=False)
    consumer_state.record(acked=False)


def process_transaction_event(ch, method, properties, body):
    delivery_tag = method.delivery_tag
    amqp_correlation_id = getattr(properties, "correlation_id", None)

    # 1. Parseo y validación del mensaje: si es inválido no tiene sentido reintentarlo.
    try:
        message = json.loads(body.decode("utf-8") if isinstance(body, (bytes, bytearray)) else body)
        if not isinstance(message, dict) or not isinstance(message.get("data"), dict):
            raise ValueError("el mensaje no tiene el objeto 'data'")
    except (ValueError, UnicodeDecodeError) as e:
        with event_context(amqp_correlation_id):
            _dead_letter(ch, delivery_tag, f"mensaje inválido ({type(e).__name__}: {str(e)[:200]})")
        return

    tx_data = message["data"]
    correlation_id = message.get("correlationId") or amqp_correlation_id or "N/A"
    transaction_id = tx_data.get("transactionId")
    event_id = tx_data.get("eventId")

    with event_context(correlation_id, transaction_id, event_id):
        try:
            logger.info(
                f"Evento recibido para cuenta {tx_data.get('accountNumber')} "
                f"(redelivered={getattr(method, 'redelivered', False)})"
            )
            if not tx_data.get("accountNumber"):
                _dead_letter(ch, delivery_tag, "mensaje inválido (falta data.accountNumber)")
                return

            # 2. Inferencia (Gemini o fallback heurístico)
            started = time.perf_counter()
            recommendation = advisor.analyze_transaction(tx_data)
            inference_latency_ms = (time.perf_counter() - started) * 1000
            logger.info(
                f"[AI-INFERENCE] Recomendación generada por {recommendation.get('engine')} en "
                f"{inference_latency_ms:.2f} ms: [{recommendation['type']}] {recommendation['title']}"
            )

            # 3. Persistencia en el backend con reintentos
            payload = build_backend_payload(recommendation, inference_latency_ms, event_id)
            if post_recommendation_with_retries(payload, correlation_id):
                _ack(ch, delivery_tag)
            else:
                _dead_letter(ch, delivery_tag, "el backend no confirmó la persistencia")
        except Exception as e:
            logger.error(f"Error inesperado procesando el evento: {e}", exc_info=True)
            _dead_letter(ch, delivery_tag, f"error inesperado ({type(e).__name__})")


def declare_topology(channel) -> None:
    """Declara DLX, DLQ y la cola principal exactamente como el backend."""
    channel.exchange_declare(exchange=DLX_EXCHANGE, exchange_type="direct", durable=True)
    channel.queue_declare(queue=DLQ_NAME, durable=True)
    channel.queue_bind(queue=DLQ_NAME, exchange=DLX_EXCHANGE, routing_key=DLQ_ROUTING_KEY)
    channel.queue_declare(queue=QUEUE_NAME, durable=True, arguments=QUEUE_ARGUMENTS)


def start_consumer():
    while True:
        try:
            logger.info("Conectando el consumidor de IA a RabbitMQ...")
            params = pika.URLParameters(RABBITMQ_URL)
            connection = pika.BlockingConnection(params)
            channel = connection.channel()

            declare_topology(channel)
            channel.basic_qos(prefetch_count=5)
            channel.basic_consume(queue=QUEUE_NAME, on_message_callback=process_transaction_event)

            consumer_state.set_connected(True)
            logger.info(f"Consumidor de IA escuchando la cola '{QUEUE_NAME}' (DLQ: '{DLQ_NAME}')")
            channel.start_consuming()
            consumer_state.set_connected(False)
        except Exception as e:
            consumer_state.set_connected(False)
            logger.warning(f"Error de conexión del consumidor con RabbitMQ: {e}. Reintentando en 5 segundos...")
            time.sleep(5)
