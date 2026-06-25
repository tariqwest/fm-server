# Releasing fm-server

This document describes the release process for fm-server, including Homebrew tap publication.

## Version Numbering

fm-server follows semantic versioning: `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes to the API or CLI interface
- **MINOR**: New features
- **PATCH**: Bug fixes and minor improvements

## Automated Release Process

The release process is fully automated via the `release.js` script and GitHub Actions.

### Local Release

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
pnpm run release
```

The script will:

1. Build the project
2. Create the prebuilt release tarball
3. Calculate SHA256 hashes
4. Create a GitHub release with artifacts
5. Generate the Homebrew formula
6. Publish the formula to the Homebrew tap

### CI/CD Release

Push a version tag to trigger the workflow:

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions will build, test, run the release script, and update the Homebrew tap.

### Dry Run Mode

```bash
RELEASE_DRY_RUN=true GITHUB_TOKEN=test pnpm run release
```

## Available Scripts

- `pnpm run release` — Full release process
- `pnpm run ci` — Build, test, and typecheck

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub personal access token (required) |
| `RELEASE_DRY_RUN` | Set to `"true"` to skip actual GitHub operations |
| `TAP_REPO` | Tap repository (default: `tariqwest/homebrew-tap`) |
| `TAP_DIR` | Local directory for tap clone (default: `~/.cache/fm-server-tap`) |

## Homebrew Tap Structure

```
homebrew-tap/
├── Formula/
│   └── fm-server.rb
├── README.md
└── LICENSE
```

Users can install via:

```bash
brew tap tariqwest/tap
brew install fm-server
```