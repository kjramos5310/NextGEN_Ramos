#!/bin/sh
# Aplica el esquema y los datos semilla si la base está vacía. Idempotente: si la tabla
# accounts ya existe no hace nada, así el pipeline puede ejecutarlo en cada despliegue.
# Variables: PGHOST (p. ej. /cloudsql/PROYECTO:REGION:INSTANCIA), PGUSER, PGPASSWORD, PGDATABASE.
set -eu

echo "[migrate] conectando a ${PGDATABASE} en ${PGHOST}"
for i in 1 2 3 4 5 6; do
  if psql -tAc 'SELECT 1' >/dev/null 2>&1; then break; fi
  echo "[migrate] base no disponible, reintento $i"
  sleep 5
done

if [ "$(psql -tAc "SELECT to_regclass('public.accounts') IS NOT NULL")" = "t" ]; then
  echo "[migrate] el esquema ya existe, no se aplica nada"
  exit 0
fi

# Extensiones de diagnóstico: no bloquean la migración si el motor no las permite
psql -f /sql/00-observability.sql || echo "[migrate] aviso: no se pudo crear pg_stat_statements"

psql -v ON_ERROR_STOP=1 -1 -f /sql/schema.sql
psql -v ON_ERROR_STOP=1 -1 -f /sql/seed.sql
echo "[migrate] esquema y datos semilla aplicados"
