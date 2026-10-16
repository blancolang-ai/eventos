#!/bin/sh
# Publica una nueva versión: comprueba, prueba, sube la versión de caché y hace commit SOLO de los archivos de versión.
# Los cambios de código deben estar ya confirmados (commit) antes de desplegar.
set -eu
cd "$(dirname "$0")"
branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = main ] || { echo "Rama '$branch': despliega desde main" >&2; exit 1; }
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Hay cambios sin confirmar; haz commit antes de desplegar:" >&2; git status --short >&2; exit 1
fi
git fetch -q origin main
[ "$(git rev-list --count HEAD..origin/main)" = 0 ] || { echo "origin/main tiene commits que no tienes: haz pull" >&2; exit 1; }
port=${EVENTOS_PORT:-4317}
if python3 -c "import socket,sys;s=socket.socket();sys.exit(0 if s.connect_ex(('127.0.0.1',$port))==0 else 1)"; then echo "Puerto $port ocupado: ciérralo para probar esta carpeta" >&2; exit 1; fi
npx playwright test
v=$(sed -n "s/.*eventos-v\([0-9][0-9]*\).*/\1/p" sw.js)
[ -n "$v" ] || { echo "No encuentro la versión en sw.js" >&2; exit 1; }
n=$((v+1))
restore() { git checkout -- sw.js index.html; }
trap 'echo "Fallo: restauro sw.js e index.html" >&2; restore' EXIT
sed -i "s/eventos-v$v/eventos-v$n/" sw.js
sed -i "s/\(style\.css\|app\.js\)?v=[0-9][0-9]*/\1?v=$n/g" index.html
grep -q "eventos-v$n" sw.js && grep -q "app.js?v=$n" index.html && grep -q "style.css?v=$n" index.html
git add -- sw.js index.html
git commit -q -m "Deploy v$n"
trap - EXIT
git push origin main
echo "Publicada v$n"
