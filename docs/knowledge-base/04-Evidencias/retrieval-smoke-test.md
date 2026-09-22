---
tags: [evidencia, rag]
generado: 2026-09-22T13:46:12-05:00
backend: e5
modelo: intfloat/multilingual-e5-small
commit: n/d
k: 5
---

# Prueba de humo de recuperación (RAG)

Archivo generado por `tools/kb-rag/smoke_test.py`; **no se edita a mano**. Hay una consulta por requisito del
[[Reto TCS - Checklist]], y la consulta es el texto literal del ítem. **hit@5** = algún fragmento del top-5
viene de una nota que declara ese requisito en su frontmatter.

- Índice: `02-Referencias,03-Decisiones` · chunk ≤ 480 tokens, solapamiento 64
- **hit@5: 37/41 requisitos evaluables (90 %)**
- Requisitos sin nota mapeada: 6 (brecha de cobertura; ver resumen)

## Resumen

| Req | hit@5 | score top-1 | top-1 |
|---|---|---|---|
| R3.1a | ✅ @3 | 0.880 | [[Resiliencia - timeouts reintentos y circuit breaker]] › Cómo se implementa |
| R3.1b | ✅ @5 | 0.873 | [[ETL para IA]] › Cómo se implementa |
| R3.1c | — sin nota mapeada | 0.876 | [[ETL para IA]] › Aplicación a SmartBancs |
| R3.1d | ❌ | 0.828 | [[CDC con Debezium]] › Trade-offs |
| R3.1e | ✅ @1 | 0.885 | [[Concurrencia en PostgreSQL]] › Preguntas que podría hacer el jurado |
| R3.1f | ❌ | 0.867 | [[CDC con Debezium]] › Trade-offs |
| R3.2a | ✅ @1 | 0.868 | [[CDC con Debezium]] › Aplicación a SmartBancs |
| R3.2b | ✅ @2 | 0.877 | [[Concurrencia en PostgreSQL]] › Cómo se implementa |
| R3.2c | ✅ @1 | 0.892 | [[ETL para IA]] › Cómo se implementa |
| R3.2d | ✅ @4 | 0.841 | [[CDC con Debezium]] › Trade-offs |
| R3.2e | ✅ @1 | 0.858 | [[ETL para IA]] › Aplicación a SmartBancs |
| R3.2f | ✅ @2 | 0.858 | [[MLOps y Data Drift]] › Cómo se implementa |
| R3.3a | ✅ @1 | 0.861 | [[MLOps y Data Drift]] › Cómo se implementa |
| R3.3b | ✅ @3 | 0.866 | [[Sincronizacion con core legado]] › Qué es |
| R3.3c | ✅ @1 | 0.876 | [[Resiliencia - timeouts reintentos y circuit breaker]] › Aplicación a SmartBancs |
| R3.3d | ✅ @1 | 0.874 | [[MLOps y Data Drift]] › Cómo se implementa |
| R3.3e | ✅ @1 | 0.870 | [[MLOps y Data Drift]] › Cómo se implementa |
| R3.3f | ✅ @1 | 0.861 | [[MLOps y Data Drift]] › Cómo se implementa |
| R3.4a | ❌ | 0.877 | [[Transactional Outbox]] › Aplicación a SmartBancs |
| R3.4b | ✅ @3 | 0.861 | [[Incidentes y Post Mortem]] › Cómo se implementa > C. Estructura del post mortem (R3.6a) |
| R3.4c | ✅ @5 | 0.860 | [[MLOps y Data Drift]] › Cómo se implementa |
| R3.4d | ✅ @2 | 0.857 | [[CDC con Debezium]] › Problema que resuelve |
| R3.4e | ✅ @3 | 0.851 | [[Sincronizacion con core legado]] › Qué es |
| R3.4f | ✅ @1 | 0.864 | [[Observabilidad]] › Cómo se implementa |
| R3.4g | ✅ @1 | 0.867 | [[Observabilidad]] › Qué es |
| R3.4h | ✅ @3 | 0.879 | [[Transactional Outbox]] › Trade-offs |
| R3.4i | ✅ @3 | 0.861 | [[MLOps y Data Drift]] › Preguntas que podría hacer el jurado |
| R3.4j | ✅ @2 | 0.857 | [[ETL para IA]] › Cómo se implementa |
| R3.5a | ✅ @1 | 0.864 | [[Observabilidad]] › Preguntas que podría hacer el jurado |
| R3.5b | ✅ @1 | 0.876 | [[Connection Pooling y 10k TPS]] › Cómo se implementa |
| R3.5c | ✅ @1 | 0.853 | [[Incidentes y Post Mortem]] › Cómo se implementa > B. Acciones inmediatas en el escenario de quincena (R3.5d) |
| R3.5d | ✅ @1 | 0.880 | [[Incidentes y Post Mortem]] › Cómo se implementa > B. Acciones inmediatas en el escenario de quincena (R3.5d) |
| R3.6a | ✅ @1 | 0.886 | [[Incidentes y Post Mortem]] › Cómo se implementa > C. Estructura del post mortem (R3.6a) |
| R3.6b | ✅ @1 | 0.850 | [[Incidentes y Post Mortem]] › Cómo se implementa > A. Escalamiento (R3.6b) |
| R3.6c | ✅ @1 | 0.846 | [[Incidentes y Post Mortem]] › Cómo se implementa > D. Acciones preventivas (R3.6c, R3.6d) |
| R3.6d | ✅ @1 | 0.863 | [[Incidentes y Post Mortem]] › Cómo se implementa > D. Acciones preventivas (R3.6c, R3.6d) |
| RNF-1 | ✅ @1 | 0.868 | [[Connection Pooling y 10k TPS]] › Cómo se implementa |
| RNF-2 | ✅ @3 | 0.853 | [[Transactional Outbox]] › Trade-offs |
| RNF-3 | ✅ @1 | 0.848 | [[Mensajeria asincrona y DLQ]] › Problema que resuelve |
| RNF-4 | ✅ @1 | 0.870 | [[Sincronizacion con core legado]] › Problema que resuelve |
| RNF-5 | ❌ | 0.861 | [[Observabilidad]] › Aplicación a SmartBancs |
| E1 | — sin nota mapeada | 0.867 | [[Incidentes y Post Mortem]] › Aplicación a SmartBancs |
| E2 | — sin nota mapeada | 0.880 | [[ETL para IA]] › Aplicación a SmartBancs |
| E3 | — sin nota mapeada | 0.860 | [[ETL para IA]] › Aplicación a SmartBancs |
| E4 | ✅ @1 | 0.857 | [[ETL para IA]] › Aplicación a SmartBancs |
| E5 | — sin nota mapeada | 0.869 | [[ETL para IA]] › Aplicación a SmartBancs |
| E6 | — sin nota mapeada | 0.857 | [[Idempotency Keys]] › Preguntas que podría hacer el jurado |

