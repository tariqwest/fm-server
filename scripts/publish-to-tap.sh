#!/bin/bash
# ============================================================================
# publish-to-tap.sh — Publishes Homebrew formula to tariqwest/homebrew-tap
#
# Usage:
#   ./scripts/publish-to-tap.sh [version]
#
# Environment variables:
#   GITHUB_TOKEN - GitHub personal access token (required for push)
#   TAP_DIR      - Local directory of the tap repo (optional)
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
VERSION="${1:-$(jq -r .version "$ROOT_DIR/packages/afm-js/package.json")}"
TAP_REPO="${TAP_REPO:-tariqwest/homebrew-tap}"
TAP_DIR="${TAP_DIR:-$HOME/.cache/afm-js-tap}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check for GitHub token
if [[ -z "${GITHUB_TOKEN:-}" ]]; then
    log_warn "GITHUB_TOKEN not set. Will attempt to use existing git credentials."
fi

# Generate the formula first
log_info "Generating Homebrew formula for v${VERSION}..."
cd "$ROOT_DIR"
node scripts/generate-homebrew-formula.js "$VERSION"

# Check if formula was generated
if [[ ! -f "$ROOT_DIR/afm-js.rb" ]]; then
    log_error "Formula not generated. Check for errors above."
    exit 1
fi

# Clone or update the tap repository
if [[ -d "$TAP_DIR/.git" ]]; then
    log_info "Updating existing tap repo at ${TAP_DIR}..."
    cd "$TAP_DIR"
    git fetch origin
    git checkout main || git checkout master
    git pull
else
    log_info "Cloning tap repository ${TAP_REPO}..."
    rm -rf "$TAP_DIR"
    git clone "https://${GITHUB_TOKEN:+${GITHUB_TOKEN}@}github.com/${TAP_REPO}.git" "$TAP_DIR"
    cd "$TAP_DIR"
fi

# Create Formula directory if needed
mkdir -p "$TAP_DIR/Formula"

# Copy the formula
cp "$ROOT_DIR/afm-js.rb" "$TAP_DIR/Formula/"

# Check if there are changes
if git diff --quiet HEAD -- "Formula/afm-js.rb" 2>/dev/null; then
    log_warn "No changes detected in formula. Already up to date?"
    exit 0
fi

# Commit and push
log_info "Committing changes..."
git add "Formula/afm-js.rb"
git commit -m "afm-js ${VERSION}"

log_info "Pushing to ${TAP_REPO}..."
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    git push "https://${GITHUB_TOKEN}@github.com/${TAP_REPO}.git" HEAD:main 2>/dev/null || \
    git push "https://${GITHUB_TOKEN}@github.com/${TAP_REPO}.git" HEAD:master 2>/dev/null
else
    git push origin HEAD:main 2>/dev/null || \
    git push origin HEAD:master 2>/dev/null
fi

log_info "Successfully published afm-js ${VERSION} to ${TAP_REPO}!"
echo ""
echo "Users can now install via:"
echo "  brew install tariqwest/tap/afm-js"
