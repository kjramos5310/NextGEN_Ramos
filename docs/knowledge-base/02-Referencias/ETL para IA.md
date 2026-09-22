---
tags: [referencia, etl, datos, calidad, feature-engineering]
requisitos: [R3.2c, R3.2d, R3.2e, R3.2f, R3.3d, E4]
fuentes:
  - https://pandas.pydata.org/docs/user_guide/missing_data.html
  - https://pandera.readthedocs.io/en/stable/dataframe_schemas.html
  - https://parquet.apache.org/docs/overview/
  - https://developers.google.com/machine-learning/crash-course/numerical-data/normalization
  - https://www.iso.org/iso-4217-currency-codes.html
  - https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning
estado: borrador
---

# ETL: limpieza, normalización y feature engineering para IA

## Qué es
Es un proceso **Extract → Transform → Load** que toma un lote crudo de transacciones (de Bancs o de SmartBancs) y lo deja **limpio, tipado, validado y en un formato columnar**, listo para análisis y para entrenar o servir el modelo de recomendaciones.

## Problema que resuelve
Los datos que salen de un core legado suelen venir con nulos, fechas en varios formatos, montos como texto con separadores locales, códigos de moneda inconsistentes, duplicados y categorías con variantes de escritura. Un modelo entrenado sobre eso aprende ruido. Además, si la transformación de entrenamiento y la de inferencia difieren, aparece *training-serving skew*, un riesgo que Google cita de forma explícita (ver [[MLOps y Data Drift]]).

## Cómo se implementa
**Extract**: se lee el lote (CSV o JSON exportado, o la réplica de lectura), **nunca** con consultas en línea sobre Bancs (RNF-4).

**Transform**, en pasos idempotentes y auditables:
| Paso | Técnica | Ejemplo |
|---|---|---|
| Tipado | `convert_dtypes()` o dtypes *nullable* de pandas (`Int64`, `string`, `boolean`) para no forzar `float` por un NaN | `account_id` como string, no float |
| Nulos (R3.2d) | Se detectan con `isna()`. La política depende de cada columna: **descartar** (sin `amount` o sin `account_id`, porque no hay transacción), **imputar** (`channel` → `"UNKNOWN"`, `merchant_category` → `"OTROS"`) o **marcar** (`is_imputed_*` para que el modelo sepa) | `fillna`, `dropna(subset=...)` |
| Formatos (R3.2e) | Fechas a **ISO 8601 en UTC**; montos a `Decimal`, o a enteros en centavos (nunca `float` para dinero); moneda a **ISO 4217** (`"usd"`, `"US$"` → `USD`); texto con `strip`, mayúsculas y sin tildes en categorías; teléfonos y documentos enmascarados | `"15/01/2026 10:30"` → `2026-01-15T15:30:00Z` |
| Duplicados | Dedup por `transaction_id` (y por hash de campos si no hay id) | |
| Outliers | *Clipping* o marca, **no** borrar: en fraude, los extremos son la señal | |
| Validación | **Esquema declarativo** (pandera `DataFrameSchema`: tipos, `nullable`, `Check` de rango y conjunto). Las filas inválidas van a un archivo de **rechazos** con el motivo, sin fallar el lote completo | `amount > 0`, `currency ∈ {USD,…}` |
| Features | Agregados por cliente: gasto por categoría en 30 días, frecuencia, ticket promedio, hora o día típico, días desde la última transacción. Se escalan según la distribución: z-score si es aproximadamente normal, **log** si tiene cola larga (montos), clipping si hay extremos (guía de Google ML) | `log1p(amount)` |

**Load (R3.2f)**: **Parquet** particionado por fecha: *"column-oriented data file format designed for efficient data storage and retrieval"*, con compresión y tipos. Es óptimo para análisis y entrenamiento. En paralelo se genera un **reporte de calidad** (filas leídas, limpias y rechazadas, nulos por columna antes y después) que sirve como evidencia (E4).

## Trade-offs
| Decisión | A favor | En contra |
|---|---|---|
| Imputar vs descartar | Imputar conserva volumen | Imputar introduce sesgo; hay que marcarlo |
| pandas | Simple y conocido; alcanza para el MVP | No escala a lotes de GB; la alternativa es Polars, DuckDB o Spark |
| Parquet vs CSV | Tipos, compresión, columnar | No se lee a simple vista (se agrega un CSV de muestra como evidencia) |
| Validación estricta | Detecta basura temprano | Rechazos que hay que gestionar |
| ETL vs ELT | ETL deja datos limpios antes de cargar | ELT (transformar en SQL dentro del warehouse) escala mejor con dbt |

## Aplicación a SmartBancs
- **Script (R3.2c)**: `etl/transform.py --input raw.csv --output out/` con funciones puras por paso (`clean_nulls`, `standardize_formats`, `dedupe`, `build_features`), probadas con **pytest** sobre un lote sucio fabricado a propósito.
- **Datos de prueba (E4)**: un generador de un lote crudo con los defectos típicos inyectados a propósito (nulos, formatos mixtos, duplicados), para mostrar el antes y el después.
- **La misma función de features** se usa en el entrenamiento y en el servicio de IA para evitar el *skew*.
- Salidas: `transactions_clean.parquet`, `customer_features.parquet`, `rejects.csv`, `quality_report.json`.
- Referencias: [[MLOps y Data Drift]] (reentrenamiento y drift) y [[Sincronizacion con core legado]] (origen del lote).

## Preguntas que podría hacer el jurado
- *¿Por qué no `float` para montos?* Por errores de redondeo binario. Se usa `Decimal` o centavos enteros.
- *¿Qué haces con un nulo en el monto?* Rechazo la fila con motivo. Imputar un monto inventaría dinero.
- *¿Por qué Parquet?* Es columnar, comprimido y tipado; lo leen de forma nativa pandas, Spark y DuckDB, y el entrenamiento solo lee las columnas que necesita.
- *¿Cómo aseguras que la IA ve los mismos features en producción?* Con una sola librería de features compartida entre el entrenamiento y la inferencia (a futuro, un *feature store*).
- *¿Cómo escala a millones de filas?* Procesando por particiones o fechas, pasando a Polars o DuckDB, u orquestando con Airflow y Spark. El diseño por pasos puros facilita esa migración.