## Detalle por requisito

### R3.1a — Microservicio REST o gRPC con endpoint que recibe una transacción financiera.
Notas mapeadas: Idempotency Keys

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.880 | [[Resiliencia - timeouts reintentos y circuit breaker]] › Cómo se implementa |  |
| 2 | 0.880 | [[Transactional Outbox]] › Aplicación a SmartBancs |  |
| 3 | 0.874 | [[Idempotency Keys]] › Aplicación a SmartBancs | sí |
| 4 | 0.873 | [[Resiliencia - timeouts reintentos y circuit breaker]] › Aplicación a SmartBancs |  |
| 5 | 0.873 | [[Transactional Outbox]] › Trade-offs |  |

### R3.1b — Scripts DDL que crean las tablas necesarias.
Notas mapeadas: Concurrencia en PostgreSQL, Idempotency Keys

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.873 | [[ETL para IA]] › Cómo se implementa |  |
| 2 | 0.867 | [[ETL para IA]] › Aplicación a SmartBancs |  |
| 3 | 0.866 | [[CDC con Debezium]] › Cómo se implementa |  |
| 4 | 0.863 | [[ETL para IA]] › Preguntas que podría hacer el jurado |  |
| 5 | 0.862 | [[Idempotency Keys]] › Aplicación a SmartBancs | sí |

### R3.1c — Scripts DML (datos semilla / prueba).
Notas mapeadas: (ninguna)

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.876 | [[ETL para IA]] › Aplicación a SmartBancs |  |
| 2 | 0.871 | [[ETL para IA]] › Cómo se implementa |  |
| 3 | 0.865 | [[Incidentes y Post Mortem]] › Cómo se implementa > D. Acciones preventivas (R3.6c, R3.6d) |  |
| 4 | 0.862 | [[CDC con Debezium]] › Cómo se implementa |  |
| 5 | 0.859 | [[Concurrencia en PostgreSQL]] › Aplicación a SmartBancs |  |

### R3.1d — El microservicio interactúa realmente con la BD.
Notas mapeadas: Concurrencia en PostgreSQL, Transactional Outbox

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.828 | [[CDC con Debezium]] › Trade-offs |  |
| 2 | 0.825 | [[Sincronizacion con core legado]] › Preguntas que podría hacer el jurado |  |
| 3 | 0.823 | [[CDC con Debezium]] › Problema que resuelve |  |
| 4 | 0.823 | [[Observabilidad]] › Aplicación a SmartBancs |  |
| 5 | 0.822 | [[Idempotency Keys]] › Aplicación a SmartBancs |  |

