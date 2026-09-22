import threading
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
from advisor import advisor, GEMINI_TIMEOUT_SECONDS, HEURISTIC_ENGINE, VALID_TYPES
from consumer import start_consumer, consumer_state, QUEUE_NAME, DLQ_NAME

SERVICE_VERSION = "2.5.0"

app = FastAPI(
    title="SmartBancs AI Financial Advisor Service",
    description="Microservicio de Inteligencia Artificial para recomendaciones financieras asíncronas",
    version=SERVICE_VERSION,
)

class TransactionInput(BaseModel):
    accountNumber: str
    amount: float
    category: str = "TRANSFER"
    currentBalance: float = 0.0
    transactionId: Optional[str] = None
    description: Optional[str] = "Transferencia"

@app.on_event("startup")
def startup_event():
    # Iniciar el consumidor de RabbitMQ en un hilo de fondo (daemon)
    consumer_thread = threading.Thread(target=start_consumer, daemon=True)
    consumer_thread.start()

@app.get("/health")
def health():
    consumer = consumer_state.snapshot()
    return {
        # DEGRADED si el hilo consumidor no está conectado a RabbitMQ
        "status": "UP" if consumer["connected"] else "DEGRADED",
        "service": "smartbancs-ai-service",
        "serviceVersion": SERVICE_VERSION,
        "modelVersion": advisor.model_version,
        "geminiApiKeyConfigured": bool(advisor.gemini_api_key),
        # Motor principal configurado; el que respondió cada inferencia va en metadata.engine
        "configuredPrimaryEngine": advisor.gemini_model if advisor.gemini_api_key else HEURISTIC_ENGINE,
        "totalInferences": advisor.total_inferences,
        "geminiInferences": advisor.gemini_success_count,
        "fallbackInferences": advisor.fallback_count,
        "consumer": consumer,
    }

@app.post("/predict-recommendation")
def predict_recommendation(tx: TransactionInput):
    """
    Endpoint directo síncrono para inferencia de recomendaciones bajo demanda.
    """
    try:
        recommendation = advisor.analyze_transaction(tx.dict())
        return {
            "success": True,
            "recommendation": recommendation,
            "engine": recommendation.get("engine"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/model-info")
def model_info():
    """
    Metadatos del modelo. Solo expone datos reales: contadores en memoria desde el arranque
    del proceso. El drift de datos NO se calcula en este servicio.
    """
    return {
        "modelName": advisor.model_name,
        "modelVersion": advisor.model_version,
        "serviceVersion": SERVICE_VERSION,
        "primaryEngine": advisor.gemini_model,
        "fallbackEngine": HEURISTIC_ENGINE,
        "geminiConfigured": bool(advisor.gemini_api_key),
        "geminiTimeoutSeconds": GEMINI_TIMEOUT_SECONDS,
        "supportedCategories": ["FOOD", "ENTERTAINMENT", "SERVICES", "SALARY", "SHOPPING", "TRANSFER"],
        "recommendationTypes": sorted(VALID_TYPES),
        # No hay cálculo de drift (PSI) implementado: no se reporta un estado inventado.
        "dataDriftStatus": "not_implemented",
        "dataDriftScore": None,
        # No existe umbral de confianza aplicado ni lote de entrenamiento (Gemini + reglas).
        "confidenceThreshold": None,
        "trainingBatchVersion": None,
        "totalInferencesProcessed": advisor.total_inferences,
        "geminiSuccessCount": advisor.gemini_success_count,
        "fallbackCount": advisor.fallback_count,
        "countersScope": "desde el arranque del proceso (en memoria)",
        "queue": QUEUE_NAME,
        "deadLetterQueue": DLQ_NAME,
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
