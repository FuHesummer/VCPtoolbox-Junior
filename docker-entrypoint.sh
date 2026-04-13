#!/bin/sh
# docker-entrypoint.sh
# Reads docker-persist.json, syncs /opt/defaults → data/ volume → app symlinks.
set -e

APP_DIR="/usr/src/app"
DATA_DIR="$APP_DIR/data"
DEFAULTS_DIR="/opt/defaults"

# If data/ is not a mount point (no volume), skip sync and run directly
if [ ! -d "$DATA_DIR" ]; then
    echo "[entrypoint] No data/ volume detected, running with image defaults."
    exec "$@"
fi

# Use node to do the heavy lifting (JSON parse + fs ops)
node "$APP_DIR/build/docker-sync.js"

exec "$@"
