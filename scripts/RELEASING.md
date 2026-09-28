# Releases

Use Node.js 24.14+ or 26+. Commit these release-tooling changes to the default
branch before creating a release tag. Configure npm trusted publishing for
`publish.yaml` on the main package and all native companion packages.
For missing companion package names, use the existing `pnpm bootstrap:native`
flow first; its placeholder version and `bootstrap` tag are separate from releases.

## Prepare a beta

From a clean checkout with pnpm, Rust, and native build tools installed:

```sh
pnpm release:beta --dry-run
pnpm release:beta --publish
```

The preview is read-only. The second command selects the next unused numbered
v5 beta using the manifest, npm versions, and local/remote tags. It runs release
checks, commits the manifest, creates an annotated tag, and atomically pushes the
branch and tag to origin. Branch permissions must permit that push.

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
before publication. Native packages publish before the main package.

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
