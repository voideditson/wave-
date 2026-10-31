#!/bin/sh
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
GAME_PASSWORD="${GAME_PASSWORD:-000}" PORT="${PORT:-3000}" node server.js
