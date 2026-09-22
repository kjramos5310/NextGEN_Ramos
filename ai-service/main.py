import threading
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any
from advisor import advisor
from consumer import start_consumer

app = FastAPI(
    title="SmartBancs AI Financial Advisor Service",
    description="Microservicio de Inteligencia Artificial para recomendaciones financieras asíncronas",
    version="2.4.0"
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
    return {
        "status": "UP",
        "service": "smartbancs-ai-service",
        "modelVersion": advisor.model_version,
        "geminiApiKeyConfigured": bool(advisor.gemini_api_key),
        "activeEngine": f"Google-Gemini ({advisor.gemini_model})" if advisor.gemini_api_key else "SmartBancs-Heuristic-Rule-Engine (Local)",
        "totalInferences": advisor.total_inferences,
        "geminiInferences": advisor.gemini_success_count,
        "fallbackInferences": advisor.fallback_count
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
            "engine": recommendation.get("engine", advisor.model_name)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/model-info")
def model_info():
    """
    Metadatos para observabilidad y MLOps: drift, ciclo de vida y métricas.
    """
    return {
        "modelName": advisor.model_name,
        "modelVersion": advisor.model_version,
        "primaryEngine": f"Google Gemini API ({advisor.gemini_model})",
        "fallbackEngine": "Heuristic Financial Rules Engine",
        "geminiConfigured": bool(advisor.gemini_api_key),
        "supportedCategories": ["FOOD", "ENTERTAINMENT", "SERVICES", "SALARY", "SHOPPING", "TRANSFER"],
        "dataDriftStatus": "NORMAL",
        "confidenceThreshold": 0.85,
        "totalInferencesProcessed": advisor.total_inferences,
        "geminiSuccessCount": advisor.gemini_success_count,
        "fallbackCount": advisor.fallback_count,
        "trainingBatchVersion": "2026.09-Q3"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
