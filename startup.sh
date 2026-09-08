#!/bin/sh
# Azure App Service startup command.
#
# The deployed tree is Next's standalone output: server.js at the root of wwwroot
# with its own pruned node_modules beside it.
#
# Oryx rewrites that layout before this script runs:
#
#   mv -f node_modules _del_node_modules || true
#   ln -sfn /node_modules ./node_modules
#
# It parks the standalone node_modules at _del_node_modules and points
# ./node_modules at its own /node_modules, so require('next') from server.js
# resolves into Oryx's tree instead of the one the build produced. Undo that here.
# The real fix is the app setting SCM_DO_BUILD_DURING_DEPLOYMENT=false, which stops
# Oryx running at all; this keeps the app booting whether or not it is set.
set -e
cd /home/site/wwwroot

if [ -d _del_node_modules ] && [ -d _del_node_modules/next ]; then
  echo "Oryx displaced the bundled node_modules; restoring it."
  rm -rf node_modules
  mv _del_node_modules node_modules
fi

if [ ! -d node_modules/next ]; then
  echo "FATAL: bundled node_modules/next is missing from the standalone output." >&2
  ls -la . >&2
  exit 1
fi

export HOSTNAME=0.0.0.0
echo "Starting standalone server.js"
exec node server.js
