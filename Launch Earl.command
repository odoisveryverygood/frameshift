#!/bin/zsh
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 22 or newer, then run this file again.'
  read '?Press Return to close.'
  exit 1
fi
if [ ! -d node_modules ]; then npm ci; fi
npm run build
printf '\nOpen http://127.0.0.1:4310 in your browser.\n\n'
npm start