### R3.1e — Concurrencia correcta sin *race conditions*, demostrada con prueba concurrente.
Notas mapeadas: Concurrencia en PostgreSQL, Idempotency Keys, Transactional Outbox

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.885 | [[Concurrencia en PostgreSQL]] › Preguntas que podría hacer el jurado | sí |
| 2 | 0.880 | [[Concurrencia en PostgreSQL]] › Aplicación a SmartBancs | sí |
| 3 | 0.879 | [[Concurrencia en PostgreSQL]] › Trade-offs | sí |
| 4 | 0.878 | [[Concurrencia en PostgreSQL]] › Problema que resuelve | sí |
| 5 | 0.875 | [[Observabilidad]] › Cómo se implementa |  |

### R3.1f — IaC que levanta backend + BD con un solo comando.
Notas mapeadas: Connection Pooling y 10k TPS

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.867 | [[CDC con Debezium]] › Trade-offs |  |
| 2 | 0.866 | [[Incidentes y Post Mortem]] › Cómo se implementa > B. Acciones inmediatas en el escenario de quincena (R3.5d) |  |
| 3 | 0.865 | [[CDC con Debezium]] › Cómo se implementa |  |
| 4 | 0.861 | [[Incidentes y Post Mortem]] › Cómo se implementa > D. Acciones preventivas (R3.6c, R3.6d) |  |
| 5 | 0.860 | [[Incidentes y Post Mortem]] › Preguntas que podría hacer el jurado |  |

### R3.2a — Flujo de datos app ↔ Bancs.
Notas mapeadas: CDC con Debezium, Mensajeria asincrona y DLQ, Sincronizacion con core legado, Transactional Outbox

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.868 | [[CDC con Debezium]] › Aplicación a SmartBancs | sí |
| 2 | 0.864 | [[Idempotency Keys]] › Cómo se implementa |  |
| 3 | 0.863 | [[Transactional Outbox]] › Aplicación a SmartBancs | sí |
| 4 | 0.862 | [[Connection Pooling y 10k TPS]] › Aplicación a SmartBancs |  |
| 5 | 0.861 | [[ETL para IA]] › Aplicación a SmartBancs |  |

### R3.2b — Actualización de saldos sin saturar Bancs.
Notas mapeadas: CDC con Debezium, Idempotency Keys, Mensajeria asincrona y DLQ, Sincronizacion con core legado, Transactional Outbox

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.877 | [[Concurrencia en PostgreSQL]] › Cómo se implementa |  |
| 2 | 0.875 | [[Sincronizacion con core legado]] › Cómo se implementa | sí |
| 3 | 0.871 | [[CDC con Debezium]] › Aplicación a SmartBancs | sí |
| 4 | 0.868 | [[Sincronizacion con core legado]] › Preguntas que podría hacer el jurado | sí |
| 5 | 0.866 | [[Transactional Outbox]] › Aplicación a SmartBancs | sí |

### R3.2c — Script ETL/ELT sobre un lote de transacciones crudas.
Notas mapeadas: ETL para IA

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.892 | [[ETL para IA]] › Cómo se implementa | sí |
| 2 | 0.892 | [[ETL para IA]] › Cómo se implementa | sí |
| 3 | 0.890 | [[ETL para IA]] › Aplicación a SmartBancs | sí |
| 4 | 0.889 | [[ETL para IA]] › Qué es | sí |
| 5 | 0.888 | [[Incidentes y Post Mortem]] › Cómo se implementa > D. Acciones preventivas (R3.6c, R3.6d) |  |

### R3.2d — Manejo de valores nulos.
Notas mapeadas: ETL para IA

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.841 | [[CDC con Debezium]] › Trade-offs |  |
| 2 | 0.841 | [[Mensajeria asincrona y DLQ]] › Cómo se implementa |  |
| 3 | 0.838 | [[MLOps y Data Drift]] › Problema que resuelve |  |
| 4 | 0.837 | [[ETL para IA]] › Cómo se implementa | sí |
| 5 | 0.833 | [[ETL para IA]] › Cómo se implementa | sí |

### R3.2e — Estandarización de formatos.
Notas mapeadas: ETL para IA

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.858 | [[ETL para IA]] › Aplicación a SmartBancs | sí |
| 2 | 0.857 | [[ETL para IA]] › Preguntas que podría hacer el jurado | sí |
| 3 | 0.855 | [[MLOps y Data Drift]] › Preguntas que podría hacer el jurado |  |
| 4 | 0.855 | [[CDC con Debezium]] › Cómo se implementa |  |
| 5 | 0.854 | [[ETL para IA]] › Cómo se implementa | sí |

### R3.2f — Salida estructurada, optimizada para análisis o consumo por IA.
Notas mapeadas: ETL para IA

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.858 | [[MLOps y Data Drift]] › Cómo se implementa |  |
| 2 | 0.854 | [[ETL para IA]] › Aplicación a SmartBancs | sí |
| 3 | 0.854 | [[Observabilidad]] › Trade-offs |  |
| 4 | 0.853 | [[ETL para IA]] › Cómo se implementa | sí |
| 5 | 0.850 | [[ETL para IA]] › Trade-offs | sí |

