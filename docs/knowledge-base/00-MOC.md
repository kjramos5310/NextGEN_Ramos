---
tags: [moc]
estado: borrador
---

# SmartBancs – Mapa de contenido

Bóveda de investigación del reto técnico TCS "SmartBancs App". Se construyó **después** de la primera versión del MVP, para contrastarlo contra requisitos y referencias trazables (ver [análisis de brechas](../ANALISIS_BRECHAS.md)).

**Proceso:** 0) MVP v1 → 1) bóveda → 2) RAG local (`tools/kb-rag`) → 3) retrieve + análisis de brechas → 4) correcciones del MVP por brecha → 5) revisión con equipo de agentes ([informes](../revision/README.md)) + [diagramas](../ARQUITECTURA_DIAGRAMAS.md).

## Requisitos
- [[Reto TCS - Checklist]]: requisitos R3.1a–R3.6d, RNF-1–5 y E1–E6. Contra esta nota se compara todo.
- Enunciado literal: `docs/reto/reto-original.md`.

## Referencias
| Nota | Requisitos principales |
|---|---|
| [[Transactional Outbox]] | R3.1e, R3.2a–b, R3.3b, RNF-3, RNF-4 |
| [[CDC con Debezium]] | R3.2a–b, RNF-4 |
| [[Sincronizacion con core legado]] | R3.2a–b, RNF-1, RNF-4 |
| [[Concurrencia en PostgreSQL]] | R3.1b, R3.1e, R3.5a–d, R3.6d |
| [[Idempotency Keys]] | R3.1a, R3.1e, R3.2b, R3.6d |
| [[Connection Pooling y 10k TPS]] | R3.1f, R3.5b, R3.5d, R3.6c, RNF-1, RNF-2 |
| [[Mensajeria asincrona y DLQ]] | R3.2a–b, R3.3a–b, RNF-3, RNF-4 |
| [[Resiliencia - timeouts reintentos y circuit breaker]] | R3.3b–c, R3.5d, R3.6d, RNF-2, RNF-3 |
| [[ETL para IA]] | R3.2c–f, R3.3d |
| [[MLOps y Data Drift]] | R3.3a, R3.3d–f |
| [[Observabilidad]] | R3.4a–j, R3.5a–c |
| [[Incidentes y Post Mortem]] | R3.5a–d, R3.6a–d |

El mapeo exacto está en el frontmatter `requisitos:` de cada nota. Es la fuente que usa el RAG.

## Recorrido sugerido por flujo
1. **Transferencia síncrona (< 2 s):** [[Idempotency Keys]] → [[Concurrencia en PostgreSQL]] → [[Connection Pooling y 10k TPS]] → [[Transactional Outbox]]
2. **Asíncrono (IA y Bancs):** [[Mensajeria asincrona y DLQ]] → [[Resiliencia - timeouts reintentos y circuit breaker]] → [[Sincronizacion con core legado]] / [[CDC con Debezium]]
3. **Datos e IA:** [[ETL para IA]] → [[MLOps y Data Drift]]
4. **Operación:** [[Observabilidad]] → [[Incidentes y Post Mortem]]

## Decisiones
- `03-Decisiones/`: carpeta prevista para ADR; todavía no tiene ninguno.

## Evidencias
- `04-Evidencias/retrieval-smoke-test.md`: prueba del RAG con una consulta por requisito.

## Estados
`borrador` → el autor lee, corrige y cambia a `revisada`. Ninguna nota se considera defendible hasta estar `revisada`.
