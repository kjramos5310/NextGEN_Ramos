import json
import logging
import os
import time
import pika
import requests
from advisor import advisor

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] [%(levelname)s] [AI-WORKER] %(message)s')
logger = logging.getLogger("AI-Worker")

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
BACKEND_API_URL = os.getenv("BACKEND_API_URL", "http://localhost:4000")
QUEUE_NAME = "smartbancs.ai.queue"

def process_transaction_event(ch, method, properties, body):
    try:
        raw_message = json.loads(body.decode("utf-8"))
        correlation_id = raw_message.get("correlationId", "N/A")
        tx_data = raw_message.get("data", {})

        logger.info(f"Received transaction event for account {tx_data.get('accountNumber')} (CorrID: {correlation_id})")

        # 1. Ejecutar inferencia del modelo
        start_time = time.time()
        recommendation = advisor.analyze_transaction(tx_data)
        inference_latency_ms = (time.time() - start_time) * 1000

        logger.info(f"AI Insight generated in {inference_latency_ms:.2f}ms: [{recommendation['type']}] {recommendation['title']}")

        # 2. Persistir recomendación en el Backend
        backend_endpoint = f"{BACKEND_API_URL}/api/v1/recommendations"
        headers = {"x-correlation-id": correlation_id, "Content-Type": "application/json"}
        
        resp = requests.post(backend_endpoint, json=recommendation, headers=headers, timeout=5)
        if resp.status_code in [200, 201]:
            logger.info(f"Recommendation successfully saved in backend for account {recommendation['accountNumber']}")
        else:
            logger.warning(f"Backend responded with status {resp.status_code}: {resp.text}")

        ch.basic_ack(delivery_tag=method.delivery_tag)
    except Exception as e:
        logger.error(f"Error processing AI message: {str(e)}", exc_info=True)
        # Ack to avoid poison message loops in test env
        ch.basic_ack(delivery_tag=method.delivery_tag)

def start_consumer():
    while True:
        try:
            logger.info(f"Connecting AI Consumer to RabbitMQ at {RABBITMQ_URL}...")
            params = pika.URLParameters(RABBITMQ_URL)
            connection = pika.BlockingConnection(params)
            channel = connection.channel()

            channel.queue_declare(queue=QUEUE_NAME, durable=True)
            channel.basic_qos(prefetch_count=5)
            channel.basic_consume(queue=QUEUE_NAME, on_message_callback=process_transaction_event)

            logger.info(f"AI Consumer listening on queue '{QUEUE_NAME}'...")
            channel.start_consuming()
        except Exception as e:
            logger.warning(f"RabbitMQ consumer connection error: {e}. Retrying in 5 seconds...")
            time.sleep(5)