### R3.3a — Servicio de IA independiente o mock avanzado funcional.
Notas mapeadas: MLOps y Data Drift, Mensajeria asincrona y DLQ

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.861 | [[MLOps y Data Drift]] › Cómo se implementa | sí |
| 2 | 0.860 | [[ETL para IA]] › Aplicación a SmartBancs |  |
| 3 | 0.855 | [[MLOps y Data Drift]] › Preguntas que podría hacer el jurado | sí |
| 4 | 0.853 | [[Resiliencia - timeouts reintentos y circuit breaker]] › Qué es |  |
| 5 | 0.853 | [[MLOps y Data Drift]] › Aplicación a SmartBancs | sí |

### R3.3b — Consumo asíncrono / no bloqueante desde el microservicio principal.
Notas mapeadas: Mensajeria asincrona y DLQ, Resiliencia - timeouts reintentos y circuit breaker, Transactional Outbox

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.866 | [[Sincronizacion con core legado]] › Qué es |  |
| 2 | 0.863 | [[Incidentes y Post Mortem]] › Cómo se implementa > B. Acciones inmediatas en el escenario de quincena (R3.5d) |  |
| 3 | 0.861 | [[Resiliencia - timeouts reintentos y circuit breaker]] › Aplicación a SmartBancs | sí |
| 4 | 0.861 | [[Mensajeria asincrona y DLQ]] › Trade-offs | sí |
| 5 | 0.861 | [[Mensajeria asincrona y DLQ]] › Preguntas que podría hacer el jurado | sí |

### R3.3c — Evidencia de que la IA no afecta la latencia de la transacción.
Notas mapeadas: Resiliencia - timeouts reintentos y circuit breaker

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.876 | [[Resiliencia - timeouts reintentos y circuit breaker]] › Aplicación a SmartBancs | sí |
| 2 | 0.875 | [[Resiliencia - timeouts reintentos y circuit breaker]] › Preguntas que podría hacer el jurado | sí |
| 3 | 0.873 | [[Transactional Outbox]] › Trade-offs |  |
| 4 | 0.868 | [[Observabilidad]] › Cómo se implementa |  |
| 5 | 0.868 | [[Mensajeria asincrona y DLQ]] › Problema que resuelve |  |

### R3.3d — Ciclo de vida: ingesta de datos nuevos / reentrenamiento.
Notas mapeadas: CDC con Debezium, ETL para IA, MLOps y Data Drift

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.874 | [[MLOps y Data Drift]] › Cómo se implementa | sí |
| 2 | 0.870 | [[MLOps y Data Drift]] › Cómo se implementa | sí |
| 3 | 0.870 | [[MLOps y Data Drift]] › Preguntas que podría hacer el jurado | sí |
| 4 | 0.865 | [[Transactional Outbox]] › Preguntas que podría hacer el jurado |  |
| 5 | 0.865 | [[ETL para IA]] › Aplicación a SmartBancs | sí |

### R3.3e — Monitoreo de *data drift*.
Notas mapeadas: MLOps y Data Drift, Observabilidad

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.870 | [[MLOps y Data Drift]] › Cómo se implementa | sí |
| 2 | 0.863 | [[ETL para IA]] › Aplicación a SmartBancs |  |
| 3 | 0.862 | [[MLOps y Data Drift]] › Cómo se implementa | sí |
| 4 | 0.861 | [[MLOps y Data Drift]] › Preguntas que podría hacer el jurado | sí |
| 5 | 0.860 | [[MLOps y Data Drift]] › Cómo se implementa | sí |

### R3.3f — Gestión del consumo de recursos.
Notas mapeadas: MLOps y Data Drift

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.861 | [[MLOps y Data Drift]] › Cómo se implementa | sí |
| 2 | 0.844 | [[Incidentes y Post Mortem]] › Cómo se implementa > C. Estructura del post mortem (R3.6a) |  |
| 3 | 0.843 | [[Mensajeria asincrona y DLQ]] › Cómo se implementa |  |
| 4 | 0.841 | [[Transactional Outbox]] › Aplicación a SmartBancs |  |
| 5 | 0.840 | [[MLOps y Data Drift]] › Problema que resuelve | sí |

### R3.4a — Log de transacciones procesadas con éxito.
Notas mapeadas: Observabilidad

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.877 | [[Transactional Outbox]] › Aplicación a SmartBancs |  |
| 2 | 0.867 | [[Sincronizacion con core legado]] › Cómo se implementa |  |
| 3 | 0.867 | [[Concurrencia en PostgreSQL]] › Aplicación a SmartBancs |  |
| 4 | 0.866 | [[Transactional Outbox]] › Cómo se implementa |  |
| 5 | 0.866 | [[Incidentes y Post Mortem]] › Cómo se implementa > D. Acciones preventivas (R3.6c, R3.6d) |  |

