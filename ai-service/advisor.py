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
GEMINI_TIMEOUT_SECONDS = 10.0
HEURISTIC_ENGINE = "heuristic-fallback"
# Valores aceptados por el enum de PostgreSQL en ai_recommendations.type
VALID_TYPES = {"SPENDING_ALERT", "BUDGET_OPTIMIZATION", "INVESTMENT_OPPORTUNITY", "SAVINGS_ADVICE", "FRAUD_WARNING"}
MAX_TITLE_LENGTH = 150  # ai_recommendations.title VARCHAR(150)

class FinancialAdvisorModel:
    def __init__(self):
        self.model_version = "v2.5.0-gemini-hybrid"
        self.model_name = "SmartBancs-Gemini-Advisor"
        self.gemini_api_key = os.getenv("GEMINI_API_KEY", "").strip()
        self.gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
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
            score = float(parsed.get("confidenceScore", 0.95))
        except (TypeError, ValueError):
            score = 0.95
        parsed["confidenceScore"] = min(max(score, 0.0), 1.0)
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
            "'confidenceScore' (número decimal entre 0.0 y 1.0 indicando nivel de confianza), "
            "'metadata' (objeto con datos clave, e.g. suggestedAction, riskLevel: 'LOW'|'MEDIUM'|'HIGH')."
        )

        prompt = (
            f"Actúa como el Asesor Financiero Inteligente de SmartBancs. "
            f"Analiza esta transacción bancaria y responde EXCLUSIVAMENTE en JSON:\n"
            f"- Cuenta: {tx_data.get('accountNumber')}\n"
            f"- Monto: ${float(tx_data.get('amount', 0.0)):.2f}\n"
            f"- Categoría: {tx_data.get('category', 'TRANSFER')}\n"
            f"- Saldo actual disponible: ${float(tx_data.get('currentBalance', 0.0)):.2f}\n"
            f"- Descripción: {tx_data.get('description', 'N/A')}\n\n"
            f"Formato JSON requerido:\n"
            f"{{\n"
            f'  "type": "SPENDING_ALERT" | "BUDGET_OPTIMIZATION" | "INVESTMENT_OPPORTUNITY" | "SAVINGS_ADVICE" | "FRAUD_WARNING",\n'
            f'  "title": "título profesional en español",\n'
            f'  "message": "consejo accionable contextualizado con saldo y porcentaje",\n'
            f'  "confidenceScore": 0.95,\n'
            f'  "metadata": {{"riskLevel": "LOW" | "MEDIUM" | "HIGH"}}\n'
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
                "maxOutputTokens": 800,
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
                logger.warning(f"[GEMINI-API] Error de API Gemini HTTP {response.status_code} en {latency_ms:.0f} ms: {response.text[:200]}. Aplicando fallback a reglas locales.")
        except requests.exceptions.Timeout:
            logger.warning(f"[GEMINI-API] Timeout en llamada a Gemini (> {GEMINI_TIMEOUT_SECONDS:.0f} s). Aplicando fallback a reglas locales.")
        except Exception as ex:
            logger.error(f"[GEMINI-API] Excepción al invocar Gemini ({type(ex).__name__}): {str(ex)[:200]}. Aplicando fallback a reglas locales.")

        return None

    def _heuristic_rule_fallback(self, tx_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Motor heurístico local (fallback resiliente).
        Reglas deterministas sin llamadas de red; se usa cuando no hay API key
        o cuando Gemini falla (timeout, error HTTP o respuesta inválida).
        """
        amount = float(tx_data.get("amount", 0.0))
        category = str(tx_data.get("category", "TRANSFER")).upper()
        current_balance = float(tx_data.get("currentBalance", 0.0))
        account_number = str(tx_data.get("accountNumber", "UNKNOWN"))
        tx_id = tx_data.get("transactionId")

        if category == "FOOD" and amount > 80.0:
            return {
                "accountNumber": account_number,
                "transactionId": tx_id,
                "type": "SPENDING_ALERT",
                "title": "Alerta de Consumo en Alimentación",
                "message": f"Tu gasto de ${amount:.2f} en alimentación supera el 15% del promedio recomendado para esta semana.",
                "confidenceScore": 0.945,
                "engine": HEURISTIC_ENGINE,
                "metadata": {"category": category, "amount": amount, "thresholdExceeded": True, "riskLevel": "MEDIUM"}
            }

        elif category == "ENTERTAINMENT" and amount > 100.0:
            return {
                "accountNumber": account_number,
                "transactionId": tx_id,
                "type": "BUDGET_OPTIMIZATION",
                "title": "Optimización de Presupuesto en Entretenimiento",
                "message": f"Consumo recreativo de ${amount:.2f} detectado. Mantener este gasto controlado te permitirá ahorrar hasta $150 al mes.",
                "confidenceScore": 0.912,
                "engine": HEURISTIC_ENGINE,
                "metadata": {"category": category, "suggestedMonthlySaving": 150.0, "riskLevel": "LOW"}
            }

        elif category == "SALARY" or amount >= 1500.0:
            return {
                "accountNumber": account_number,
                "transactionId": tx_id,
                "type": "INVESTMENT_OPPORTUNITY",
                "title": "Oportunidad de Inversión Automatizada",
                "message": f"Con el ingreso reciente de ${amount:.2f}, puedes rentabilizar tu liquidez en un fondo a plazo fijo SmartBancs con tasa 9.5% E.A.",
                "confidenceScore": 0.978,
                "engine": HEURISTIC_ENGINE,
                "metadata": {"suggestedProduct": "CDT_DIGITAL", "projectedYield": "9.5% EA", "riskLevel": "LOW"}
            }

        elif current_balance > 5000.0 and amount < 50.0:
            return {
                "accountNumber": account_number,
                "transactionId": tx_id,
                "type": "SAVINGS_ADVICE",
                "title": "Regla de Ahorro Automático Activada",
                "message": f"Tu saldo actual es de ${current_balance:.2f}. Te sugerimos apartar el 10% en tu alcancía digital para emergencias.",
                "confidenceScore": 0.962,
                "engine": HEURISTIC_ENGINE,
                "metadata": {"recommendedSavings": current_balance * 0.10, "riskLevel": "LOW"}
            }

        elif amount > 5000.0:
            return {
                "accountNumber": account_number,
                "transactionId": tx_id,
                "type": "FRAUD_WARNING",
                "title": "Monitoreo de Seguridad Transaccional",
                "message": f"Transacción de alto monto (${amount:.2f}) procesada exitosamente. Si no reconoces esta operación, bloquea tu cuenta de inmediato.",
                "confidenceScore": 0.991,
                "engine": HEURISTIC_ENGINE,
                "metadata": {"highValueFlag": True, "riskLevel": "HIGH"}
            }

        else:
            return {
                "accountNumber": account_number,
                "transactionId": tx_id,
                "type": "SAVINGS_ADVICE",
                "title": "Finanzas Inteligentes SmartBancs",
                "message": f"Transacción de ${amount:.2f} registrada correctamente. Continúas dentro de tu meta mensual de gastos.",
                "confidenceScore": 0.885,
                "engine": HEURISTIC_ENGINE,
                "metadata": {"status": "ON_TRACK", "riskLevel": "LOW"}
            }

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
