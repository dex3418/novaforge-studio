#!/bin/sh
# Starts the Novaforge Studio box and opens it in your browser (Termux).
cd "$(dirname "$0")" || exit 1
( sleep 1; command -v termux-open-url >/dev/null 2>&1 && termux-open-url http://localhost:8787 ) &
exec node server.js