### R3.4b — Log de errores y excepciones.
Notas mapeadas: Mensajeria asincrona y DLQ, Observabilidad

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.861 | [[Incidentes y Post Mortem]] › Cómo se implementa > C. Estructura del post mortem (R3.6a) |  |
| 2 | 0.858 | [[ETL para IA]] › Cómo se implementa |  |
| 3 | 0.857 | [[Observabilidad]] › Cómo se implementa | sí |
| 4 | 0.856 | [[Incidentes y Post Mortem]] › Cómo se implementa > B. Acciones inmediatas en el escenario de quincena (R3.5d) |  |
| 5 | 0.854 | [[ETL para IA]] › Cómo se implementa |  |

### R3.4c — Log de llamadas al servicio de IA.
Notas mapeadas: Observabilidad

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.860 | [[MLOps y Data Drift]] › Cómo se implementa |  |
| 2 | 0.858 | [[ETL para IA]] › Aplicación a SmartBancs |  |
| 3 | 0.857 | [[Resiliencia - timeouts reintentos y circuit breaker]] › Cómo se implementa |  |
| 4 | 0.856 | [[Mensajeria asincrona y DLQ]] › Problema que resuelve |  |
| 5 | 0.856 | [[Observabilidad]] › Cómo se implementa | sí |

### R3.4d — Log de interacciones con la BD.
Notas mapeadas: Concurrencia en PostgreSQL, Observabilidad

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.857 | [[CDC con Debezium]] › Problema que resuelve |  |
| 2 | 0.853 | [[Observabilidad]] › Cómo se implementa | sí |
| 3 | 0.853 | [[Incidentes y Post Mortem]] › Preguntas que podría hacer el jurado |  |
| 4 | 0.852 | [[CDC con Debezium]] › Trade-offs |  |
| 5 | 0.846 | [[Incidentes y Post Mortem]] › Cómo se implementa > D. Acciones preventivas (R3.6c, R3.6d) |  |

### R3.4e — Métrica de volumen transaccional.
Notas mapeadas: Observabilidad

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.851 | [[Sincronizacion con core legado]] › Qué es |  |
| 2 | 0.849 | [[Sincronizacion con core legado]] › Aplicación a SmartBancs |  |
| 3 | 0.849 | [[Observabilidad]] › Cómo se implementa | sí |
| 4 | 0.847 | [[Connection Pooling y 10k TPS]] › Cómo se implementa |  |
| 5 | 0.844 | [[Mensajeria asincrona y DLQ]] › Trade-offs |  |

### R3.4f — Métrica de errores.
Notas mapeadas: Observabilidad

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.864 | [[Observabilidad]] › Cómo se implementa | sí |
| 2 | 0.856 | [[Incidentes y Post Mortem]] › Cómo se implementa > C. Estructura del post mortem (R3.6a) |  |
| 3 | 0.851 | [[Observabilidad]] › Qué es | sí |
| 4 | 0.849 | [[Mensajeria asincrona y DLQ]] › Cómo se implementa |  |
| 5 | 0.846 | [[Incidentes y Post Mortem]] › Preguntas que podría hacer el jurado |  |

### R3.4g — Métrica de tiempos de respuesta (latencia).
Notas mapeadas: Observabilidad

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.867 | [[Observabilidad]] › Qué es | sí |
| 2 | 0.864 | [[Observabilidad]] › Cómo se implementa | sí |
| 3 | 0.861 | [[Observabilidad]] › Cómo se implementa | sí |
| 4 | 0.859 | [[Sincronizacion con core legado]] › Aplicación a SmartBancs |  |
| 5 | 0.851 | [[Resiliencia - timeouts reintentos y circuit breaker]] › Cómo se implementa |  |

### R3.4h — Trazabilidad de una transacción entre componentes.
Notas mapeadas: Observabilidad

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.879 | [[Transactional Outbox]] › Trade-offs |  |
| 2 | 0.865 | [[Transactional Outbox]] › Aplicación a SmartBancs |  |
| 3 | 0.861 | [[Observabilidad]] › Cómo se implementa | sí |
| 4 | 0.854 | [[Transactional Outbox]] › Problema que resuelve |  |
| 5 | 0.853 | [[Connection Pooling y 10k TPS]] › Cómo se implementa |  |

### R3.4i — Qué señales detectan rendimiento degradado o fallos.
Notas mapeadas: Observabilidad

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.861 | [[MLOps y Data Drift]] › Preguntas que podría hacer el jurado |  |
| 2 | 0.858 | [[Resiliencia - timeouts reintentos y circuit breaker]] › Problema que resuelve |  |
| 3 | 0.857 | [[Observabilidad]] › Qué es | sí |
| 4 | 0.854 | [[Resiliencia - timeouts reintentos y circuit breaker]] › Trade-offs |  |
| 5 | 0.853 | [[MLOps y Data Drift]] › Trade-offs |  |

