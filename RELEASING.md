# Releasing afm-js

This document describes the release process for afm-js, including Homebrew tap publication.

## Version Numbering

afm-js follows semantic versioning: `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes to the API or CLI interface
- **MINOR**: New features (M1, M2, M3 milestones)
- **PATCH**: Bug fixes and minor improvements

## Release Checklist

1. **Prepare the release**
   ```bash
   # Update version in packages/afm-js/package.json
   # Update version references in other files if needed
   
   # Run full test suite
   pnpm run build
   pnpm test
   ```

2. **Build the release artifacts**
   ```bash
   # Build the helper binary
   (cd helper && swift build -c release)
   
   # Create the prebuilt afm-js tarball (contains dist/ and bin/)
   tar -czf afm-js-prebuilt-arm64-apple-darwin.tar.gz -C packages/afm-js dist bin
   
   # Create the helper binary tarball
   tar -czf afm-fm-helper-arm64-apple-darwin.tar.gz -C helper/.build/release afm-fm-helper
   ```

3. **Calculate SHA256 hashes**
   ```bash
   shasum -a 256 afm-js-prebuilt-arm64-apple-darwin.tar.gz afm-fm-helper-arm64-apple-darwin.tar.gz
   ```

4. **Create GitHub Release**
   - Create a new GitHub release with tag `v{VERSION}`
   - Upload both tarballs:
     - `afm-js-prebuilt-arm64-apple-darwin.tar.gz` (prebuilt Node.js packages)
     - `afm-fm-helper-arm64-apple-darwin.tar.gz` (Swift helper binary)

5. **Generate and update formula**
   ```bash
   # Generate formula with correct SHA256 values
   AFM_JS_VERSION=0.0.1 \
   AFM_JS_SHA256=xxx \
   AFM_JS_HELPER_SHA256=yyy \
   node scripts/generate-homebrew-formula.js
   
   # Or regenerate with placeholders and edit manually
   pnpm run release:brew:generate
   ```

6. **Publish to Homebrew tap**
   ```bash
   # Set your GitHub token (if not already set)
   export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
   
   # Publish to tap
   pnpm run release:brew:publish 0.0.1
   
   # Or manually:
   git clone https://github.com/tariqwest/homebrew-tap.git
   cp afm-js.rb homebrew-tap/Formula/
   cd homebrew-tap
   git add -A
   git commit -m "afm-js 0.0.1"
   git push origin main
   ```

7. **Verify installation**
   ```bash
   # Test the formula locally
   brew install --build-from-source ./afm-js.rb
   afm-js --help
   
   # Or after tap publication:
   brew tap tariqwest/tap
   brew install afm-js
   afm-js serve --port 11434
   ```

## Available Scripts

- `pnpm run release:prepare` — Build, test, and generate formula
- `pnpm run release:brew:generate` — Generate Homebrew formula only
- `pnpm run release:brew:publish [version]` — Publish formula to tap

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AFM_JS_VERSION` | Override version for formula generation |
| `AFM_JS_SHA256` | Source tarball SHA256 |
| `AFM_JS_HELPER_SHA256` | Helper binary SHA256 |
| `GITHUB_TOKEN` | GitHub personal access token for tap push |
| `TAP_REPO` | Tap repository (default: `tariqwest/homebrew-tap`) |
| `TAP_DIR` | Local directory for tap clone |

## Homebrew Tap Structure

The formula is published to `https://github.com/tariqwest/homebrew-tap`:

```
homebrew-tap/
├── Formula/
│   └── afm-js.rb      # The generated formula
├── README.md          # Tap documentation
└── LICENSE
```

Users can then install via:

```bash
brew tap tariqwest/tap
brew install afm-js
```
