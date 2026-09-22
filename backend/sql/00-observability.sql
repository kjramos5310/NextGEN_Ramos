-- Extensiones de diagnóstico (R3.5a). Requiere shared_preload_libraries=pg_stat_statements
-- (configurado en docker-compose.yml).
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Consultas de diagnóstico para el runbook del incidente de quincena:
--
-- 1) Top consultas por tiempo total:
--    SELECT calls, round(mean_exec_time::numeric,2) AS mean_ms, round(total_exec_time::numeric,2) AS total_ms, query
--      FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;
--
-- 2) Quién bloquea a quién (consulta exacta de ambos lados):
--    SELECT blocked.pid AS blocked_pid, blocked.query AS blocked_query,
--           blocking.pid AS blocking_pid, blocking.query AS blocking_query,
--           now() - blocked.query_start AS waiting_for
--      FROM pg_stat_activity blocked
--      JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS b(pid) ON true
--      JOIN pg_stat_activity blocking ON blocking.pid = b.pid;
--
-- 3) Acción inmediata: terminar la sesión que retiene el lock
--    SELECT pg_terminate_backend(<blocking_pid>);
