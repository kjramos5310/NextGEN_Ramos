"""Confianza baja: la recomendación se marca como operación a confirmar por el cliente."""
from advisor import advisor, LOW_CONFIDENCE_THRESHOLD


def _gemini(score=None, **meta):
    parsed = {"type": "SPENDING_ALERT", "title": "t", "message": "m", "metadata": dict(meta)}
    if score is not None:
        parsed["confidenceScore"] = score
    return advisor._validate_gemini_result(parsed)


def test_confianza_baja_requiere_confirmacion():
    r = _gemini(0.4, confidenceReason="Monto desproporcionado para alimentación")
    assert r["metadata"]["needsClientConfirmation"] is True
    assert r["metadata"]["confidenceReason"].startswith("Monto")


def test_confianza_alta_no_requiere_confirmacion():
    assert _gemini(0.9)["metadata"]["needsClientConfirmation"] is False


def test_sin_confianza_no_se_asume_alta():
    r = _gemini(None)
    assert r["confidenceScore"] < LOW_CONFIDENCE_THRESHOLD
    assert r["metadata"]["needsClientConfirmation"] is True


def test_reglas_alto_monto_piden_confirmacion():
    r = advisor._heuristic_rule_fallback(
        {"amount": 7000, "category": "TRANSFER", "currentBalance": 20000, "accountNumber": "1", "transactionId": "x"}
    )
    assert r["metadata"]["needsClientConfirmation"] is True
    r = advisor._heuristic_rule_fallback(
        {"amount": 20, "category": "OTHER", "currentBalance": 8000, "accountNumber": "1", "transactionId": "y"}
    )
    assert r["metadata"]["needsClientConfirmation"] is False
