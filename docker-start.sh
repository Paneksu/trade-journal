#!/bin/sh
# Start kontenera: najpierw migracje, potem serwer.
# Gdy migracje padna, kontener sie nie podnosi - lepiej to niz aplikacja
# chodzaca na strukturze bazy, ktorej nie zna.
set -e

echo "Dziennik: uruchamiam migracje"
node scripts/migrate.mjs

echo "Dziennik: startuje serwer"
exec node server.js
