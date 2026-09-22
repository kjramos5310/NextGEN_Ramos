"""Verifica que la API key de Gemini funciona con el modelo configurado.

Uso (desde la raíz del repo, con GEMINI_API_KEY y GEMINI_MODEL en .env):
    python ai-service/scripts/check_gemini.py

Hace una inferencia real con una transacción de ejemplo usando el mismo código
del servicio (advisor.py) e indica si respondió Gemini o el motor heurístico.
Nunca imprime la API key.
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

from advisor import advisor  # noqa: E402

if not advisor.gemini_api_key:
    sys.exit("GEMINI_API_KEY no está definida en .env")

print(f"Modelo: {advisor.gemini_model} | key configurada ({len(advisor.gemini_api_key)} caracteres)")
tx = {
    "transactionId": "check-gemini",
    "accountNumber": "1000000001",
    "amount": 180.0,
    "category": "FOOD",
    "currentBalance": 850.0,
    "description": "Consumo restaurante",
}
start = time.time()
result = advisor._call_gemini_api(tx)
ms = (time.time() - start) * 1000

if result:
    print(f"OK: respondió Gemini en {ms:.0f} ms")
    print(f"  engine={result.get('engine')} type={result.get('type')}")
    print(f"  title={result.get('title')}")
    print(f"  message={result.get('message')}")
else:
    sys.exit(f"FALLO: Gemini no respondió ({ms:.0f} ms). Revisa el log [GEMINI-API] de arriba.")
