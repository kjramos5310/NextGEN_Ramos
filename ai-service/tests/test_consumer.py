import json
import logging
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
import requests

import consumer
from advisor import advisor

CORR_ID = "corr-test-123"
TX_ID = "tx-0001"
EVENT_ID = "evt-42"


def make_body(**overrides):
    data = {
        "eventId": EVENT_ID,
        "transactionId": TX_ID,
        "accountNumber": "1000000001",
        "amount": 180.0,
        "category": "FOOD",
        "currentBalance": 850.0,
    }
    data.update(overrides)
    return json.dumps({"correlationId": CORR_ID, "timestamp": "2026-09-22T00:00:00Z", "data": data}).encode()


def resp(status, text=""):
    return SimpleNamespace(status_code=status, text=text)


@pytest.fixture
def channel():
    return MagicMock()


@pytest.fixture
def method():
    return SimpleNamespace(delivery_tag=7, redelivered=False)


@pytest.fixture
def props():
    return SimpleNamespace(correlation_id=CORR_ID)


@pytest.fixture
def sleeps(monkeypatch):
    calls = []
    monkeypatch.setattr(consumer.time, "sleep", lambda s: calls.append(s))
    return calls


@pytest.fixture
def post(monkeypatch):
    mock = MagicMock()
    monkeypatch.setattr(consumer.requests, "post", mock)
    return mock


def test_no_gemini_key_in_tests():
    assert advisor.gemini_api_key == ""


def test_2xx_acks(channel, method, props, post, sleeps):
    post.return_value = resp(201)
    consumer.process_transaction_event(channel, method, props, make_body())
    channel.basic_ack.assert_called_once_with(delivery_tag=7)
    channel.basic_nack.assert_not_called()
    assert post.call_count == 1
    assert sleeps == []


def test_409_duplicate_acks(channel, method, props, post, sleeps):
    post.return_value = resp(409, "duplicate")
    consumer.process_transaction_event(channel, method, props, make_body())
    channel.basic_ack.assert_called_once_with(delivery_tag=7)
    channel.basic_nack.assert_not_called()


def test_503_twice_then_201_acks_after_retries(channel, method, props, post, sleeps, caplog):
    post.side_effect = [resp(503), resp(503), resp(201)]
    with caplog.at_level(logging.INFO):
        consumer.process_transaction_event(channel, method, props, make_body())
    assert post.call_count == 3
    assert sleeps == [0.5, 1.0]
    channel.basic_ack.assert_called_once_with(delivery_tag=7)
    channel.basic_nack.assert_not_called()
    retries = [r for r in caplog.records if "Reintentando" in r.getMessage()]
    assert len(retries) == 2


def test_three_transient_failures_nack_to_dlq(channel, method, props, post, sleeps, caplog):
    post.side_effect = [requests.exceptions.Timeout(), requests.exceptions.ConnectionError("down"), resp(500)]
    with caplog.at_level(logging.INFO):
        consumer.process_transaction_event(channel, method, props, make_body())
    assert post.call_count == 3
    channel.basic_nack.assert_called_once_with(delivery_tag=7, requeue=False)
    channel.basic_ack.assert_not_called()
    assert any("[DLQ]" in r.getMessage() for r in caplog.records)


def test_4xx_nacks_without_retry(channel, method, props, post, sleeps):
    post.return_value = resp(400, "bad request")
    consumer.process_transaction_event(channel, method, props, make_body())
    assert post.call_count == 1
    assert sleeps == []
    channel.basic_nack.assert_called_once_with(delivery_tag=7, requeue=False)
    channel.basic_ack.assert_not_called()


@pytest.mark.parametrize("body", [b"{not json", b"\xff\xfe", b"[1,2]", b'{"correlationId":"x"}'])
def test_invalid_message_nacks_to_dlq(channel, method, props, post, body):
    consumer.process_transaction_event(channel, method, props, body)
    channel.basic_nack.assert_called_once_with(delivery_tag=7, requeue=False)
    channel.basic_ack.assert_not_called()
    post.assert_not_called()


