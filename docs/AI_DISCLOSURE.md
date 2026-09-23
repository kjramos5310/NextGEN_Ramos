# Declaración de uso de inteligencia artificial

El reto pide indicar qué herramientas de IA se usaron, cómo y en qué componentes. Este documento cubre la IA usada para **construir** la solución. La IA que forma parte del producto (recomendaciones con Gemini y motor de reglas) está en [IA_IMPLEMENTACION_Y_DESPLIEGUE.md](IA_IMPLEMENTACION_Y_DESPLIEGUE.md).

## Resumen

Se usó IA generativa de forma extensa, en dos etapas:

1. **Primera versión del MVP**, con un IDE asistido por IA (Antigravity) y un modelo ligero para scaffolding.
2. **Corrección de la arquitectura**, con un proceso trazable: base de conocimiento, RAG local, análisis de brechas contra el reto, correcciones con pruebas y una segunda revisión con un equipo de agentes. Esta etapa se hizo con Claude Code y todo su rastro está en el repositorio ([ANALISIS_BRECHAS.md](ANALISIS_BRECHAS.md), [revision/](revision/README.md) y el historial de commits).

Las decisiones críticas de diseño son del candidato: arquitectura, modelo de datos, mensajería con RabbitMQ y uso de Gemini. La IA se usó para implementar esas decisiones y para las tareas repetitivas, y escribió la mayor parte del código y de la documentación. El candidato también diseñó el proceso de revisión, decidió qué hallazgos aplicaban y validó cada cambio con pruebas antes de aceptarlo.

## Herramientas

| Herramienta | Para qué se usó |
| :--- | :--- |
| **Antigravity (IDE con Google Gemini)** | Primera versión del MVP: generación de código de backend, ai-service, ETL, frontend y documentación inicial. |
| **Claude Haiku** | Scaffolding repetitivo a partir del diseño de datos del candidato: módulos, controladores, DTOs y entidades de NestJS/TypeORM. |
| **Claude (con búsqueda web)** | Redacción de las 12 notas de referencia de la base de conocimiento a partir del checklist de requisitos definido por el candidato. |
| **Obsidian + `intfloat/multilingual-e5-small` + ChromaDB** | Base de conocimiento ([knowledge-base/](knowledge-base/00-MOC.md)) vectorizada en local para recuperación semántica ([tools/kb-rag/](../tools/kb-rag/README.md)). |
| **Claude Code** | Análisis de brechas con recuperación sobre la base de conocimiento, implementación de las correcciones y de las pruebas, segunda revisión con un equipo de agentes y diagramas Mermaid. |
| **Archify** | Vista de arquitectura de alto nivel a partir de la sección "Entrada para Archify" de [ARQUITECTURA_DIAGRAMAS.md](ARQUITECTURA_DIAGRAMAS.md). |

## Por componente

| Componente | Qué hizo la IA | Qué decidió o validó el candidato |
| :--- | :--- | :--- |
| Arquitectura | Implementación de la arquitectura definida; en la revisión, detección de brechas frente a las referencias (p. ej. outbox documentado pero no implementado). | Diseño de la solución según el reto: microservicios en contenedores, PostgreSQL como núcleo transaccional, RabbitMQ para que la IA no bloquee la transferencia, microservicio de IA con Gemini y respaldo local, integración asíncrona con Bancs. |
| Base de datos | Scaffolding de entidades desde el DDL; en la corrección, tabla `outbox_events`, columna `idempotency_key` e índices únicos parciales. | Modelo de datos original (`accounts`, `transactions`, `ai_recommendations`), restricciones `CHECK`, `NUMERIC(18,2)` e índices; aceptación de los cambios de esquema. |
| Backend transaccional | Primera versión (Antigravity, Haiku); en la corrección, outbox con *publisher confirms*, idempotencia, timeouts y reintentos por SQLSTATE, montos en `NUMERIC`, métricas (Claude Code). | Bloqueo pesimista con orden determinista de cuentas; selección de las brechas a corregir; ejecución de las pruebas. |
| Microservicio de IA | Servicio FastAPI, consumidor RabbitMQ y motor de reglas (Antigravity); reintentos con DLQ, trazabilidad y reescritura de las reglas de respaldo para que solo usen datos reales (Claude Code). | Uso de un LLM alojado con respaldo por reglas; verificación de la API key con `ai-service/scripts/check_gemini.py`. |
| ETL | Script de limpieza y *feature engineering* (Antigravity). | Ejecución y verificación de la salida. |
| Frontend | Componentes de la interfaz (Antigravity); eliminación de valores fijos que aparentaban ser métricas (Claude Code). | Flujo de la demo. |
| Infraestructura | `docker-compose.yml`, healthchecks y configuración de Postgres para diagnóstico; código de Terraform y del pipeline de GitHub Actions (Claude Code). | Despliegue en Google Cloud con Cloud Run, Terraform y CI/CD; topología de servicios y variables de entorno; ejecución de `terraform apply` y configuración del proyecto. |
| Documentación | Redacción del documento técnico, diagramas, README y esta declaración. | Contenido revisado contra el código; lo que es diseño y no está implementado se marca como tal. |

## Proceso de corrección

1. **Checklist del reto** con IDs (R3.1a–R3.6d, RNF-1–5, E1–E6), definido por el candidato.
2. **Base de conocimiento:** 12 notas de referencia redactadas con Claude a partir de fuentes primarias (PostgreSQL, Debezium, microservices.io, Google SRE, Stripe, OpenTelemetry, PgBouncer). Las notas siguen en `estado: borrador`.
3. **RAG local:** fragmentos de hasta 480 tokens vectorizados con `multilingual-e5-small`. La prueba de recuperación da hit@5 = 90 % (37/41 requisitos) ([evidencia](knowledge-base/04-Evidencias/retrieval-smoke-test.md)).
4. **Análisis de brechas** con Claude Code: cada requisito contra el código, con evidencia en `archivo:línea` ([ANALISIS_BRECHAS.md](ANALISIS_BRECHAS.md)).
5. **Correcciones** en commits identificados por brecha (G1–G10).
6. **Segunda revisión con un equipo de agentes** de Claude Code, con roles separados: concurrencia y base de datos, SRE y observabilidad, coherencia entre documentación y código, y diagramas. Sus informes y el estado de cada hallazgo están en [revision/](revision/README.md). Siguió una ronda de correcciones.


## Validación

- `backend`: `npm test` (31 pruebas unitarias) y `npm run test:int` (12 pruebas de concurrencia contra PostgreSQL real).
- `ai-service`: `pytest` (21 pruebas).
- `frontend`: compilación con `tsc` y `vite build`.
- ETL ejecutado con salida verificada.
- Cada cambio se revisó como diff antes de aceptarlo. Generación y verificación se hicieron con herramientas o agentes distintos.