### R3.4j — Justificación de la utilidad de cada dato.
Notas mapeadas: Observabilidad

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.857 | [[ETL para IA]] › Cómo se implementa |  |
| 2 | 0.856 | [[Observabilidad]] › Aplicación a SmartBancs | sí |
| 3 | 0.851 | [[ETL para IA]] › Aplicación a SmartBancs |  |
| 4 | 0.851 | [[Observabilidad]] › Cómo se implementa | sí |
| 5 | 0.843 | [[Incidentes y Post Mortem]] › Cómo se implementa > C. Estructura del post mortem (R3.6a) |  |

### R3.5a — Logs/métricas que identifican la consulta o proceso exacto del cuello de botella.
Notas mapeadas: Concurrencia en PostgreSQL, Incidentes y Post Mortem, Observabilidad

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.864 | [[Observabilidad]] › Preguntas que podría hacer el jurado | sí |
| 2 | 0.863 | [[MLOps y Data Drift]] › Preguntas que podría hacer el jurado |  |
| 3 | 0.861 | [[Observabilidad]] › Cómo se implementa | sí |
| 4 | 0.859 | [[Observabilidad]] › Cómo se implementa | sí |
| 5 | 0.858 | [[Observabilidad]] › Trade-offs | sí |

### R3.5b — Ídem para *timeouts* de conexión con la BD.
Notas mapeadas: Concurrencia en PostgreSQL, Connection Pooling y 10k TPS, Incidentes y Post Mortem, Observabilidad

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.876 | [[Connection Pooling y 10k TPS]] › Cómo se implementa | sí |
| 2 | 0.873 | [[Resiliencia - timeouts reintentos y circuit breaker]] › Cómo se implementa |  |
| 3 | 0.871 | [[CDC con Debezium]] › Trade-offs |  |
| 4 | 0.869 | [[Connection Pooling y 10k TPS]] › Aplicación a SmartBancs | sí |
| 5 | 0.869 | [[Observabilidad]] › Aplicación a SmartBancs | sí |

### R3.5c — Ídem para *deadlocks*.
Notas mapeadas: Concurrencia en PostgreSQL, Incidentes y Post Mortem, Observabilidad

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.853 | [[Incidentes y Post Mortem]] › Cómo se implementa > B. Acciones inmediatas en el escenario de quincena (R3.5d) | sí |
| 2 | 0.851 | [[CDC con Debezium]] › Cómo se implementa |  |
| 3 | 0.850 | [[Concurrencia en PostgreSQL]] › Cómo se implementa | sí |
| 4 | 0.849 | [[ETL para IA]] › Aplicación a SmartBancs |  |
| 5 | 0.848 | [[Idempotency Keys]] › Aplicación a SmartBancs |  |

### R3.5d — Acciones inmediatas: matar conexiones bloqueadas, ajustar red, balancear carga.
Notas mapeadas: Concurrencia en PostgreSQL, Connection Pooling y 10k TPS, Incidentes y Post Mortem, Resiliencia - timeouts reintentos y circuit breaker

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.880 | [[Incidentes y Post Mortem]] › Cómo se implementa > B. Acciones inmediatas en el escenario de quincena (R3.5d) | sí |
| 2 | 0.880 | [[Incidentes y Post Mortem]] › Cómo se implementa > B. Acciones inmediatas en el escenario de quincena (R3.5d) | sí |
| 3 | 0.877 | [[Incidentes y Post Mortem]] › Preguntas que podría hacer el jurado | sí |
| 4 | 0.869 | [[Incidentes y Post Mortem]] › Trade-offs | sí |
| 5 | 0.869 | [[Resiliencia - timeouts reintentos y circuit breaker]] › Qué es | sí |

### R3.6a — Estructura del informe post mortem.
Notas mapeadas: Incidentes y Post Mortem

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.886 | [[Incidentes y Post Mortem]] › Cómo se implementa > C. Estructura del post mortem (R3.6a) | sí |
| 2 | 0.863 | [[Incidentes y Post Mortem]] › Aplicación a SmartBancs | sí |
| 3 | 0.854 | [[Incidentes y Post Mortem]] › Cómo se implementa > A. Escalamiento (R3.6b) | sí |
| 4 | 0.854 | [[Incidentes y Post Mortem]] › Qué es | sí |
| 5 | 0.854 | [[Incidentes y Post Mortem]] › Problema que resuelve | sí |

### R3.6b — Proceso de escalamiento.
Notas mapeadas: Incidentes y Post Mortem

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.850 | [[Incidentes y Post Mortem]] › Cómo se implementa > A. Escalamiento (R3.6b) | sí |
| 2 | 0.843 | [[MLOps y Data Drift]] › Preguntas que podría hacer el jurado |  |
| 3 | 0.842 | [[Incidentes y Post Mortem]] › Cómo se implementa > B. Acciones inmediatas en el escenario de quincena (R3.5d) | sí |
| 4 | 0.841 | [[Incidentes y Post Mortem]] › Preguntas que podría hacer el jurado | sí |
| 5 | 0.838 | [[Incidentes y Post Mortem]] › Aplicación a SmartBancs | sí |