def test_post_payload_has_metadata_and_correlation_header(channel, method, props, post, sleeps):
    post.return_value = resp(201)
    consumer.process_transaction_event(channel, method, props, make_body())
    _, kwargs = post.call_args
    assert post.call_args[0][0] == "http://backend.test/api/v1/recommendations"
    assert kwargs["headers"]["x-correlation-id"] == CORR_ID
    payload = kwargs["json"]
    meta = payload["metadata"]
    assert isinstance(meta["inferenceLatencyMs"], (int, float)) and meta["inferenceLatencyMs"] >= 0
    assert meta["engine"] == "heuristic-fallback"
    assert meta["eventId"] == EVENT_ID
    assert payload["transactionId"] == TX_ID
    assert "engine" not in payload  # solo en metadata


def test_all_event_logs_carry_correlation_and_transaction_id(channel, method, props, post, sleeps, caplog):
    post.side_effect = [resp(503), resp(201)]
    with caplog.at_level(logging.INFO):
        consumer.process_transaction_event(channel, method, props, make_body())
    records = [r for r in caplog.records if r.name in ("AI-Worker", "AI-Advisor")]
    assert len(records) >= 4  # recibido, inferencia (advisor + consumer), reintento, POST OK
    for r in records:
        assert r.correlation_id == CORR_ID
        assert r.transaction_id == TX_ID
        assert r.event_id == EVENT_ID
    # El contexto no se filtra fuera del procesamiento del evento
    logging.getLogger("AI-Worker").info("fuera")
    assert caplog.records[-1].correlation_id == "-"


def test_topology_matches_backend_contract():
    ch = MagicMock()
    consumer.declare_topology(ch)
    ch.exchange_declare.assert_called_once_with(exchange="smartbancs.dlx", exchange_type="direct", durable=True)
    ch.queue_bind.assert_called_once_with(queue="smartbancs.ai.dlq", exchange="smartbancs.dlx", routing_key="smartbancs.ai.dlq")
    ch.queue_declare.assert_any_call(queue="smartbancs.ai.dlq", durable=True)
    ch.queue_declare.assert_any_call(
        queue="smartbancs.ai.queue",
        durable=True,
        arguments={"x-dead-letter-exchange": "smartbancs.dlx", "x-dead-letter-routing-key": "smartbancs.ai.dlq"},
    )


def test_gemini_invalid_type_falls_back(monkeypatch):
    monkeypatch.setattr(advisor, "gemini_api_key", "dummy")
    gemini_resp = MagicMock(status_code=200)
    gemini_resp.json.return_value = {
        "candidates": [{"content": {"parts": [{"text": json.dumps({"type": "UNKNOWN", "title": "t", "message": "m"})}]}}]
    }
    import advisor as advisor_module
    monkeypatch.setattr(advisor_module.requests, "post", MagicMock(return_value=gemini_resp))
    rec = advisor.analyze_transaction({"accountNumber": "1", "amount": 10, "transactionId": "t1"})
    assert rec["engine"] == "heuristic-fallback"


def test_gemini_timeout_falls_back(monkeypatch, caplog):
    monkeypatch.setattr(advisor, "gemini_api_key", "dummy-secret-key")
    import advisor as advisor_module
    monkeypatch.setattr(advisor_module.requests, "post", MagicMock(side_effect=requests.exceptions.Timeout()))
    with caplog.at_level(logging.INFO):
        rec = advisor.analyze_transaction({"accountNumber": "1", "amount": 10})
    assert rec["engine"] == "heuristic-fallback"
    from advisor import GEMINI_TIMEOUT_SECONDS
    assert any(f"> {GEMINI_TIMEOUT_SECONDS:.0f} s" in r.getMessage() for r in caplog.records)
    assert not any("dummy-secret-key" in r.getMessage() for r in caplog.records)


def test_model_info_is_truthful():
    from fastapi.testclient import TestClient
    import main
    client = TestClient(main.app)  # sin context manager: no arranca el hilo consumidor
    info = client.get("/model-info").json()
    assert "dataDriftStatus" not in info  # no se reportan métricas de un modelo entrenado que no existe
    assert info["modelVersion"] == advisor.model_version
    from advisor import GEMINI_TIMEOUT_SECONDS
    assert info["geminiTimeoutSeconds"] == GEMINI_TIMEOUT_SECONDS
    health = client.get("/health").json()
    assert health["status"] == "DEGRADED"  # consumidor no conectado en la prueba
    assert health["totalInferences"] == advisor.total_inferences
