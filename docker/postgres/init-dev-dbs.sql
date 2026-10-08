-- Runs only on first Postgres volume init (docker-entrypoint-initdb.d).
-- Existing volumes are not re-initialized — create DBs manually if upgrading:
--   docker exec -it forgeops-postgres psql -U postgres -c 'CREATE DATABASE forgeops_dev;'
--   docker exec -it forgeops-postgres psql -U postgres -c 'CREATE DATABASE forgeops_test;'

CREATE DATABASE forgeops_test;
