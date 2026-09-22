---
tags: [requisitos, checklist]
fuente: "Reto_Tecnico_NextGen_Enginner Final.docx"
estado: borrador
---

# Reto TCS – Checklist de requisitos

Fuente única de verdad para el análisis de brechas. Cada ítem es verificable (P = práctico/código, T = teórico/documento). Todas las notas de [[00-MOC]] se mapean a estos IDs.

## 3.1 Infraestructura, BD y backend (P)
- [ ] **R3.1a** Microservicio REST o gRPC con endpoint que recibe una transacción financiera.
- [ ] **R3.1b** Scripts DDL que crean las tablas necesarias.
- [ ] **R3.1c** Scripts DML (datos semilla / prueba).
- [ ] **R3.1d** El microservicio interactúa realmente con la BD.
- [ ] **R3.1e** Concurrencia correcta sin *race conditions*, demostrada con prueba concurrente.
- [ ] **R3.1f** IaC que levanta backend + BD con un solo comando.

## 3.2 Bancs: sincronización y datos
- [ ] **R3.2a** (T) Flujo de datos app ↔ Bancs.
- [ ] **R3.2b** (T) Actualización de saldos sin saturar Bancs.
- [ ] **R3.2c** (P) Script ETL/ELT sobre un lote de transacciones crudas.
- [ ] **R3.2d** (P) Manejo de valores nulos.
- [ ] **R3.2e** (P) Estandarización de formatos.
- [ ] **R3.2f** (P) Salida estructurada, optimizada para análisis o consumo por IA.

## 3.3 Inteligencia Artificial
- [ ] **R3.3a** (P) Servicio de IA independiente o mock avanzado funcional.
- [ ] **R3.3b** (P) Consumo asíncrono / no bloqueante desde el microservicio principal.
- [ ] **R3.3c** (P) Evidencia de que la IA no afecta la latencia de la transacción.
- [ ] **R3.3d** (T) Ciclo de vida: ingesta de datos nuevos / reentrenamiento.
- [ ] **R3.3e** (T) Monitoreo de *data drift*.
- [ ] **R3.3f** (T) Gestión del consumo de recursos.

## 3.4 Observabilidad
- [ ] **R3.4a** (P) Log de transacciones procesadas con éxito.
- [ ] **R3.4b** (P) Log de errores y excepciones.
- [ ] **R3.4c** (P) Log de llamadas al servicio de IA.
- [ ] **R3.4d** (P) Log de interacciones con la BD.
- [ ] **R3.4e** (P) Métrica de volumen transaccional.
- [ ] **R3.4f** (P) Métrica de errores.
- [ ] **R3.4g** (P) Métrica de tiempos de respuesta (latencia).
- [ ] **R3.4h** (P) Trazabilidad de una transacción entre componentes.
- [ ] **R3.4i** (T) Qué señales detectan rendimiento degradado o fallos.
- [ ] **R3.4j** (T) Justificación de la utilidad de cada dato.

## 3.5 Incidente de quincena (latencia, timeouts de BD, deadlocks)
- [ ] **R3.5a** (P) Logs/métricas que identifican la consulta o proceso exacto del cuello de botella.
- [ ] **R3.5b** (P) Ídem para *timeouts* de conexión con la BD.
- [ ] **R3.5c** (P) Ídem para *deadlocks*.
- [ ] **R3.5d** (T) Acciones inmediatas: matar conexiones bloqueadas, ajustar red, balancear carga.

## 3.6 Gestión de incidentes
- [ ] **R3.6a** (T) Estructura del informe post mortem.
- [ ] **R3.6b** (T) Proceso de escalamiento.
- [ ] **R3.6c** (T) Acciones preventivas de infraestructura.
- [ ] **R3.6d** (T) Acciones preventivas de código.

## Restricciones no funcionales
- [ ] **RNF-1** Picos de 10 000 TPS.
- [ ] **RNF-2** Transferencias < 2 s.
- [ ] **RNF-3** La IA no bloquea ni retrasa el flujo transaccional.
- [ ] **RNF-4** Bancs no admite alto volumen de consultas directas.
- [ ] **RNF-5** Stack libre; cada decisión justificada por rendimiento, seguridad y escalabilidad.

## Entregables
- [ ] **E1** Documento técnico (arquitectura, decisiones, Bancs, IA, incidente).
- [ ] **E2** Repo GitHub con código, scripts, configuraciones y pruebas.
- [ ] **E3** Instrucciones: prerrequisitos, instalar, ejecutar, probar, detener.
- [ ] **E4** Evidencias: video, presentación, datos de prueba.
- [ ] **E5** Declaración de uso de IA en el repo.
- [ ] **E6** Defensa: 3 min exposición + 4 min preguntas; correo solo con el enlace.