### R3.6c — Acciones preventivas de infraestructura.
Notas mapeadas: Connection Pooling y 10k TPS, Incidentes y Post Mortem

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.846 | [[Incidentes y Post Mortem]] › Cómo se implementa > D. Acciones preventivas (R3.6c, R3.6d) | sí |
| 2 | 0.842 | [[Incidentes y Post Mortem]] › Preguntas que podría hacer el jurado | sí |
| 3 | 0.837 | [[Incidentes y Post Mortem]] › Cómo se implementa > B. Acciones inmediatas en el escenario de quincena (R3.5d) | sí |
| 4 | 0.837 | [[Incidentes y Post Mortem]] › Cómo se implementa > C. Estructura del post mortem (R3.6a) | sí |
| 5 | 0.836 | [[Incidentes y Post Mortem]] › Aplicación a SmartBancs | sí |

### R3.6d — Acciones preventivas de código.
Notas mapeadas: Concurrencia en PostgreSQL, Idempotency Keys, Incidentes y Post Mortem, Resiliencia - timeouts reintentos y circuit breaker

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.863 | [[Incidentes y Post Mortem]] › Cómo se implementa > D. Acciones preventivas (R3.6c, R3.6d) | sí |
| 2 | 0.854 | [[Transactional Outbox]] › Preguntas que podría hacer el jurado |  |
| 3 | 0.851 | [[Incidentes y Post Mortem]] › Trade-offs | sí |
| 4 | 0.850 | [[Incidentes y Post Mortem]] › Preguntas que podría hacer el jurado | sí |
| 5 | 0.850 | [[Mensajeria asincrona y DLQ]] › Cómo se implementa |  |

### RNF-1 — Picos de 10 000 TPS.
Notas mapeadas: Connection Pooling y 10k TPS, Sincronizacion con core legado

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.868 | [[Connection Pooling y 10k TPS]] › Cómo se implementa | sí |
| 2 | 0.862 | [[Connection Pooling y 10k TPS]] › Trade-offs | sí |
| 3 | 0.856 | [[Connection Pooling y 10k TPS]] › Preguntas que podría hacer el jurado | sí |
| 4 | 0.853 | [[Connection Pooling y 10k TPS]] › Cómo se implementa | sí |
| 5 | 0.850 | [[Sincronizacion con core legado]] › Aplicación a SmartBancs | sí |

### RNF-2 — Transferencias < 2 s.
Notas mapeadas: Concurrencia en PostgreSQL, Connection Pooling y 10k TPS, Idempotency Keys, Resiliencia - timeouts reintentos y circuit breaker, Sincronizacion con core legado

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.853 | [[Transactional Outbox]] › Trade-offs |  |
| 2 | 0.851 | [[Transactional Outbox]] › Aplicación a SmartBancs |  |
| 3 | 0.847 | [[Resiliencia - timeouts reintentos y circuit breaker]] › Cómo se implementa | sí |
| 4 | 0.845 | [[Idempotency Keys]] › Aplicación a SmartBancs | sí |
| 5 | 0.841 | [[Sincronizacion con core legado]] › Cómo se implementa | sí |

### RNF-3 — La IA no bloquea ni retrasa el flujo transaccional.
Notas mapeadas: MLOps y Data Drift, Mensajeria asincrona y DLQ, Resiliencia - timeouts reintentos y circuit breaker, Transactional Outbox

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.848 | [[Mensajeria asincrona y DLQ]] › Problema que resuelve | sí |
| 2 | 0.836 | [[Resiliencia - timeouts reintentos y circuit breaker]] › Aplicación a SmartBancs | sí |
| 3 | 0.831 | [[Resiliencia - timeouts reintentos y circuit breaker]] › Preguntas que podría hacer el jurado | sí |
| 4 | 0.831 | [[Resiliencia - timeouts reintentos y circuit breaker]] › Qué es | sí |
| 5 | 0.830 | [[Incidentes y Post Mortem]] › Cómo se implementa > B. Acciones inmediatas en el escenario de quincena (R3.5d) |  |

### RNF-4 — Bancs no admite alto volumen de consultas directas.
Notas mapeadas: CDC con Debezium, Mensajeria asincrona y DLQ, Resiliencia - timeouts reintentos y circuit breaker, Sincronizacion con core legado, Transactional Outbox

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.870 | [[Sincronizacion con core legado]] › Problema que resuelve | sí |
| 2 | 0.847 | [[Sincronizacion con core legado]] › Preguntas que podría hacer el jurado | sí |
| 3 | 0.843 | [[Transactional Outbox]] › Aplicación a SmartBancs | sí |
| 4 | 0.842 | [[Sincronizacion con core legado]] › Trade-offs | sí |
| 5 | 0.841 | [[Idempotency Keys]] › Aplicación a SmartBancs |  |

