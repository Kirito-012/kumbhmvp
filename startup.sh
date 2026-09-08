#!/bin/sh
# Azure App Service startup command.
#
# Do NOT invoke node_modules/.bin/next here: that path is a symlink created by the
# package manager, and it does not reliably survive the GitHub Actions artifact
# round trip. Call Next's real JS entrypoint with node instead.
#
# Oryx rearranges node_modules before this runs: it moves ./node_modules aside to
# ./_del_node_modules and symlinks ./node_modules at /node_modules, which it fills
# by extracting a node_modules.tar.gz that our artifact does not ship. So the
# location of a working tree varies by boot. Find it rather than assuming it.
set -e
cd /home/site/wwwroot

ENTRY=""
for dir in node_modules _del_node_modules /node_modules; do
  if [ -f "$dir/next/dist/bin/next" ]; then
    ENTRY="$dir/next/dist/bin/next"
    break
  fi
done

if [ -z "$ENTRY" ]; then
  echo "FATAL: next entrypoint not found. Searched:" >&2
  for dir in node_modules _del_node_modules /node_modules; do
    echo "  $dir -> $(ls -d "$dir" 2>/dev/null || echo absent)" >&2
  done
  exit 1
fi

# If the real tree got parked under _del_node_modules, put it back so that
# runtime requires (mongoose, pg, ...) resolve from ./node_modules as the build
# traced them.
if [ "$ENTRY" = "_del_node_modules/next/dist/bin/next" ]; then
  echo "Restoring node_modules from _del_node_modules"
  rm -rf node_modules
  mv _del_node_modules node_modules
  ENTRY="node_modules/next/dist/bin/next"
fi

echo "Starting Next from $ENTRY"
exec node "$ENTRY" start --port "${PORT:-8080}"
