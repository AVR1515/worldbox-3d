#!/usr/bin/env bash
# Instala dependencias y genera worldbox3d-hostinger.zip
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Instala Node.js 20+ desde https://nodejs.org"; exit 1; }
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm run package:hostinger
echo
echo "Listo. Sube worldbox3d-hostinger.zip a Hostinger (Administrador de archivos > public_html > Extraer)."
