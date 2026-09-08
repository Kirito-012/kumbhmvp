#!/bin/sh
# Azure App Service startup command.
#
# The deployed tree is Next's standalone output (next.config.ts sets
# output:'standalone'), so the entrypoint is a self-contained server.js sitting at
# the root of wwwroot alongside its own pruned node_modules. That sidesteps the two
# things that broke earlier deploys: there is no node_modules/.bin symlink to lose
# in the artifact round trip, and the traced module paths were produced by the same
# build that emitted these files, so they resolve.
set -e
cd /home/site/wwwroot
export HOSTNAME=0.0.0.0
exec node server.js
