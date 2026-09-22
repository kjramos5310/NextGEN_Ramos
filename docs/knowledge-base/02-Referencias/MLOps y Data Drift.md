---
tags: [referencia, mlops, drift, ia, recursos]
requisitos: [R3.3a, R3.3d, R3.3e, R3.3f, RNF-3]
fuentes:
  - https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning
  - https://developers.google.com/machine-learning/guides/rules-of-ml
  - https://research.google/pubs/hidden-technical-debt-in-machine-learning-systems/
  - https://docs.evidentlyai.com/metrics/explainer_drift
  - https://www.evidentlyai.com/blog/data-drift-detection-large-datasets
  - https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ks_2samp.html
  - https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
estado: borrador
---

# MLOps: reentrenamiento, data drift (PSI, KS) y gestión de recursos

## Qué es
**MLOps** aplica prácticas de CI/CD al ciclo de vida de un modelo: datos, entrenamiento, validación, despliegue, monitoreo y reentrenamiento. Google define niveles de madurez:
- **Nivel 0**: todo manual, en notebooks.
- **Nivel 1**: *pipeline* automatizado con **entrenamiento continuo (CT)** y validación de datos y modelo.
- **Nivel 2**: CI/CD del propio pipeline.

El **data drift** es el cambio de la distribución de los datos de entrada respecto de los de entrenamiento. El *concept drift* es el cambio de la relación entre entradas y objetivo.

## Problema que resuelve
Un modelo de recomendaciones entrenado con hábitos de enero se degrada en silencio: aparecen nuevos comercios, la quincena, estacionalidad o una inflación que mueve los montos. Sin monitoreo nadie lo nota, porque el servicio sigue respondiendo `200`. El paper *Hidden Technical Debt in ML Systems* (Google, NeurIPS 2015) advierte que el código del modelo es una fracción mínima del sistema y que la deuda está en los datos, las dependencias y los ciclos de retroalimentación.

## Cómo se implementa
**1. Alimentación con datos nuevos (R3.3d):**
- Los eventos `TransferCompleted` de la cola ([[Mensajeria asincrona y DLQ]]) se acumulan en un *data lake*. El [[ETL para IA]] los limpia en Parquet por fecha.
- **Disparadores de reentrenamiento** (Google): bajo demanda, por calendario, por **disponibilidad de datos nuevos**, por **degradación del desempeño** y por **cambios significativos en la distribución**.
- Pipeline: validar datos (esquema y estadísticas) → entrenar → **validar el modelo contra el de producción** (solo se promueve si es mejor) → registrar la versión y la metadata (datos, parámetros, métricas) → desplegar como **shadow** o **canary** → promover o hacer rollback.

**2. Monitoreo de drift (R3.3e):**
| Método | Qué mide | Umbral típico | Nota |
|---|---|---|---|
| **KS de dos muestras** (`scipy.stats.ks_2samp`) | ¿Dos muestras numéricas vienen de la misma distribución? (H0: iguales) | p-valor < 0,05 | Evidently: **demasiado sensible** con > 1 000 observaciones |
| **PSI** (Population Stability Index) | Σ (%act − %ref)·ln(%act/%ref) por bins | < 0,1 estable · 0,1–0,2 moderado · ≥ 0,2 significativo | Estándar en riesgo de crédito. Poco sensible: detecta cambios de más de ~10 % |
| Wasserstein / Jensen-Shannon | Distancia entre distribuciones | ≥ 0,1 (default de Evidently en datos grandes) | Punto medio entre KS y PSI |
| Chi-cuadrado | Categóricas | p < 0,05 | Default de Evidently en datos chicos |

- *Default de Evidently*: con ≤ 1 000 filas usa KS (numéricas) y χ² (categóricas); con más, Wasserstein y JS con umbral 0,1. Se puede declarar *dataset drift* si deriva ≥ 50 % de las columnas.
- Además del drift de las entradas: **drift de predicción** (distribución de recomendaciones) y, cuando haya etiquetas (clic o aceptación de la recomendación), el **desempeño real**.
- La salida de cada chequeo es una métrica `model_feature_psi{feature}` más una alerta, y dispara el pipeline de reentrenamiento (ver [[Observabilidad]]).

**3. Gestión de recursos (R3.3f):**
- **Servicio aislado**: la IA corre en su propio proceso o contenedor con **requests/limits** de CPU y memoria (K8s: al pasar el límite de CPU hay *throttling*; al pasar el de memoria, *OOM kill*). No compite con la API de transferencias.
- **Inferencia asíncrona por lotes** desde la cola: se agrupan eventos, lo que da mejor throughput por CPU. Prefetch acotado.
- **Autoescalado** de consumidores según la profundidad de la cola. El **entrenamiento** corre en nodos o horarios separados (fuera de la quincena).
- **Modelo liviano primero** (reglas o gradient boosting) antes que deep learning. *Rules of ML* de Google recomienda empezar simple y con buena infraestructura.
- **Degradación**: si la IA se satura, se descartan o muestrean eventos de baja prioridad; la transferencia no se entera (RNF-3). Ver [[Resiliencia - timeouts reintentos y circuit breaker]].

## Trade-offs
| Decisión | A favor | En contra |
|---|---|---|
| Reentrenar por calendario | Simple y predecible | Reentrena sin necesidad o tarde |
| Reentrenar por drift | Solo cuando hace falta | Falsos positivos (KS) o tardíos (PSI) |
| PSI | Interpretable, estándar en banca | Poco sensible y depende de los bins |
| KS | Sensible, sin bins | Alarma con cualquier cosa en volúmenes grandes |
| Mock en MVP vs modelo real | Mock: foco en la integración | Hay que explicar honestamente qué es mock |

## Aplicación a SmartBancs
- **MVP (R3.3a)**: servicio `ai-service` independiente (HTTP y consumidor de cola) con un **modelo simple o reglas** sobre los features del ETL, más un endpoint `/model/info` (versión y fecha de entrenamiento).
- **Script de drift** (opcional, para demostrar): compara `features_ref.parquet` con `features_actual.parquet` y calcula PSI y KS por feature. Genera un reporte.
- **Documento (R3.3d–f)**: el ciclo del punto 1, la tabla del punto 2 y los recursos del punto 3, con un diagrama.

## Preguntas que podría hacer el jurado
- *¿Cómo sabes que el modelo se degradó si no tienes etiquetas inmediatas?* Por el drift de entradas y predicciones (proxy) y, con retraso, por el desempeño real cuando llegan las etiquetas (aceptación de la recomendación).
- *¿PSI o KS?* PSI para alertas de negocio (interpretable, estándar en banca) y KS o Wasserstein para diagnóstico fino. Con volumen alto, KS alarma de más.
- *¿Cuándo reentrenas?* Por calendario semanal como base, adelantado si PSI ≥ 0,2 en features clave. Solo se promueve si supera al modelo en producción.
- *¿Cómo evitas que la IA consuma los recursos de las transferencias?* Con un proceso separado y límites propios, consumo por cola con prefetch y entrenamiento fuera de horario pico.
- *¿Qué es training-serving skew?* Cuando los features se calculan distinto al entrenar y al servir. Se evita con una sola librería de features compartida.
