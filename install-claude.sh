#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${1:-$HOME/.claude/marketplaces/scientific-illustrator}"
REPOSITORY="https://github.com/icebird1998/scientific-illustrator.git"
PLUGIN="scientific-illustrator@scientific-illustrator-tools"

command -v git >/dev/null || { echo "Git is required." >&2; exit 1; }
command -v claude >/dev/null || { echo "Claude Code CLI is required." >&2; exit 1; }

if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" pull --ff-only
elif [[ -e "$INSTALL_DIR" ]]; then
  echo "Install directory exists but is not this Git repository: $INSTALL_DIR" >&2
  exit 1
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPOSITORY" "$INSTALL_DIR"
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
  VENV_DIR="$INSTALL_DIR/plugins/scientific-illustrator/scripts/.venv"
  PYTHON_READY=""
  for CANDIDATE in "${SCIENTIFIC_ILLUSTRATOR_PYTHON:-}" \
    "$VENV_DIR/bin/python3" \
    "$(command -v python3 2>/dev/null || true)"; do
    [[ -n "$CANDIDATE" && -x "$CANDIDATE" ]] || continue
    if "$CANDIDATE" -c 'import pptx' >/dev/null 2>&1; then
      PYTHON_READY="$CANDIDATE"
      break
    fi
  done
  if [[ -z "$PYTHON_READY" ]]; then
    SYSTEM_PYTHON="$(command -v python3 2>/dev/null || true)"
    if [[ -z "$SYSTEM_PYTHON" ]]; then
      echo "Python 3 is required for Mac PowerPoint/WPS support." >&2
      exit 1
    fi
    # Claude Code installs a copy of the plugin into its cache and drops
    # symlinks that point outside the plugin, so the venv needs --copies.
    "$SYSTEM_PYTHON" -m venv --copies "$VENV_DIR"
    "$VENV_DIR/bin/python3" -m pip install --disable-pip-version-check "python-pptx>=1.0,<2"
    PYTHON_READY="$VENV_DIR/bin/python3"
  fi
  echo "Presentation OOXML backend: $PYTHON_READY"
fi

claude plugin marketplace add "$INSTALL_DIR"
# Reinstall so Claude Code's cache copy picks up a freshly built venv even
# when the plugin version is unchanged (install/update skip the re-copy).
claude plugin uninstall "$PLUGIN" >/dev/null 2>&1 || true
claude plugin install "$PLUGIN"

echo "Installed $PLUGIN"
echo "Restart Claude Code and start a new session before first use."
echo "Windows PowerPoint uses COM; WPS and unconnected Mac PowerPoint use the editable PPTX OOXML backend."
if [[ "$(uname -s)" == "Darwin" ]]; then
  echo "For live Mac PowerPoint context.sync drawing, review README.md, then run:"
  echo "  cd \"$INSTALL_DIR\" && node plugins/scientific-illustrator/scripts/officejs-setup.mjs prepare"
  echo "  node plugins/scientific-illustrator/scripts/officejs-setup.mjs sideload"
  echo "Certificate trust is intentionally left to you in macOS Keychain Access."
fi
