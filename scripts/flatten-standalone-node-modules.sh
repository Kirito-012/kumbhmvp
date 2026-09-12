#!/bin/sh
# Flatten Next's standalone node_modules so it resolves without pnpm's store layout.
#
# Next's tracer emits some packages as a top-level STUB: node_modules/<pkg>/ holding
# only package.json, with the real files left at .pnpm/<pkg>@<ver>/node_modules/<pkg>/.
# There is no Node fallback that bridges those two. For a deep subpath require like
#
#   require('@swc/helpers/cjs/_interop_require_default.cjs')
#
# Node finds the FIRST @swc/helpers on the lookup path -- the stub -- resolves the
# subpath against its "exports" map, finds no file, and throws MODULE_NOT_FOUND
# (createEsmNotFoundErr/resolveExports, reporting path .../node_modules/@swc/helpers).
# The stub SHADOWS the real copy; Node never walks on to .pnpm/.
#
# ~40 packages ship this way (bson, pg-types, nanoid, sharp, ...); @swc/helpers is
# just the one required earliest at boot. So replace every stub with the real
# directory rather than special-casing whichever one crashed last.
#
# The stub's package.json pins the exact version, which is what makes this safe:
# several packages exist at multiple versions in the store (bson 6.10.4 and 7.3.1),
# and picking the wrong one would swap a major version under the driver. Match the
# pinned version exactly and refuse to guess if that is ever ambiguous.
set -e

NM="${1:?usage: flatten-standalone-node-modules.sh <path-to-node_modules>}"

# Every top-level package dir: plain names, plus one level inside each @scope.
list_pkg_dirs() {
  find "$NM" -mindepth 1 -maxdepth 1 -type d ! -name '.pnpm' -exec sh -c '
    for d; do
      case "${d##*/}" in
        @*) find "$d" -mindepth 1 -maxdepth 1 -type d ;;
         *) echo "$d" ;;
      esac
    done' _ {} +
}

# A stub is a package dir whose only file is package.json.
is_stub() {
  [ -f "$1/package.json" ] && [ "$(find "$1" -type f | wc -l)" -eq 1 ]
}

list_pkg_dirs | while read -r top; do
  is_stub "$top" || continue

  rel=${top#"$NM"/}
  ver=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$top/package.json" | head -1)
  if [ -z "$ver" ]; then
    echo "FATAL: stub $rel has no version in package.json; cannot pick a .pnpm copy." >&2
    exit 1
  fi

  # Store dirs encode scoped names with '+' (@swc/helpers -> @swc+helpers) and may
  # carry a peer-dep hash (pg-pool@3.14.0_pg@8.23.0).
  enc=$(echo "$rel" | tr '/' '+')
  real=""
  for cand in "$NM/.pnpm/$enc@$ver" "$NM/.pnpm/$enc@${ver}_"*; do
    [ -d "$cand/node_modules/$rel" ] || continue
    if [ -n "$real" ]; then
      echo "FATAL: stub $rel@$ver matches multiple .pnpm dirs; refusing to guess." >&2
      exit 1
    fi
    real="$cand/node_modules/$rel"
  done
  # No copy at the pinned version, or the pinned copy is itself content-free.
  #
  # This is NOT fixable here, and must not be "fixed" by taking a populated copy at
  # a DIFFERENT version: bson, mongodb-connection-string-url, real-require and
  # webidl-conversions each ship content-free at the pinned version while a second,
  # populated version sits in the store (bson 6.10.4 pinned vs 7.3.1 populated).
  # Substituting would swap a major version under the Mongo driver.
  #
  # These are packages Next's tracer pruned to package.json because the server never
  # loads them -- verified by booting server.js. Leaving a bare stub is exactly what
  # the tracer intended, so skip rather than fail.
  if [ -z "$real" ] || [ "$(find "$real" -type f | wc -l)" -eq 1 ]; then
    echo "skip: $rel@$ver (tracer shipped no content at the pinned version)"
    continue
  fi

  echo "flatten: $rel@$ver"
  rm -rf "$top"
  cp -RL "$real" "$top"   # -L: copy real files, never a link into the store
done

# The loop above runs in a subshell, so re-check rather than trusting an exit flag.
#
# The `|| true` is load-bearing under `set -e`: is_stub is the last command in the
# while body, so when the final directory examined is NOT a stub it returns 1, the
# while returns 1, and the command substitution returns 1 -- killing the script with
# no error message. Whether that happens depends purely on traversal order, which is
# why this passed locally and died in CI right after "flatten: atomic-sleep".
# Flag only stubs that COULD have been flattened -- i.e. a populated copy exists at
# the pinned version. Anything skipped above is intentional tracer pruning.
remaining=$(list_pkg_dirs | while read -r t; do
  is_stub "$t" || continue
  r=${t#"$NM"/}
  v=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*//p' "$t/package.json" | head -1)
  e=$(echo "$r" | tr '/' '+')
  for c in "$NM/.pnpm/$e@$v" "$NM/.pnpm/$e@${v}_"*; do
    [ -d "$c/node_modules/$r" ] || continue
    [ "$(find "$c/node_modules/$r" -type f | wc -l)" -gt 1 ] && echo "$r"
  done
done || true)
if [ -n "$remaining" ]; then
  echo "FATAL: resolvable stub packages remain after flattening:" >&2
  echo "$remaining" >&2
  exit 1
fi

echo "flatten: OK, no content-free stubs remain"
