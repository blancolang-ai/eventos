#!/bin/sh
# Sube la versión de caché del service worker (y de los assets en index.html) y publica
set -e
v=$(sed -n "s/.*eventos-v\([0-9]*\).*/\1/p" sw.js); n=$((v+1))
sed -i "s/eventos-v$v/eventos-v$n/" sw.js
sed -i "s/\(style\.css\|app\.js\)?v=[0-9]*/\1?v=$n/g" index.html
git add -A && git commit -m "Deploy v$n" && git push
