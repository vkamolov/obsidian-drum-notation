# Releasing

Two independent targets ship from this repository:

- the Obsidian plugin, distributed through GitHub releases and eventually the
  Obsidian Community directory;
- the web playground, deployed to GitHub Pages.

## Obsidian plugin

Releases are automated by `.github/workflows/release.yml`. Pushing an annotated
tag whose name exactly matches `manifest.json.version` creates a draft GitHub
release with the install assets:

- `main.js`
- `manifest.json`
- `styles.css`

`versions.json` and `THIRD_PARTY_NOTICES.md` stay in the repository. They are
not required release assets.

For each release:

1. Bump the same semantic version in `manifest.json`, `package.json`,
   `package-lock.json`, and `versions.json`; use no leading `v`.
2. Keep `versions.json` mapped to the minimum supported Obsidian version, for
   example `"0.9.0": "1.5.0"`.
3. Run:
   ```bash
   npm ci
   npm test
   npm run build
   npm run web:build
   npm run web:typecheck
   npm audit --omit=dev
   ```
4. Commit and push to `main`.
5. Confirm CI passes.
6. Push an annotated tag:
   ```bash
   git tag -a 0.9.0 -m "0.9.0"
   git push origin 0.9.0
   ```
7. Inspect the draft GitHub release, artifact attestations, and attached files.
8. Install the exact downloaded assets into a clean vault before publishing.

For beta testing before Community directory approval, publish `0.9.x` releases
as GitHub pre-releases and distribute them with BRAT or manual installation.
Do not replace published assets; release fixes as `0.9.1`, `0.9.2`, and so on.

Before claiming mobile support (`manifest.json` has `isDesktopOnly: false`),
smoke-test on Obsidian mobile. The edit grid relies on tap interactions rather
than desktop-only context menus.

## Community directory submission

The first stable public submission should be `1.0.0` after beta testing passes.
The current submission path is the Obsidian Community site developer dashboard,
not a pull request to `obsidianmd/obsidian-releases`.

Submission steps:

1. Publish a normal GitHub release whose tag exactly matches
   `manifest.json.version`.
2. Make sure the release has `main.js`, `manifest.json`, and `styles.css` as
   individual binary attachments.
3. Sign in at <https://community.obsidian.md> with an Obsidian account.
4. Link the GitHub account that owns this repository.
5. Go to **Plugins → New plugin**.
6. Submit `https://github.com/vkamolov/obsidian-drum-notation`.
7. Agree to the developer policies and maintenance commitment.
8. Address automated review feedback only through incremented releases, such as
   `1.0.1`.

The dashboard reads `manifest.json` from the default branch. The installable
files come from the GitHub release whose tag matches the manifest version, so
the committed manifest and release asset manifest must agree exactly.

## Web playground (GitHub Pages)

Deployment is wired in `.github/workflows/pages.yml` and is manual-only until
the repository is public and Pages is enabled.

To go live:

1. Make the repository public.
2. Enable Pages with source **GitHub Actions**:
   Settings → Pages → Build and deployment → Source.
3. Run the "Deploy web playground to Pages" workflow manually.
4. Verify the playground at the project Pages URL.
5. Set the repository homepage to the verified Pages URL.
6. After the first successful manual deployment, optionally enable deployment
   from pushes to `main`.

The site builds from `web/` via `npm run web:build`; `vite.config.ts` uses
`base: "./"` so assets resolve under the project subpath.

## Release acceptance checklist

- Visual editing, writeback-on-close, restoration, read-only modes, and
  empty-block creation work in Obsidian Reading view.
- Playback features work: Play, Loop Bar, Loop All, repeat progress, speed,
  mute, metronome, previews, and silent bars.
- Light/dark themes, subtitles, responsive layouts, and mobile touch
  interactions remain usable.
- Clipboard fallback never shows stale notation.
- Production bundles retain the VexFlow/license notice.
- Manual install works using only `main.js`, `manifest.json`, and `styles.css`.
- GitHub release tag, release title, committed manifest version, and attached
  manifest version all match exactly.
- GitHub artifact attestations verify successfully.
- GitHub Pages has no missing assets, console errors, overflow, or stale copy
  output.
