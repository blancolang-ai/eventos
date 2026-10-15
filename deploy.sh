#!/bin/sh
# Sube la versión de caché del service worker y publica
set -e
v=$(sed -n "s/.*eventos-v\([0-9]*\).*/\1/p" sw.js); n=$((v+1))
sed -i "s/eventos-v$v/eventos-v$n/" sw.js
git add -A && git commit -m "Deploy v$n" && git push
