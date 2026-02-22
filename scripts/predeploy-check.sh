#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/predeploy-check.sh --type <config|code>

Modes:
  config  Validate branch sync and print npm latest context.
  code    Same as config, plus require npm latest gitHead to match origin/main.
EOF
}

deploy_type=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --type)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --type" >&2
        usage
        exit 1
      fi
      deploy_type="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "$deploy_type" != "config" && "$deploy_type" != "code" ]]; then
  echo "Invalid or missing --type. Expected config or code." >&2
  usage
  exit 1
fi

echo "[predeploy] fetching origin..."
git fetch origin --prune >/dev/null 2>&1

main_sha="$(git rev-parse main)"
origin_main_sha="$(git rev-parse origin/main)"
divergence="$(git rev-list --left-right --count main...origin/main)"

echo "[predeploy] main:        $main_sha"
echo "[predeploy] origin/main: $origin_main_sha"
echo "[predeploy] divergence:  $divergence (left right)"

if [[ "$main_sha" != "$origin_main_sha" ]]; then
  echo "[predeploy] FAIL: main and origin/main differ. Sync before deploy." >&2
  exit 1
fi

latest_version="$(npm view openclaw version --userconfig "$(mktemp)")"
latest_git_head="$(npm view "openclaw@${latest_version}" gitHead --userconfig "$(mktemp)")"

echo "[predeploy] npm latest version: $latest_version"
echo "[predeploy] npm latest gitHead: $latest_git_head"
echo "[predeploy] origin/main sha:    $origin_main_sha"

if [[ "$deploy_type" == "code" && "$latest_git_head" != "$origin_main_sha" ]]; then
  echo "[predeploy] FAIL: code deploy requested, but npm latest is not built from origin/main." >&2
  echo "[predeploy] Action: publish new stable from origin/main, then deploy exact version." >&2
  exit 1
fi

echo "[predeploy] PASS ($deploy_type)"
