# Releasing

Three independent targets ship from this repository:

- the Obsidian plugin, distributed through GitHub releases and eventually the
  Obsidian Community directory;
- the web playground, deployed to GitHub Pages;
- the Drum Notation Importer Agent Plugin, released on its independent
  `agent-plugin-vX.Y.Z` tag line.

New importer tooling uses three namespaces: `agent-plugin:*` for generation,
packaging, builds, and explicit acknowledgment actions; `check:*` for read-only
integrity and conformance checks; and `security:*` for security invariants.
Keep ordinary product commands such as `web:*` in their existing namespace.

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
   npm run agent-plugin:generate
   npm run agent-plugin:build
   npm run check:agent-plugin
   npm run security:style-sinks
   npm run check:third-party
   npm run web:test:csp
   npm audit --omit=dev
   ```
   When `docs/notation-format.md` changed, first reconcile the importer's
   curated notation reference. Review the complete diff printed by the first
   command before confirming with the second:
   ```bash
   npm run agent-plugin:acknowledge-notation-reference
   npm run agent-plugin:acknowledge-notation-reference -- --confirm-reviewed
   ```
   The unconfirmed command never writes. Confirmation updates only the source
   checksum and records a review event; parser/serializer conformance remains
   the grammar authority.
4. Commit and push to `main`.
5. Confirm CI passes.
6. Push an annotated tag:
   ```bash
   git tag -a 0.9.0 -m "0.9.0"
   git push origin 0.9.0
   ```
7. Inspect the draft GitHub release, artifact attestations, and attached files.
8. Install the exact downloaded assets into a clean vault before publishing.
9. Publish explicitly as the repository's Latest release:
   ```bash
   tag=0.9.0
   gh release edit "$tag" --draft=false --latest=true
   ```

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

The playground is live at
[vkamolov.github.io/obsidian-drum-notation](https://vkamolov.github.io/obsidian-drum-notation/).
GitHub Pages uses **GitHub Actions** as its source. The workflow in
`.github/workflows/pages.yml` deploys automatically after pushes to `main` and
also supports manual `workflow_dispatch` runs.

After changes reach `main`, confirm the Pages workflow succeeds and smoke-test
the deployed playground for missing assets, console errors, layout regressions,
and stale content.

The site builds from `web/` via `npm run web:build`; `vite.config.ts` uses
`base: "./"` so assets resolve under the project subpath.

## Agent plugin

The portable source package lives at `agent-plugin/drum-notation-importer/` and
targets Agent Plugins 1.0.0. The same directory contains generated OpenAI,
Claude, and Gemini CLI compatibility manifests. All manifests are emitted from
`metadata.json`; do not edit them independently. The validator lives inside the
skill so the shared `skills/import-drum-score/` directory remains independently
installable by Agent Skills clients.

For an importer release:

1. Bump only the importer version in canonical metadata. Update both repository
   marketplace pins, the Claude marketplace version, README release links,
   public catalog copy, submission dossier, and archive names to the same
   version. Generated manifests and marketplace entries must be regenerated in
   the release commit before validation; never point a committed marketplace
   at a version absent from canonical metadata.
2. Run `npm run agent-plugin:generate`, `npm run agent-plugin:build`, the full
   shared checks above, `npm run agent-plugin:package`, and then
   `npm run check:openai-submission`. The final command enforces the stricter
   public-directory limits and validates the already-built ZIP.
3. Commit the release preparation, then create an annotated tag such as:
   ```bash
   git tag -a agent-plugin-v0.2.1 -m "agent-plugin-v0.2.1"
   ```
4. Push `main` and the importer tag together so marketplace pins never point to
   a missing remote tag:
   ```bash
   git push origin main agent-plugin-v0.2.1
   ```
5. Confirm main CI and the tag workflow pass. The workflow that creates the
   importer draft must be present in the tagged commit because tag-triggered
   workflows are resolved from that commit.
6. Inspect the draft release, attestation, four extracted `.tar.gz` packages,
   and the skills-only OpenAI directory ZIP before publishing: portable,
   OpenAI, Claude, Gemini CLI, and directory submission.
7. Publish without replacing the Obsidian release as Latest, then verify the
   repository's Latest release still resolves to the current Obsidian version:
   ```bash
   gh release edit agent-plugin-v0.2.1 --draft=false --latest=false
   gh api repos/vkamolov/obsidian-drum-notation/releases/latest --jq .tag_name
   ```

The Obsidian workflow ignores `agent-plugin-v*`; the importer workflow rejects
a tag that does not exactly match importer metadata.

### OpenAI public directory submission

GitHub release publication and OpenAI directory publication are separate. A
released ZIP does not become discoverable until its reviewed directory draft
is explicitly published.

1. Deploy and browser-check the importer landing, privacy, and terms pages.
2. In OpenAI Platform, confirm Apps Management write permission and that the
   verified individual publisher identity exactly matches canonical metadata.
3. Create a **Skills only** draft at <https://platform.openai.com/plugins>,
   upload `drum-notation-importer-0.2.1-openai.zip`, and review every
   normalization or safety-scan result.
4. Populate the three starter prompts, five positive cases, three negative
   cases, all eligible regions, release notes, support channel, and required
   attestations from `submission/openai-catalog.json`, then submit for review.
5. Use a new importer patch version when review requires any package or skill
   change. Portal-copy-only changes may remain on the current draft. After
   approval, publish explicitly and verify discovery and installation in both
   ChatGPT and Codex.

Expected answers and project-owned evaluation fixtures live under
`agent-plugin/drum-notation-importer/submission/` and must never be copied into
the uploaded skill or ZIP. After public-directory publication, replace the
README's review-pending wording with the approved directory install path.

## Release acceptance checklist

- Visual editing, writeback-on-close, restoration, read-only modes, and
  empty-block creation work in Obsidian Reading view.
- Playback features work: Play, Loop Bar, Loop All, repeat progress, speed,
  mute, metronome, previews, and silent bars.
- Light/dark themes, subtitles, responsive layouts, and mobile touch
  interactions remain usable.
- Clipboard fallback never shows stale notation.
- Production bundles retain the VexFlow/license notice.
- Portable, OpenAI, Claude, and Gemini CLI manifests, skill-agent metadata,
  validator provenance, kit reference, and notation-reference acknowledgment
  are current.
- The four `.tar.gz` packages and skills-only OpenAI ZIP pass path, content,
  size, dossier, and exclusion checks.
- Importer website, privacy, terms, and support links work without trackers or
  off-origin runtime requests.
- OpenAI/Codex and Claude marketplace entries point to the current published
  importer tag and match canonical importer metadata.
- Production CSP tests pass in Chromium and WebKit with visible noteheads and
  no off-origin requests.
- Manual install works using only `main.js`, `manifest.json`, and `styles.css`.
- GitHub release tag, release title, committed manifest version, and attached
  manifest version all match exactly.
- GitHub artifact attestations verify successfully.
- GitHub Pages has no missing assets, console errors, overflow, or stale copy
  output.
