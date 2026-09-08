#!/bin/sh
# Azure App Service startup command.
#
# Do NOT invoke node_modules/.bin/next here: that path is a symlink created by the
# package manager, and it does not reliably survive the GitHub Actions artifact
# round trip (zip drops symlinks and the executable bit). Call Next's real JS
# entrypoint with node instead, which needs neither.
cd /home/site/wwwroot
exec node node_modules/next/dist/bin/next start --port "${PORT:-8080}"
