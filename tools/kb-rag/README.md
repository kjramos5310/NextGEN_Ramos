# kb-rag – RAG local sobre la bóveda de conocimiento

Indexa `docs/knowledge-base/` en **ChromaDB** con embeddings **locales** y permite consultarla. Lo usa la fase 3 (análisis de brechas).

## Instalación
```bash
cd tools/kb-rag
python -m venv .venv
. .venv/bin/activate            # Windows (PowerShell): .venv\Scripts\Activate.ps1
pip install -r requirements.txt
```
La primera ejecución descarga `intfloat/multilingual-e5-small` (~470 MB) de Hugging Face. Después todo funciona offline.

## Uso
```bash
python ingest.py                                   # reindexa (borra y recrea la colección)
python query.py "¿cómo evito deadlocks?" -k 5
python query.py "reintentos" -k 5 --req R3.5c      # solo notas mapeadas a un requisito
python query.py "outbox" --json                    # salida para otros scripts / agentes
python smoke_test.py -k 5                          # regenera 04-Evidencias/retrieval-smoke-test.md
```
**Reindexa cada vez que cambie una nota** (`ingest.py` es idempotente: siempre reconstruye desde cero).

## Decisiones

**Modelo: `intfloat/multilingual-e5-small`** ([ficha](https://huggingface.co/intfloat/multilingual-e5-small))
- Multilingüe (~100 idiomas): la bóveda está en español con términos técnicos en inglés.
- Pequeño (12 capas, 384 dimensiones, ~0,1 B parámetros, licencia MIT): corre en CPU en segundos para ~80 fragmentos.
- Se ejecuta en el mismo proceso Python con `sentence-transformers`, sin servidor aparte.
- Usa los prefijos `query:` / `passage:` que exige el modelo para recuperación asimétrica, y vectores normalizados con distancia coseno.
- Alternativa considerada: `nomic-embed-text` vía Ollama. La etiqueta por defecto (`nomic-embed-text`, v1.5) no declara soporte multilingüe en su ficha de Ollama; la variante multilingüe es [`nomic-embed-text-v2-moe`](https://ollama.com/library/nomic-embed-text-v2-moe) (475 M parámetros, 305 M activos, 512 tokens de entrada). Es mejor candidata si ya usas Ollama con OpenCode: `python ingest.py --backend ollama` (variable `KB_OLLAMA_MODEL` para cambiar el modelo). **No se mezclan backends**: `query.py` usa siempre el backend con el que se indexó (queda guardado en la colección).

**Chunking: por encabezado markdown, ≤ 480 tokens, solapamiento 64**
- Cada sección (`##`, `###`) es la unidad semántica natural de las notas (Qué es / Cómo se implementa / …). Se parte por encabezado y solo se subdivide si excede el límite.
- **480 y no 500**: e5 trunca a 512 tokens, y cada fragmento lleva el prefijo `passage:` y la ruta `Nota > Encabezado`. Con 480 medidos con el tokenizador del modelo nada se trunca en silencio.
- Solapamiento de ~64 tokens (~13 %) solo al subdividir una sección larga, para no cortar una idea entre dos fragmentos. Los cortes respetan párrafos, ítems de lista, filas de tabla y bloques de código.
- Metadatos por fragmento: `nota`, `ruta`, `encabezado`, `requisitos`, `fuentes`, `tags`, `estado`, más una bandera `req_<ID>` por requisito para filtrar (`--req`).
- Se indexan `02-Referencias` y `03-Decisiones`. El checklist y el MOC se excluyen porque repiten el texto de los requisitos y ganarían todas las consultas. `04-Evidencias` también se excluye, para no indexar la propia salida. Se puede cambiar con `--dirs`.

**k = 5**
- Cada requisito está mapeado a entre 1 y 5 notas, y una nota tiene ~6–9 fragmentos. Con k = 5 suele aparecer la nota principal y 1–2 relacionadas, en unos 2 000 tokens de contexto. Es suficiente para que Claude compare sin llenar la ventana con ruido.
- `smoke_test.py` mide **hit@k** (¿aparece en el top-k alguna nota mapeada al requisito?) para poder recalibrar k con datos.

## Backend `test-hashing`
Es una bolsa de n-gramas de caracteres, **no semántica**. Sirve solo para probar el pipeline sin red (CI, entornos sin acceso a Hugging Face). `smoke_test.py` se niega a escribir la evidencia oficial con este backend.

## Archivos
| Archivo | Rol |
|---|---|
| `kbrag.py` | Lectura de notas, chunking y backends de embeddings |
| `ingest.py` | Construye el índice en `.chroma/` (ignorado por git) |
| `query.py` | Consulta por línea de comandos o como módulo (`search()`) |
| `smoke_test.py` | Una consulta por requisito → `04-Evidencias/retrieval-smoke-test.md` |
