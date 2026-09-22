"""Contexto de trazabilidad para los logs del ai-service.

Usa contextvars (no variables globales mutables) para que cada log emitido mientras
se procesa un evento lleve correlationId, transactionId y eventId, tanto en el
consumidor como en el advisor. Los valores se inyectan en cada LogRecord mediante
un record factory, así que funcionan con cualquier handler (consola, uvicorn, pytest).
"""
import contextvars
import logging
from contextlib import contextmanager
from typing import Iterator, Optional

_correlation_id: contextvars.ContextVar[str] = contextvars.ContextVar("correlation_id", default="-")
_transaction_id: contextvars.ContextVar[str] = contextvars.ContextVar("transaction_id", default="-")
_event_id: contextvars.ContextVar[str] = contextvars.ContextVar("event_id", default="-")

LOG_FORMAT = (
    "[%(asctime)s] [%(levelname)s] [%(name)s] "
    "[corrId=%(correlation_id)s txId=%(transaction_id)s eventId=%(event_id)s] %(message)s"
)

_factory_installed = False


def _install_record_factory() -> None:
    global _factory_installed
    if _factory_installed:
        return
    base_factory = logging.getLogRecordFactory()

    def factory(*args, **kwargs):
        record = base_factory(*args, **kwargs)
        record.correlation_id = _correlation_id.get()
        record.transaction_id = _transaction_id.get()
        record.event_id = _event_id.get()
        return record

    logging.setLogRecordFactory(factory)
    _factory_installed = True


def configure_logging(level: int = logging.INFO) -> None:
    """Idempotente: instala el record factory y un handler de consola con el formato con contexto."""
    _install_record_factory()
    root = logging.getLogger()
    if not any(getattr(h, "_smartbancs_ctx", False) for h in root.handlers):
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter(LOG_FORMAT))
        handler._smartbancs_ctx = True  # type: ignore[attr-defined]
        root.addHandler(handler)
    root.setLevel(level)


@contextmanager
def event_context(
    correlation_id: Optional[str], transaction_id: Optional[str] = None, event_id: Optional[str] = None
) -> Iterator[None]:
    """Fija el contexto de trazabilidad mientras dura el procesamiento de un evento."""
    tokens = (
        _correlation_id.set(str(correlation_id) if correlation_id else "-"),
        _transaction_id.set(str(transaction_id) if transaction_id else "-"),
        _event_id.set(str(event_id) if event_id else "-"),
    )
    try:
        yield
    finally:
        _event_id.reset(tokens[2])
        _transaction_id.reset(tokens[1])
        _correlation_id.reset(tokens[0])


def current_correlation_id() -> str:
    return _correlation_id.get()
