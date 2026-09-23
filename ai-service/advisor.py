import json
import logging
import os
import re
import threading
import time
from typing import Dict, Any, Optional
import requests
from dotenv import load_dotenv

from log_context import configure_logging

# Cargar variables de entorno desde .env o el directorio raíz
load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

configure_logging()
logger = logging.getLogger("AI-Advisor")

# Timeout real de la llamada HTTP a Gemini (segundos). Los mensajes de log lo citan desde aquí.
# La inferencia es asíncrona (fuera del camino crítico de la transferencia): se tolera más latencia
GEMINI_TIMEOUT_SECONDS = float(os.getenv("GEMINI_TIMEOUT_SECONDS", "30"))

# Umbrales del motor de reglas (fallback). Son parámetros de negocio explícitos, no aprendidos.
HIGH_VALUE_THRESHOLD = 5000.0          # USD: monto que se trata como alerta de seguridad
HIGH_SHARE_THRESHOLD = 0.30            # la transacción consume >= 30 % del saldo previo
DISCRETIONARY_SHARE_THRESHOLD = 0.10   # gasto discrecional >= 10 % del saldo previo
# Por debajo de este valor la recomendación se marca como "requiere confirmación del cliente"
LOW_CONFIDENCE_THRESHOLD = 0.6
# Si el modelo no informa confianza no se asume una alta
LOW_CONFIDENCE_DEFAULT = 0.5
RULE_CONFIDENCE = 0.5                  # valor fijo para reglas: no es una probabilidad calibrada
CATEGORY_ES = {"FOOD": "alimentación", "ENTERTAINMENT": "entretenimiento", "SHOPPING": "compras"}
HEURISTIC_ENGINE = "heuristic-fallback"
# Valores aceptados por el enum de PostgreSQL en ai_recommendations.type
VALID_TYPES = {"SPENDING_ALERT", "BUDGET_OPTIMIZATION", "INVESTMENT_OPPORTUNITY", "SAVINGS_ADVICE", "FRAUD_WARNING"}
MAX_TITLE_LENGTH = 150  # ai_recommendations.title VARCHAR(150)

