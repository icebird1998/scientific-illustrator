#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${1:-$HOME/.codex/marketplaces/scientific-illustrator}"
REPOSITORY="https://github.com/icebird1998/scientific-illustrator.git"
PLUGIN="scientific-illustrator@scientific-illustrator-tools"

command -v git >/dev/null || { echo "Git is required." >&2; exit 1; }
command -v codex >/dev/null || { echo "Codex CLI is required." >&2; exit 1; }

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
  PYTHON_READY=""
  for CANDIDATE in "${SCIENTIFIC_ILLUSTRATOR_PYTHON:-}" \
    "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3" \
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
    VENV_DIR="$INSTALL_DIR/plugins/scientific-illustrator/scripts/.venv"
    "$SYSTEM_PYTHON" -m venv "$VENV_DIR"
    "$VENV_DIR/bin/python3" -m pip install --disable-pip-version-check "python-pptx>=1.0,<2"
    PYTHON_READY="$VENV_DIR/bin/python3"
  fi
  echo "Presentation OOXML backend: $PYTHON_READY"
fi

codex plugin marketplace add "$INSTALL_DIR"
codex plugin add "$PLUGIN"

# Install the sci-illu CLI into PATH so any agent or terminal can use it.
BIN_DIR="${SCI_ILLU_BIN_DIR:-$HOME/.local/bin}"
CLI_TARGET="$BIN_DIR/sci-illu"
CLI_SOURCE="$INSTALL_DIR/plugins/scientific-illustrator/scripts/cli.mjs"
if [[ "$(command -v sci-illu 2>/dev/null || true)" == "$CLI_TARGET" ]]; then
  echo "sci-illu CLI: already installed at $CLI_TARGET"
elif [[ -e "$CLI_TARGET" || -L "$CLI_TARGET" ]]; then
  echo "sci-illu CLI: $CLI_TARGET already exists; leaving as-is (remove it to reinstall)" >&2
else
  mkdir -p "$BIN_DIR"
  ln -s "$CLI_SOURCE" "$CLI_TARGET"
  echo "sci-illu CLI: $CLI_TARGET"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) echo "Add $BIN_DIR to PATH (e.g. export PATH=\"$BIN_DIR:\$PATH\")" >&2 ;;
  esac
fi

echo "Installed $PLUGIN"
echo "Restart Codex and start a new task before first use."
echo "Windows PowerPoint uses COM; WPS and unconnected Mac PowerPoint use the editable PPTX OOXML backend."
if [[ "$(uname -s)" == "Darwin" ]]; then
  echo "For live Mac PowerPoint context.sync drawing, review README.md, then run:"
  echo "  cd \"$INSTALL_DIR\" && node plugins/scientific-illustrator/scripts/officejs-setup.mjs prepare"
  echo "  node plugins/scientific-illustrator/scripts/officejs-setup.mjs sideload"
  echo "Certificate trust is intentionally left to you in macOS Keychain Access."
fi
