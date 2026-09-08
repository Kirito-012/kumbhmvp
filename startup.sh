#!/bin/sh
# Azure App Service startup command for Next's standalone output.
#
# Azure's Oryx startup script runs before this one and rewrites the module layout:
#
#   rm -fr /node_modules; mkdir -p /node_modules
#   tar -xzf node_modules.tar.gz -C /node_modules
#   mv -f node_modules _del_node_modules || true
#   ln -sfn /node_modules ./node_modules
#
# Any ./node_modules directory we ship is therefore moved aside and replaced by a
# symlink to Oryx's own tree, which is not ours -- it is whatever Azure last
# repacked, and it does not contain the modules this build traced against.
# ENABLE_ORYX_BUILD=false does not reliably stop this; the script is regenerated
# whenever the platform decides the app needs it.
#
# So the build ships node_modules as app-node-modules.tar.gz instead. Oryx has no
# rule for that name, so it survives untouched, and we unpack it here -- after Oryx
# has finished -- replacing whatever symlink it left behind.
set -e
cd /home/site/wwwroot

if [ ! -f app-node-modules.tar.gz ]; then
  echo "FATAL: app-node-modules.tar.gz missing; the deploy did not ship one." >&2
  ls -la . >&2
  exit 1
fi

# rm -rf clears both a stale directory and an Oryx symlink; -r does not follow the
# symlink's target, so this cannot touch /node_modules itself.
echo "Unpacking bundled node_modules"
rm -rf node_modules _del_node_modules
tar -xzf app-node-modules.tar.gz

if [ ! -d node_modules/next ]; then
  echo "FATAL: node_modules/next missing after unpacking." >&2
  ls -la node_modules >&2 || true
  exit 1
fi

export HOSTNAME=0.0.0.0
echo "Starting standalone server.js"
exec node server.js
