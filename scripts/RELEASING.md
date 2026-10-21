# Releases

Use Node.js 24.14+ or 26+. Commit release tooling to the default branch
before creating a release tag. npm Trusted Publishing must authorise
`publish.yaml` on the main package and all native companion packages.

## Bootstrap FreeBSD packages and OIDC

The existing bootstrap command can create the missing FreeBSD package names and
configure their trusted publishers in one pass. It publishes a README-only
`0.0.0-bootstrap.0` placeholder under the non-default `bootstrap` dist-tag,
not under `latest` or `beta`. No FreeBSD build is needed for this initial step.

Use Node.js with npm 11.15.0 or newer. Sign in interactively with `npm login`,
using an npm account with 2FA enabled and write access to `@nktnet`. An npm
bypass-2FA automation token cannot create trusted publisher configurations.

```sh
npm login --registry=https://registry.npmjs.org/
pnpm bootstrap:native --freebsd-only --configure-oidc
pnpm bootstrap:native --freebsd-only --configure-oidc --publish
```

The second command previews package creation and OIDC settings. The third
publishes any missing packages, then uses `npm trust github` to configure both
`@nktnet/sync-request-curl-freebsd-arm64` and
`@nktnet/sync-request-curl-freebsd-x64` with repository
`nktnet1/sync-request-curl`, workflow `publish.yaml`, environment `Production`,
and `--allow-publish`. It also works when both packages already exist.
The first trust operation can require an interactive browser 2FA challenge; npm
offers a five-minute 2FA skip option for completing the batch. The script
inspects existing trusted publishers first: when npm allows the lookup, matching
configurations are skipped, and conflicting ones stop the command. If npm
requires 2FA for a captured `npm trust list --json`, the script proceeds to the
interactive `npm trust github` command rather than retrying the captured lookup.
In this case npm may reject an already-existing relationship rather than skip
it, but no existing trusted publisher is revoked or overwritten.

To bootstrap or configure OIDC for *all* native companion packages, omit
`--freebsd-only`. The main `sync-request-curl` package's trusted publisher must
also be configured separately if it does not already exist. GitHub Actions
already supplies `id-token: write` and uses the `Production` environment in
`publish.yaml`, so normal releases need no npm publishing token.

**Important:** npm requires a successful OIDC publish within two days of
creating a new trusted publisher, or the unvalidated configuration expires.
Create the release tag within that window and check the Publish workflow.
If a configuration expires, revoke it in npm settings and re-run the bootstrap
command to register a new one.

## Prepare a beta

From a clean checkout with pnpm, Rust, and native build tools installed:

```sh
pnpm release:beta --dry-run
pnpm release:beta --base 5.0.1 --dry-run
pnpm release:beta --base 5.0.1 --publish
```

The preview is read-only. Without `--base`, the command continues the manifest's
current beta series. If that stable base has already been released, choose the
next base explicitly with `--base <version>`; the script never guesses whether
the next release should be a patch or minor version. Both `5.0.1` and `v5.1.0`
forms are accepted. The command selects the next unused numbered beta using npm
versions and local/remote tags. With `--publish`, it runs release checks, commits
the manifest, creates an annotated tag, and atomically pushes the branch and tag
to origin. Release commits use the plain version (for example, `5.0.1-beta.3`),
while annotated tags retain the `v` prefix (for example, `v5.0.1-beta.3`).
Branch permissions must permit that push.

For preparation without committing or pushing, use `pnpm release:beta` instead.
Do not follow that with `--publish` on the dirty checkout. Review and commit the
prepared version, then create and push its tag manually. Failed checks leave the
version edit available for inspection.

## Build and publish

The tag triggers Native prebuilds, which builds the native matrix and packages
the release. Publish then invokes `scripts/publish-release-packages.ts` using
release metadata and the upstream run's expected SHA. CI does not increment the
version. It checks out release tooling from the trusted publishing workflow
revision, not from downloaded artifacts, and installs no npm dependencies.

The same publisher can be run locally against the downloaded `release-packages`
artifact (extract its `.tgz` files into `release-packages/`):

```sh
pnpm publish:release-packages --registry=https://registry.npmjs.org --tag=v5.0.0-beta.1 --dry-run
pnpm publish:release-packages --registry=https://registry.npmjs.org --tag=v5.0.0-beta.1
```

Local publication requires npm authentication. CI uses npm trusted publishing.
Release inputs use the fixed repository paths
`release-packages/` and `release-metadata/`; they are deliberately not configurable
from the CLI. npm is invoked through the `npm-cli.js` installation paired with the
running Node.js executable rather than a caller-controlled `PATH`. The dry run
validates local artifacts and prints the plan; it does not test registry access.

Both paths use the same policy: numbered beta versions publish under `beta`,
stable versions under `latest`, and other version formats are rejected. All
package names, versions, and exact optional native dependency pins are validated
before publication. Native packages publish before the main package. For a
manually prepared stable release, use an annotated version tag such as `v5.0.0`.

Registry preflight aborts on authentication/network errors. Existing versions
are skipped only when their SHA-512 integrity matches the local tarball. Keep the
original artifacts for retries; rebuilt tarballs may differ. Retrying does not
move dist-tags for existing versions. Publication is not transactional: if npm
fails partway through, rerun with the same artifacts. Do not overwrite an
existing version or bypass a tarball mismatch.

After GitHub Actions completes:

```sh
pnpm smoke:release-registry --registry=https://registry.npmjs.org --version=5.0.0-beta.1 --matrix
```

This checks optional-package selection for all targets and loads the addon only
on the current platform. Actual platform execution remains the responsibility
of the CI matrix.