### RNF-5 — Stack libre; cada decisión justificada por rendimiento, seguridad y escalabilidad.
Notas mapeadas: Connection Pooling y 10k TPS

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.861 | [[Observabilidad]] › Aplicación a SmartBancs |  |
| 2 | 0.857 | [[MLOps y Data Drift]] › Preguntas que podría hacer el jurado |  |
| 3 | 0.857 | [[Incidentes y Post Mortem]] › Trade-offs |  |
| 4 | 0.856 | [[Incidentes y Post Mortem]] › Cómo se implementa > B. Acciones inmediatas en el escenario de quincena (R3.5d) |  |
| 5 | 0.853 | [[MLOps y Data Drift]] › Trade-offs |  |

### E1 — Documento técnico (arquitectura, decisiones, Bancs, IA, incidente).
Notas mapeadas: (ninguna)

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.867 | [[Incidentes y Post Mortem]] › Aplicación a SmartBancs |  |
| 2 | 0.852 | [[Incidentes y Post Mortem]] › Cómo se implementa > D. Acciones preventivas (R3.6c, R3.6d) |  |
| 3 | 0.850 | [[ETL para IA]] › Aplicación a SmartBancs |  |
| 4 | 0.848 | [[ETL para IA]] › Cómo se implementa |  |
| 5 | 0.848 | [[Incidentes y Post Mortem]] › Qué es |  |

### E2 — Repo GitHub con código, scripts, configuraciones y pruebas.
Notas mapeadas: (ninguna)

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.880 | [[ETL para IA]] › Aplicación a SmartBancs |  |
| 2 | 0.876 | [[Observabilidad]] › Aplicación a SmartBancs |  |
| 3 | 0.865 | [[Incidentes y Post Mortem]] › Cómo se implementa > D. Acciones preventivas (R3.6c, R3.6d) |  |
| 4 | 0.861 | [[CDC con Debezium]] › Trade-offs |  |
| 5 | 0.861 | [[Idempotency Keys]] › Preguntas que podría hacer el jurado |  |

### E3 — Instrucciones: prerrequisitos, instalar, ejecutar, probar, detener.
Notas mapeadas: (ninguna)

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.860 | [[ETL para IA]] › Aplicación a SmartBancs |  |
| 2 | 0.860 | [[MLOps y Data Drift]] › Preguntas que podría hacer el jurado |  |
| 3 | 0.858 | [[Idempotency Keys]] › Preguntas que podría hacer el jurado |  |
| 4 | 0.856 | [[MLOps y Data Drift]] › Cómo se implementa |  |
| 5 | 0.854 | [[Incidentes y Post Mortem]] › Cómo se implementa > D. Acciones preventivas (R3.6c, R3.6d) |  |

### E4 — Evidencias: video, presentación, datos de prueba.
Notas mapeadas: ETL para IA

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.857 | [[ETL para IA]] › Aplicación a SmartBancs | sí |
| 2 | 0.857 | [[Transactional Outbox]] › Preguntas que podría hacer el jurado |  |
| 3 | 0.857 | [[Observabilidad]] › Aplicación a SmartBancs |  |
| 4 | 0.853 | [[Observabilidad]] › Preguntas que podría hacer el jurado |  |
| 5 | 0.851 | [[ETL para IA]] › Cómo se implementa | sí |

### E5 — Declaración de uso de IA en el repo.
Notas mapeadas: (ninguna)

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.869 | [[ETL para IA]] › Aplicación a SmartBancs |  |
| 2 | 0.863 | [[ETL para IA]] › Cómo se implementa |  |
| 3 | 0.862 | [[ETL para IA]] › Cómo se implementa |  |
| 4 | 0.860 | [[ETL para IA]] › Preguntas que podría hacer el jurado |  |
| 5 | 0.858 | [[MLOps y Data Drift]] › Cómo se implementa |  |

### E6 — Defensa: 3 min exposición + 4 min preguntas; correo solo con el enlace.
Notas mapeadas: (ninguna)

| # | score | nota › encabezado | ¿mapeada? |
|---|---|---|---|
| 1 | 0.857 | [[Idempotency Keys]] › Preguntas que podría hacer el jurado |  |
| 2 | 0.857 | [[Transactional Outbox]] › Preguntas que podría hacer el jurado |  |
| 3 | 0.852 | [[Observabilidad]] › Preguntas que podría hacer el jurado |  |
| 4 | 0.852 | [[Observabilidad]] › Cómo se implementa |  |
| 5 | 0.848 | [[ETL para IA]] › Aplicación a SmartBancs |  |
