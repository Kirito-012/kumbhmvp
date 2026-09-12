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
  if [ -z "$real" ]; then
    echo "FATAL: stub $rel@$ver has no .pnpm copy under $NM/.pnpm/$enc@$ver*" >&2
    exit 1
  fi

  echo "flatten: $rel@$ver"
  rm -rf "$top"
  cp -RL "$real" "$top"   # -L: copy real files, never a link into the store
done

# The loop runs in a subshell, so re-check rather than trusting an exit flag.
remaining=$(list_pkg_dirs | while read -r t; do is_stub "$t" && echo "$t"; done)
if [ -n "$remaining" ]; then
  echo "FATAL: stub packages remain after flattening:" >&2
  echo "$remaining" >&2
  exit 1
fi

echo "flatten: OK, no content-free stubs remain"
