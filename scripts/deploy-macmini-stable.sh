#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/deploy-macmini-stable.sh <user@gateway-host> <version>

Examples:
  scripts/deploy-macmini-stable.sh user@gateway-host 2026.2.22
  scripts/deploy-macmini-stable.sh user@gateway-host 2026.2.22-1

Behavior:
  - Installs an exact openclaw version on the remote host.
  - Rejects floating channels/tags such as latest, beta, and dev.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -ne 2 ]]; then
  usage
  exit 1
fi

target="$1"
version="$2"

if [[ "$version" == "latest" || "$version" == "beta" || "$version" == "dev" ]]; then
  echo "Refusing floating channel/tag: '$version'." >&2
  echo "Pass an exact version, for example: 2026.2.22" >&2
  exit 1
fi

if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+)*$ ]]; then
  echo "Invalid version format: '$version'." >&2
  echo "Expected an exact version like 2026.2.22 or 2026.2.22-1." >&2
  exit 1
fi

package_spec="openclaw@${version}"

echo "Deploy target: ${target}"
echo "Package: ${package_spec}"

ssh -o BatchMode=yes "$target" "bash -s" -- "$package_spec" <<'EOF'
set -euo pipefail

package_spec="$1"

# Load profile so npm/openclaw are available in non-interactive SSH sessions.
if [ -f "$HOME/.profile" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.profile"
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found on remote host. Install Node/npm first." >&2
  exit 1
fi

if command -v sudo >/dev/null 2>&1; then
  sudo npm i -g "$package_spec"
else
  npm i -g "$package_spec"
fi

if ! command -v openclaw >/dev/null 2>&1; then
  echo "openclaw not found on PATH after install." >&2
  exit 1
fi

openclaw doctor
openclaw gateway restart
openclaw health
openclaw channels status --probe
openclaw --version
EOF

echo "Deployment finished."
