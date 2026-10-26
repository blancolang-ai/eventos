#!/bin/sh
# Publica una nueva versión (semver; ./deploy.sh [patch|minor|major|none], por defecto patch; 'none' publica la versión ya fijada en sw.js sin subirla): comprueba, prueba, sube la versión de caché y hace commit SOLO de los archivos de versión.
# Los cambios de código deben estar ya confirmados (commit) antes de desplegar.
set -eu
bump=${1:-patch}
case "$bump" in patch|minor|major|none) ;; *) echo "Uso: ./deploy.sh [patch|minor|major|none]" >&2; exit 1 ;; esac
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
v=$(sed -n "s/.*'eventos-v\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)'.*/\1/p" sw.js)
[ -n "$v" ] || { echo "No encuentro la versión X.Y.Z en sw.js" >&2; exit 1; }
if [ "$bump" = none ]; then
  grep -q "app.js?v=$v\"" index.html && grep -q "content=\"$v\"" index.html && grep -q "^Versión: $v " README.md || { echo "index.html/README.md no coinciden con v$v" >&2; exit 1; }
  git rev-parse -q --verify "refs/tags/v$v" >/dev/null && { echo "La etiqueta v$v ya existe" >&2; exit 1; }
  git tag -a "v$v" -m "Versión $v"
  git push origin main "v$v"
  echo "Publicada v$v (sin subir versión)"; exit 0
fi
IFS=. read -r ma mi pa <<EOV
$v
EOV
case "$bump" in
  major) n="$((ma+1)).0.0" ;;
  minor) n="$ma.$((mi+1)).0" ;;
  patch) n="$ma.$mi.$((pa+1))" ;;
esac
restore() { git checkout -- sw.js index.html README.md; }
trap 'echo "Fallo: restauro sw.js, index.html y README.md" >&2; restore' EXIT
sed -i "s/'eventos-v$v'/'eventos-v$n'/" sw.js
sed -i "s/\(style\.css\|app\.js\)?v=[0-9.]*\"/\1?v=$n\"/g; s/name=\"app-version\" content=\"[0-9.]*\"/name=\"app-version\" content=\"$n\"/" index.html
sed -i "s/^Versión: [0-9.]* /Versión: $n /" README.md
grep -q "'eventos-v$n'" sw.js && grep -q "app.js?v=$n\"" index.html && grep -q "style.css?v=$n\"" index.html && grep -q "content=\"$n\"" index.html && grep -q "^Versión: $n " README.md
git add -- sw.js index.html README.md
git commit -q -m "Deploy v$n"
trap - EXIT
git push origin main
echo "Publicada v$n"
