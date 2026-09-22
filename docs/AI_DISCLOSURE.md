# Declaración del Uso de Inteligencia Artificial en el Desarrollo

De conformidad con los requisitos de entrega del **Reto Técnico NextGen Engineer**, se detalla a continuación el uso de herramientas de Inteligencia Artificial durante el **proceso de desarrollo** de la solución SmartBancs App.

> **Nota:** Este documento se refiere exclusivamente a las herramientas de IA empleadas para **construir** el proyecto. La funcionalidad de IA integrada en la aplicación (microservicio de recomendaciones financieras) se documenta en el archivo [DOCUMENTO_TECNICO.md](./DOCUMENTO_TECNICO.md) y [IA_IMPLEMENTACION_Y_DESPLIEGUE.md](./IA_IMPLEMENTACION_Y_DESPLIEGUE.md).

---

## 1. Herramientas de IA Utilizadas

| Herramienta | Tipo | Contexto de Uso |
| :--- | :--- | :--- |
| **Google Gemini (Antigravity IDE)** | Asistente de codificación con LLM | Pair programming, generación de código base, scaffolding de módulos y documentación inicial. |
| **Claude (Opus)** | Auditoría y revisión de código/documentación con LLM | Revisión crítica de consistencia, detección de brechas en observabilidad y post-mortem, validación del disclosure de IA. |

---

## 2. Actividades y Componentes donde se Empleó IA Generativa

### 2.1. Diseño Arquitectónico
- **Uso:** Validación y comparación de patrones de concurrencia bancaria (Pessimistic Locking con orden determinista vs. Optimistic Locking con `@VersionColumn`), selección del patrón *Transactional Outbox* para la integración con el core Bancs.
- **Aporte del candidato:** La decisión final de implementar el ordenamiento lexicográfico de cuentas para prevenir deadlocks fue tomada tras comprender las condiciones de Coffman y validar el comportamiento con la simulación de quincena implementada.

### 2.2. Backend NestJS (Código Fuente)
- **Uso:** Aceleración en la generación del scaffolding de módulos, entidades TypeORM (DTOs, entities), interceptores de logging, middleware de correlation ID y configuración de métricas Prometheus.
- **Aporte del candidato:** Toda la lógica transaccional ACID (bloqueo pesimista ordenado, validación de saldos, rollback ante excepciones) fue revisada línea por línea, compilada y probada para asegurar la consistencia financiera.

### 2.3. Microservicio de IA (Python FastAPI)
- **Uso:** Generación del esqueleto del servicio FastAPI, el consumidor de RabbitMQ y las reglas de clasificación financiera del motor de recomendaciones.
- **Aporte del candidato:** Las reglas de negocio del `advisor.py` (umbrales de gasto, scoring de inversión, alertas de fraude) fueron diseñadas y calibradas según los perfiles de las cuentas bancarias de prueba.

### 2.4. Pipeline ETL (Python Pandas)
- **Uso:** Generación del script de transformación y limpieza de datos, incluyendo la lógica de manejo de formatos de fecha heterogéneos y feature engineering.
- **Aporte del candidato:** El dataset crudo `bancs_raw_transactions.csv` fue diseñado intencionalmente con anomalías representativas de un core legado real (nulos, duplicados, formatos de fecha mixtos, montos con símbolos de moneda). La ejecución fue validada localmente con resultado exitoso (9/12 registros válidos).

### 2.5. Frontend React
- **Uso:** Aceleración en la construcción de componentes de interfaz (panel de cuentas, modal de transferencias, feed de IA, consola de operaciones).
- **Aporte del candidato:** Las decisiones de experiencia de usuario (UX) —agrupación de paneles, flujo de simulación del incidente con métricas p95 en vivo, comparador visual ETL Raw vs. Cleaned— fueron definidas por el candidato.

### 2.6. Infraestructura y Docker Compose
- **Uso:** Generación del `docker-compose.yml` con la orquestación de 7 servicios, configuraciones de health checks y volúmenes.
- **Aporte del candidato:** Validación de la topología de red, orden de dependencias y configuración de variables de entorno para todos los servicios.

### 2.7. Documentación Técnica
- **Uso:** Asistencia en la estructuración y redacción del documento técnico, del reporte post-mortem y de este mismo disclosure.
- **Aporte del candidato:** Todos los contenidos técnicos (diagramas de arquitectura, justificaciones de stack, descripción del incidente simulado, plan de acciones preventivas) reflejan las decisiones y el entendimiento del candidato sobre el problema planteado.

---

## 3. Criterio de Supervisión y Validación Humana

Todo el código generado con asistencia de IA fue sometido a los siguientes controles antes de la entrega:

1. **Compilación y Build exitosos:** Tanto `backend` (NestJS, 0 errores TypeScript) como `frontend` (React/Vite, 0 errores) compilan correctamente.
2. **Ejecución funcional del ETL:** El script `etl_bancs_processor.py` fue ejecutado y produjo salida limpia verificada.
3. **Revisión de lógica crítica:** La lógica de concurrencia transaccional (locks pesimistas ordenados, validación de fondos, commit/rollback) fue revisada y entendida en su totalidad para garantizar la ausencia de condiciones de carrera y sobregiros.
4. **Coherencia arquitectónica:** Todas las decisiones de diseño (RabbitMQ como broker, desacoplamiento asíncrono de IA, Transactional Outbox para Bancs) fueron comprendidas y pueden ser defendidas durante la exposición.
5. **Auditoría con segundo modelo (Claude Opus):** Se empleó un segundo modelo de IA como auditor independiente del código y la documentación generados, con el fin de detectar inconsistencias, omisiones y afirmaciones no verificables antes de la entrega final. Las brechas detectadas (sección teórica de observabilidad faltante, post-mortem sin línea de tiempo, AI Disclosure sin herramientas específicas) fueron corregidas por el candidato tras validar la pertinencia técnica de cada observación. Este proceso de **generación + auditoría** con herramientas distintas constituye una buena práctica de ingeniería de software (separación de generación y verificación).
