<!-- Extraído con pandoc de "Reto_Tecnico_NextGen_Enginner Final.docx" (texto literal, sin editar). -->

# Reto Técnico de Evaluación: Arquitectura, Desarrollo Práctico, Operación, IA y Observabilidad

## 1. Objetivo y Condiciones de la Evaluación

El presente documento define un caso práctico integral diseñado para evaluar las capacidades de diseño arquitectónico, desarrollo de software, observabilidad, resolución de problemas y toma de decisiones técnicas del candidato.

**Condiciones del Reto:**

- **Tecnológicamente agnóstico:** No se imponen lenguajes, motores de bases de datos, sistemas operativos, herramientas de automatización ni proveedores de nube. El candidato tiene total libertad para elegir el stack tecnológico, pero **deberá justificar cada decisión** con base en el rendimiento, la seguridad y la escalabilidad del caso de uso.

- **Enfoque práctico obligatorio (MVP):** Además del documento de diseño, **es requisito indispensable entregar un repositorio de código** (p. ej., GitHub o GitLab) con un prototipo funcional (MVP). Este debe contener el código fuente de los servicios requeridos, los scripts de infraestructura y las configuraciones necesarias para demostrar la viabilidad de la solución de forma práctica y ejecutable.

## 2. Escenario Hipotético: Proyecto "SmartBancs App"

**Contexto del negocio:** Una institución financiera requiere construir "SmartBancs App", una plataforma orientada a procesar transacciones en tiempo real y ofrecer recomendaciones financieras personalizadas impulsadas por inteligencia artificial.

**Desafíos y restricciones del sistema:**

- **Alta concurrencia:** La aplicación debe soportar picos transaccionales elevados (p. ej., 10 000 transacciones por segundo).

- **Integración con el core legado (Bancs):** El sistema central del banco ("Bancs") es un sistema transaccional heredado, robusto pero poco flexible, que no puede recibir un alto volumen de consultas directas sin que su rendimiento se degrade.

- **Tiempo de respuesta:** Las transferencias deben completarse en menos de 2 segundos. Las recomendaciones de IA no deben bloquear ni retrasar el flujo transaccional principal.

## 3. Entregables del Reto

El candidato deberá completar y cargar la solución **hasta el domingo 20 a las 23:00**. Para la defensa, dispondrá de **3 minutos para la exposición** y **4 minutos para responder a las preguntas del jurado**.

### Contenido obligatorio de la entrega

- **Documento técnico:** Arquitectura, decisiones técnicas, integración con Bancs, manejo del modelo de IA y respuesta al incidente simulado.

- **Repositorio en GitHub:** Código fuente, scripts, configuraciones, pruebas y archivos necesarios para ejecutar el MVP.

- **Instrucciones:** Prerrequisitos y pasos para instalar, ejecutar, probar y detener la solución.

- **Evidencias:** Video demostrativo, material de presentación y datos de prueba utilizados.

  - **Declaración del uso de inteligencia artificial:** Si se utilizó IA en el desarrollo de cualquier parte del reto, el candidato deberá indicar las herramientas empleadas, cómo se utilizaron y en qué componentes, actividades o entregables se aplicaron. **Esta información deberá incluirse en el repositorio de GitHub.**

- **Correo de finalización:** Debe enviarse antes del domingo 20 a las 23:00 e incluir únicamente el enlace del repositorio de GitHub. El candidato debe verificar previamente que el enlace y sus permisos permitan la revisión.

### 

### 3.1. Infraestructura, Base de Datos y Desarrollo del Backend (Práctico)

- **Desarrollo del Servicio:** Programar un microservicio básico (API REST o gRPC) que exponga un endpoint para recibir una transacción financiera.

- **Base de datos:** Implementar los scripts DDL/DML para crear las tablas necesarias. El código del microservicio debe interactuar con la base de datos, manejar correctamente la concurrencia y evitar condiciones de carrera (*race conditions*).

- **Automatización (IaC):** Entregar un script de infraestructura como código (p. ej., Dockerfile, Docker Compose, Terraform o manifiestos de Kubernetes) que permita levantar el entorno de desarrollo del backend y la base de datos con un solo comando.

### 3.2. Bancs: Manejo, Utilización e Integración de Datos (Teórico-Práctico)

- **Estrategia de sincronización (teórico):** Diseñar en el documento el flujo de datos entre la nueva aplicación y el core legado "Bancs", detallando cómo se actualizarían los saldos sin saturar el sistema legado.

- **Transformación de datos (práctico en código):** Implementar un script (p. ej., en Python, SQL u otra herramienta de procesamiento) que simule un pequeño proceso de transformación (ETL/ELT). El código debe tomar un lote de datos transaccionales sin procesar, limpiarlos (p. ej., mediante el manejo de valores nulos y la estandarización de formatos) y estructurarlos en un formato optimizado para su análisis o consumo por la IA.

### 3.3. Inteligencia Artificial: Implementación y Despliegue (Práctico)

- **Integración en código:** Desarrollar un servicio independiente (o un mock avanzado y funcional) de la API de IA. Demostrar, en el código del microservicio principal, cómo se consume esta IA de forma asíncrona o no bloqueante para no afectar el tiempo de procesamiento de la transacción.

- **Manejo del modelo (teórico):** Describir el ciclo de vida del modelo en producción: cómo se alimenta con nuevos datos, cómo se monitorea el *data drift* y cómo se gestiona el consumo de recursos.

### 3.4. Observabilidad (Teórico-Práctico)

- **Instrumentación y Telemetría (Práctico):** Configurar mecanismos básicos de observabilidad en la solución desarrollada que permitan comprender el comportamiento de la aplicación y facilitar el diagnóstico de incidentes.

Como mínimo, la solución deberá registrar:

- Registros de las operaciones críticas del sistema: procesamiento exitoso de transacciones, errores y excepciones, llamadas al servicio de IA e interacciones con la base de datos.

- Métricas relacionadas con el volumen transaccional, errores y tiempos de respuesta.

- Información que permita rastrear una transacción a través de los componentes implementados.

<!-- -->

- **Diseño de observabilidad (teórico):** Definir qué información se utilizaría para identificar problemas de rendimiento, degradación del servicio o fallos en la solución propuesta, y justificar la utilidad de los datos seleccionados.

### 3.5. Operaciones: Incidente Crítico Simulado (Teórico-Práctico)

**Escenario:** Durante un pico transaccional de quincena, los usuarios reportan que las transferencias no se completan. El sistema de monitoreo alerta sobre un incremento severo en la **latencia** de las peticiones, múltiples errores de **timeout** en la conexión con la base de datos y posibles bloqueos mutuos (**deadlocks**) en las tablas principales.

- **Monitoreo (práctico en código):** Configurar registros de actividad claros y métricas en el código desarrollado que permitan identificar rápidamente la consulta o el proceso exacto que causa el cuello de botella, el *timeout* o el *deadlock*.

- **Acciones inmediatas (teórico):** Definir acciones rápidas —soluciones temporales, como finalizar conexiones bloqueadas, ajustar configuraciones de red o balancear cargas— para estabilizar el sistema y evitar que los usuarios continúen afectados.

### 3.6. Operaciones: Gestión de Incidentes TI (Teórico)

- **Escalamiento y post mortem:** Plantear la estructura del informe post mortem y definir qué acciones preventivas se sugerirían en los ámbitos de infraestructura y código para evitar que el escenario simulado se repita.
