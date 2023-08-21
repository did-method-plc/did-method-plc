#!/usr/bin/env sh

# Example usage:
# ./with-test-db.sh psql postgresql://pg:password@localhost:5433/postgres -c 'select 1;'

dir=$(dirname $0)
compose_file="$dir/docker-compose.yaml"

docker compose -f $compose_file up --wait --force-recreate db_test
echo # newline

docker compose -f $compose_file up --wait --force-recreate redis_test
echo # newline

trap on_sigint INT
on_sigint() { 
  echo # newline
  docker compose -f $compose_file rm -f --stop --volumes db_test
  exit $?
}

# Based on creds in compose.yaml
export PGPORT=5433
export PGHOST=localhost
export PGUSER=pg
export PGPASSWORD=password
export PGDATABASE=postgres
export DATABASE_URL="postgresql://pg:password@localhost:5433/postgres"
export REDIS_HOST="127.0.0.1"
export REDIS_PORT=6380
"$@"
code=$?

echo # newline
docker compose -f $compose_file rm -f --stop --volumes db_test

echo # newline
docker compose -f $compose_file rm -f --stop --volumes redis_test

exit $code
