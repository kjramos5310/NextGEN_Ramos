# 🎬 Guion Oficial de Presentación y Video Demostrativo (3 Minutos)
## Reto Técnico TCS NextGen Engineer — SmartBancs App

> **Objetivo:** Exponer la solución completa de forma fluida, técnica y convincente en **exactamente 3 minutos (180 segundos)**, cubriendo los 6 pilares de evaluación exigidos por TCS: Arquitectura, Transaccionalidad ACID, Integración Bancs/ETL, Inteligencia Artificial Asíncrona, Observabilidad y Simulación del Incidente de Quincena.

---

### ⏱️ Estructura Cronológica del Video (3:00 Minutos)

| Bloque | Tiempo | Pantalla a Mostrar | Tema Central |
| :---: | :---: | :--- | :--- |
| **1** | **00:00 – 00:30** (30s) | Arquitectura / Diagrama en README o Docker Compose | Introducción, Caso de Negocio y Justificación del Stack |
| **2** | **00:30 – 01:15** (45s) | [http://localhost:3000](http://localhost:3000) (Cuentas & Transferencia) | Transaccionalidad ACID, SLA &lt; 2s y Despacho Asíncrono a IA |
| **3** | **01:15 – 01:55** (40s) | Pestaña "Integración Core Bancs" + Terminal ETL | Estrategia Bancs (Outbox/CDC) y Pipeline ETL Python |
| **4** | **01:55 – 02:35** (40s) | Pestaña "Simulación de Quincena" + Grafana / Logs | Incidente Crítico, Prevención de Deadlocks y Observabilidad |
| **5** | **02:35 – 03:00** (25s) | Pestaña "Análisis Cognitivo (Gemini)" + Cierre | MLOps, Gemini 3.6 Flash en Vivo, Post-Mortem y Despedida |

---

## 🎙️ Guion Detallado: Palabra por Palabra

---

### 🔹 BLOQUE 1: Introducción y Arquitectura General (00:00 – 00:30)
* **Qué proyectar en pantalla:** Mostrar el diagrama de arquitectura en el [README.md](file:///d:/proyectos/pruebaTecnicaTCS/README.md) o la terminal con `docker compose ps` mostrando los 7 microservicios activos.
* **Lo que dices (Speech):**

> *"Buenas tardes al comité técnico de TCS. Mi nombre es [Tu Nombre] y presento la solución para el reto **SmartBancs App**, una plataforma bancaria moderna, resiliente y de alta concurrencia.*
> 
> *Para este reto seleccioné una arquitectura de microservicios contenerizada con Docker Compose: **NestJS** en el backend core por su tipado estricto y modelo no-bloqueante; **PostgreSQL 16** como motor transaccional ACID; **RabbitMQ** como bus de eventos; **FastAPI con Google Gemini 3.6 Flash** para la inteligencia artificial; **React con Vite** en el cliente; y una suite de observabilidad completa con **Prometheus y Grafana**.*
> 
> *Todo el stack responde a un SLA crítico: procesar transferencias en menos de 2 segundos sin comprometer la consistencia bancaria."*

---

### 🔹 BLOQUE 2: Transaccionalidad ACID y Desacoplamiento de IA (00:30 – 01:15)
* **Qué proyectar en pantalla:** Ir a [http://localhost:3000](http://localhost:3000), mostrar las cuentas, abrir el modal de **Emitir Transferencia**, ingresar una transferencia de `$180.00` en categoría `FOOD` y hacer clic en **Confirmar**.
* **Lo que dices (Speech):**

> *"Veamos la transaccionalidad en vivo. Aquí tenemos nuestras cuentas activas con saldos auditados. Voy a emitir una transferencia de 180 dólares entre la cuenta 1001 y la 1002.*
> 
> *Al confirmar, observen la velocidad: la transacción se ejecutó en **menos de 30 milisegundos**. ¿Cómo lo logramos? Implementamos **bloqueo pesimista exclusivo a nivel de fila (`SELECT ... FOR UPDATE`)**, garantizando el aislamiento `READ COMMITTED` y protegiendo contra saldos negativos o condiciones de carrera.*
> 
> *Y lo más importante para el SLA: el análisis cognitivo de Inteligencia Artificial **no bloquea** la respuesta HTTP del usuario. La API confirma la transacción en base de datos, emite un evento asíncrono a RabbitMQ y devuelve de inmediato el código 201 Created junto a su **Correlation ID**."*

---

### 🔹 BLOQUE 3: Integración Core Bancs y Pipeline ETL (01:15 – 01:55)
* **Qué proyectar en pantalla:** Cambiar a la pestaña **"Integración Core Bancs"** en el frontend. Mostrar la comparativa de datos crudos vs limpios y brevemente la terminal con el script `etl_bancs_processor.py`.
* **Lo que dices (Speech):**

> *"El segundo gran desafío es la coexistencia con el Core Legado 'Bancs'. Para no saturar este mainframe con millones de consultas concurrentes, diseñé una estrategia dual:*
> 
> *Primero, un patrón **Transactional Outbox asíncrono** con buffers y Rate Limiting para sincronizar transferencias salientes hacia Bancs en micro-lotes fuera de horas pico. Y segundo, **Change Data Capture (CDC)** para capturar movimientos físicos de sucursales leyendo directamente los logs de la base de datos sin lanzar consultas `SELECT` sobre tablas productivas.*
> 
> *Adicionalmente, implementé un pipeline ETL en Python con Pandas que procesa los lotes crudos de Bancs: elimina transacciones duplicadas, descarta nulos o NaN, homologa formatos de fecha heterogéneos a ISO-8601 UTC y genera atributos predictivos de Feature Engineering como el `channelRiskScore` para alimentar a los modelos."*

---

### 🔹 BLOQUE 4: Incidente de Quincena, Prevención de Deadlocks y Observabilidad (01:55 – 02:35)
* **Qué proyectar en pantalla:** Cambiar a la pestaña **"Simulación de Quincena (SRE)"**. Seleccionar 40 o 60 transacciones concurrentes y presionar **"Ejecutar Test de Carga"**. Ver las métricas en verde y luego mostrar rápidamente Prometheus ([localhost:9090](http://localhost:9090)) o Grafana ([localhost:3001](http://localhost:3001)).
* **Lo que dices (Speech):**

> *"Pasemos al escenario operativo más exigente: el **pico de transacciones de Quincena**.*
> 
> *Bajo ráfagas masivas, el mayor riesgo bancario son los deadlocks y el agotamiento del pool de conexiones. Voy a disparar una simulación de 40 operaciones simultáneas.*
> 
> *Como observan en los resultados: **tasa de éxito del 100%, cero deadlocks detectados y una latencia p95 muy por debajo de los 2 segundos**. Esto se logra porque en el código implementé un **ordenamiento determinista de cuentas**: siempre se bloquea primero la cuenta menor y luego la mayor, eliminando la condición de espera circular de Coffman.*
> 
> *En observabilidad, instrumentamos logs estructurados en JSON con Winston, propagación de `x-correlation-id` en cada salto de red, y métricas Prometheus que alimentan nuestros dashboards en Grafana para diagnosticar saturación antes de que impacte al usuario."*

---

### 🔹 BLOQUE 5: Inteligencia Artificial con Gemini, MLOps y Cierre (02:35 – 03:00)
* **Qué proyectar en pantalla:** Cambiar a la pestaña **"Análisis Cognitivo (Gemini)"**. Mostrar la tarjeta de recomendación recién generada con el badge de `Google Gemini 3.6 Flash`, 95% de certeza y la explicación de saldo.
* **Lo que dices (Speech):**

> *"Finalmente, en el módulo de IA, nuestro microservicio independiente en FastAPI está conectado en tiempo real a la API oficial de **Google Gemini 3.6 Flash**.*
> 
> *Aquí vemos la recomendación generada en segundo plano para la transacción que hicimos al inicio: evaluó el 21% de consumo del saldo disponible y emitió una alerta de gasto personalizada en formato JSON estricto con parser **Self-Healing**, respaldado por un fallback heurístico local para garantizar cero caídas.*
> 
> *Para el gobierno del modelo en producción, definimos el ciclo MLOps con monitoreo de **Data Drift** mediante Population Stability Index (PSI), desvío a revisión humana si la confianza es menor al 50% y plan de contingencia con PgBouncer documentado en el post-mortem.*
> 
> *Con esto demostramos una solución bancaria robusta, escalable y lista para producción. Muchas gracias."*

---

## 🎯 Consejos Clave para Grabar el Video

1. **Herramienta recomendada:** Utiliza **OBS Studio**, **Loom** o la barra de juegos de Windows (`Win + G`) para grabar pantalla + micrófono.
2. **Ten los servicios ya abiertos en pestañas de Chrome:**
   * Pestaña 1: [http://localhost:3000](http://localhost:3000) (Frontend SmartBancs)
   * Pestaña 2: [http://localhost:3001](http://localhost:3001) (Grafana Dashboard)
   * Pestaña 3: [http://localhost:4000/metrics](http://localhost:4000/metrics) (Prometheus Raw Metrics)
   * Pestaña 4: [http://localhost:8000/health](http://localhost:8000/health) (AI Service Status)
3. **Control del tiempo:** Mantén un cronómetro en el celular al lado de tu pantalla. Si practicas 2 veces antes de grabar, clavarás los 3 minutos con total naturalidad.