class FinancialAdvisorModel:
    def __init__(self):
        self.model_version = "v2.5.0-gemini-hybrid"
        self.model_name = "SmartBancs-Gemini-Advisor"
        self.gemini_api_key = os.getenv("GEMINI_API_KEY", "").strip()
        self.gemini_model = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
        self.total_inferences = 0
        self.gemini_success_count = 0
        self.fallback_count = 0
        self._counters_lock = threading.Lock()

        if self.gemini_api_key:
            logger.info(f"[AI-INIT] Gemini API Key detectada. Motor principal activo: {self.gemini_model}")
        else:
            logger.warning("[AI-INIT] No se detectó GEMINI_API_KEY. Operando en modo motor heurístico local (Zero-Quota Fallback).")

    def _clean_and_parse_json(self, raw_text: str) -> Optional[Dict[str, Any]]:
        """
        Parser Resiliente de Doble Capa (Self-Healing JSON):
        Capa 1: Remueve delimitadores markdown ```json ... ```
        Capa 2: Si falla JSON.parse(), aísla el primer bloque {...} mediante RegEx.
        """
        if not raw_text:
            return None

        # Capa 1: Limpieza de bloques de código markdown
        cleaned = re.sub(r'```(?:json)?', '', raw_text).strip('` \n\r\t')
        try:
            return json.loads(cleaned)
        except Exception:
            pass

        # Capa 2: Extracción regex de objeto JSON balanceado
        match = re.search(r'\{[\s\S]*\}', raw_text)
        if match:
            try:
                return json.loads(match.group(0))
            except Exception as e:
                logger.warning(f"[SELF-HEALING-JSON] Falló extracción regex de JSON: {e}")

        return None

    def _validate_gemini_result(self, parsed: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Garantiza que la respuesta de Gemini cumple el contrato del backend
        (enum de type, title <= 150, message no vacío, confidenceScore en [0,1]).
        Si no lo cumple devuelve None y se usa el motor heurístico."""
        rec_type = parsed.get("type")
        if rec_type not in VALID_TYPES:
            logger.warning(f"[GEMINI-API] type inválido '{str(rec_type)[:40]}'. Aplicando fallback a reglas locales.")
            return None
        message = parsed.get("message")
        if not isinstance(message, str) or not message.strip():
            logger.warning("[GEMINI-API] message vacío o no textual. Aplicando fallback a reglas locales.")
            return None
        title = parsed.get("title")
        if not isinstance(title, str) or not title.strip():
            title = "Recomendación SmartBancs"
        parsed["title"] = title.strip()[:MAX_TITLE_LENGTH]
        try:
            score = float(parsed.get("confidenceScore", LOW_CONFIDENCE_DEFAULT))
        except (TypeError, ValueError):
            score = LOW_CONFIDENCE_DEFAULT
        parsed["confidenceScore"] = min(max(score, 0.0), 1.0)
        # Confianza baja = el modelo no logró interpretar la operación: se trata como transacción
        # atípica que el cliente debe confirmar (el envío de la notificación es diseño, ver docs)
        meta = parsed.get("metadata") if isinstance(parsed.get("metadata"), dict) else {}
        meta["needsClientConfirmation"] = parsed["confidenceScore"] < LOW_CONFIDENCE_THRESHOLD
        parsed["metadata"] = meta
        if not isinstance(parsed.get("metadata"), dict):
            parsed["metadata"] = {}
        return parsed

    def _call_gemini_api(self, tx_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Invoca la API oficial de Google Gemini usando la API Key configurada.
        Forzando respuesta en JSON estructurado.
        """
        if not self.gemini_api_key:
            return None

        # La API key va en el header x-goog-api-key y no en la URL, para que no quede en logs de proxies ni trazas
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.gemini_model}:generateContent"
        
        system_instruction = (
            "Eres el Asesor Financiero Inteligente y Motor de Detección de Riesgo de SmartBancs. "
            "Tu tarea es evaluar la transacción bancaria del cliente y retornar EXCLUSIVAMENTE un objeto JSON válido con los campos: "
            "'type' (uno de: 'SPENDING_ALERT', 'BUDGET_OPTIMIZATION', 'INVESTMENT_OPPORTUNITY', 'SAVINGS_ADVICE', 'FRAUD_WARNING'), "
            "'title' (título corto profesional en español), "
            "'message' (consejo financiero accionable o alerta clara en español, máximo 2 oraciones), "
            "'confidenceScore' (número entre 0.0 y 1.0), "
            "'metadata' (objeto con riskLevel: 'LOW'|'MEDIUM'|'HIGH' y confidenceReason: una frase). "
            "confidenceScore mide qué tan seguro estás de haber interpretado correctamente la transacción, "
            "no la calidad del consejo. Criterios: "
            "0.85 a 1.0 si el monto es coherente con la categoría y la descripción es clara; "
            "0.6 a 0.85 si los datos son coherentes pero con poco contexto (descripción genérica); "
            "menos de 0.6 si los datos son ambiguos o contradictorios: monto desproporcionado para la categoría "
            "(por ejemplo más de $1,000 en alimentación o entretenimiento), monto alto con descripción vacía o genérica, "
            "o una transacción que consume más del 50% del saldo previo. "
            "Cuando la confianza sea menor a 0.6, usa type 'FRAUD_WARNING' o 'SPENDING_ALERT' y escribe un message "
            "que pida al cliente confirmar si reconoce la operación. No inventes promedios, tasas ni metas."
        )

        prompt = (
            f"Actúa como el Asesor Financiero Inteligente de SmartBancs. "
            f"Analiza esta transacción bancaria y responde EXCLUSIVAMENTE en JSON:\n"
            f"- Cuenta: {tx_data.get('accountNumber')}\n"
            f"- Monto: ${float(tx_data.get('amount', 0.0)):.2f}\n"
            f"- Categoría: {tx_data.get('category', 'TRANSFER')}\n"
            f"- Saldo disponible tras la transacción: ${float(tx_data.get('currentBalance', 0.0)):.2f}\n"
            f"- Saldo previo: ${float(tx_data.get('currentBalance', 0.0)) + float(tx_data.get('amount', 0.0)):.2f}\n"
            f"- Descripción: {tx_data.get('description', 'N/A')}\n\n"
            f"Formato JSON requerido:\n"
            f"{{\n"
            f'  "type": "SPENDING_ALERT" | "BUDGET_OPTIMIZATION" | "INVESTMENT_OPPORTUNITY" | "SAVINGS_ADVICE" | "FRAUD_WARNING",\n'
            f'  "title": "título profesional en español",\n'
            f'  "message": "consejo accionable contextualizado con saldo y porcentaje",\n'
            f'  "confidenceScore": <número entre 0 y 1 según los criterios>,\n'
            f'  "metadata": {{"riskLevel": "LOW" | "MEDIUM" | "HIGH", "confidenceReason": "una frase"}}\n'
            f"}}"
        )

        payload = {
            "systemInstruction": {"parts": [{"text": system_instruction}]},
            "contents": [
                {
                    "parts": [
                        {"text": prompt}
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 2048,
                "responseMimeType": "application/json",
                "thinkingConfig": {
                    "thinkingBudget": 0
                }
            }
        }

        headers = {"Content-Type": "application/json", "x-goog-api-key": self.gemini_api_key}
        
        try:
            started = time.time()
            response = requests.post(url, json=payload, headers=headers, timeout=GEMINI_TIMEOUT_SECONDS)
            # thinkingConfig no es aceptado igual por todas las versiones de modelo: si la API lo rechaza,
            # se reintenta una vez sin él en lugar de caer directo al motor heurístico
            if response.status_code == 400 and "thinking" in response.text.lower():
                logger.warning("[GEMINI-API] El modelo rechazó thinkingConfig; reintentando sin él.")
                payload["generationConfig"].pop("thinkingConfig", None)
                response = requests.post(url, json=payload, headers=headers, timeout=GEMINI_TIMEOUT_SECONDS)
            latency_ms = (time.time() - started) * 1000
            if response.status_code == 200:
                resp_json = response.json()
                candidates = resp_json.get("candidates", [])
                if candidates:
                    content_parts = candidates[0].get("content", {}).get("parts", [])
                    if content_parts:
                        raw_text = content_parts[0].get("text", "")
                        parsed = self._clean_and_parse_json(raw_text)
                        if isinstance(parsed, dict):
                            parsed = self._validate_gemini_result(parsed)
                            if parsed is None:
                                return None
                            parsed["accountNumber"] = str(tx_data.get("accountNumber"))
                            parsed["transactionId"] = tx_data.get("transactionId")
                            parsed["engine"] = self.gemini_model
                            logger.info(f"[GEMINI-API] OK {self.gemini_model} en {latency_ms:.0f} ms")
                            return parsed
                logger.warning(f"[GEMINI-API] Respuesta 200 sin JSON válido en {latency_ms:.0f} ms. Aplicando fallback a reglas locales.")
            elif response.status_code == 429:
                logger.warning(f"[GEMINI-API] Cuota excedida (HTTP 429 Rate Limit) en {latency_ms:.0f} ms. Aplicando fallback a reglas locales.")
            else:
                logger.warning(f"[GEMINI-API] Error de API Gemini HTTP {response.status_code} en {latency_ms:.0f} ms: {response.text[:600]}. Aplicando fallback a reglas locales.")
        except requests.exceptions.Timeout:
            logger.warning(f"[GEMINI-API] Timeout en llamada a Gemini (> {GEMINI_TIMEOUT_SECONDS:.0f} s). Aplicando fallback a reglas locales.")
        except Exception as ex:
            logger.error(f"[GEMINI-API] Excepción al invocar Gemini ({type(ex).__name__}): {str(ex)[:200]}. Aplicando fallback a reglas locales.")

        return None

    def _heuristic_rule_fallback(self, tx_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Motor heurístico local (fallback): reglas deterministas, sin red.
        Se usa cuando no hay API key o cuando Gemini falla (timeout, error HTTP o respuesta inválida).

        Solo afirma hechos calculados con los datos de la transacción (monto, categoría, saldo).
        No inventa promedios, tasas ni metas. confidenceScore es un valor fijo para reglas:
        no es una probabilidad calibrada. metadata.rule indica qué regla se aplicó.
        """
        amount = float(tx_data.get("amount", 0.0))
        category = str(tx_data.get("category", "TRANSFER")).upper()
        balance_after = float(tx_data.get("currentBalance", 0.0))  # saldo tras el débito
        balance_before = balance_after + amount
        share = (amount / balance_before) if balance_before > 0 else 1.0
        pct = share * 100

        def rec(rule: str, rtype: str, title: str, message: str, risk: str) -> Dict[str, Any]:
            return {
                "accountNumber": str(tx_data.get("accountNumber", "UNKNOWN")),
                "transactionId": tx_data.get("transactionId"),
                "type": rtype,
                "title": title,
                "message": message,
                "confidenceScore": RULE_CONFIDENCE,
                "engine": HEURISTIC_ENGINE,
                "metadata": {
                    "rule": rule,
                    "category": category,
                    "amount": round(amount, 2),
                    "shareOfBalance": round(share, 4),
                    "riskLevel": risk,
                    # Solo la regla de alto monto pide confirmación al cliente
                    "needsClientConfirmation": rule == "HIGH_VALUE",
                },
            }

        # El orden importa: primero la regla de mayor riesgo
        if amount >= HIGH_VALUE_THRESHOLD:
            return rec("HIGH_VALUE", "FRAUD_WARNING", "Transacción de alto monto",
                       f"Se registró una transferencia de ${amount:,.2f} ({pct:.0f}% de tu saldo previo). "
                       "Si no reconoces esta operación, contacta al banco de inmediato.", "HIGH")

        if share >= HIGH_SHARE_THRESHOLD:
            return rec("HIGH_SHARE_OF_BALANCE", "SPENDING_ALERT", "Gasto alto respecto a tu saldo",
                       f"Esta transacción de ${amount:,.2f} representa el {pct:.0f}% de tu saldo previo. "
                       f"Tu saldo disponible ahora es ${balance_after:,.2f}.", "MEDIUM")

        if category == "SALARY":
            return rec("SALARY_RECEIVED", "INVESTMENT_OPPORTUNITY", "Movimiento de nómina",
                       f"Se registró un movimiento de nómina de ${amount:,.2f}. "
                       "Considera separar una parte para ahorro antes de planificar tus gastos.", "LOW")

        if category in ("FOOD", "ENTERTAINMENT", "SHOPPING") and share >= DISCRETIONARY_SHARE_THRESHOLD:
            return rec("DISCRETIONARY_SPEND", "BUDGET_OPTIMIZATION", "Gasto discrecional relevante",
                       f"Gasto de ${amount:,.2f} en {CATEGORY_ES.get(category, category.lower())}, el {pct:.0f}% de tu saldo previo. "
                       "Revisa si está dentro de tu presupuesto del mes.", "LOW")

        return rec("DEFAULT", "SAVINGS_ADVICE", "Transacción registrada",
                   f"Transacción de ${amount:,.2f} registrada ({pct:.1f}% de tu saldo previo). "
                   f"Saldo disponible: ${balance_after:,.2f}.", "LOW")

    def analyze_transaction(self, tx_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Flujo de inferencia híbrido:
        1. Intenta invocar la API de Google Gemini con GEMINI_API_KEY.
        2. Aplica Self-Healing JSON parser.
        3. Si no hay API Key o falla la llamada, conmuta automáticamente al motor heurístico.
        """
        with self._counters_lock:
            self.total_inferences += 1

        # 1. Intentar con Gemini
        if self.gemini_api_key:
            gemini_result = self._call_gemini_api(tx_data)
            if gemini_result:
                with self._counters_lock:
                    self.gemini_success_count += 1
                return gemini_result
        else:
            logger.info("[AI-INFERENCE] Sin GEMINI_API_KEY: usando motor heurístico local.")

        # 2. Fallback heurístico
        with self._counters_lock:
            self.fallback_count += 1
        result = self._heuristic_rule_fallback(tx_data)
        logger.info(f"[AI-INFERENCE] Recomendación generada por {HEURISTIC_ENGINE}: [{result['type']}]")
        return result

advisor = FinancialAdvisorModel()
