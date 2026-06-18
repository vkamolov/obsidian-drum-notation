# Releasing

Two independent targets: the Obsidian plugin and the web playground.

## Obsidian plugin

Releases are automated by `.github/workflows/release.yml`, which fires on a
pushed tag, builds `main.js`, and creates a GitHub release with the four assets
Obsidian needs: `main.js`, `manifest.json`, `styles.css`, `versions.json`.

For each release:

1. Bump the version in `manifest.json` and `package.json` (same value, no
   leading `v`).
2. Add the new version to `versions.json`, mapping it to the minimum supported
   Obsidian version, e.g. `"0.8.33": "1.5.0"`.
3. Commit and push to `main`.
4. Tag with the exact manifest version and push the tag:
   ```bash
   git tag 0.8.33
   git push origin 0.8.33
   ```
   The workflow verifies the tag matches `manifest.json`, runs tests + build,
   and publishes the release.

First-time community-plugin listing only: open a PR adding this plugin to
[obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases)
(`community-plugins.json`). Subsequent updates need only a new tag/release.

Before claiming mobile support (`manifest.json` has `isDesktopOnly: false`),
smoke-test on Obsidian mobile — note `contextmenu` does not fire on touch, so
the edit grid relies on tap.

## Web playground (GitHub Pages)

Deployment is wired in `.github/workflows/pages.yml` but kept dormant
(`workflow_dispatch` only) because Pages requires a public repo (or a paid plan
for private). To go live:

1. Make the repository public (Settings → General → Danger Zone → Change
   visibility).
2. Enable Pages with the Actions source: Settings → Pages → Build and
   deployment → Source: **GitHub Actions**.
3. Either run the "Deploy web playground to Pages" workflow manually (Actions
   tab → Run workflow), or uncomment the `push: branches: [main]` trigger in
   `pages.yml` to auto-deploy on every push to `main`.

The site builds from `web/` via `npm run web:build`; `vite.config.ts` uses
`base: "./"` so assets resolve under the project subpath
(`https://<user>.github.io/obsidian-drum-notation/`).
