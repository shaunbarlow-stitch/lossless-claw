# Releasing

This is the pi-port fork. **No npm publishing is configured** while the pi port is in progress. Installation during development is local-only — see "Local install" below.

The Changesets tooling inherited from the upstream is left in place for future use but is not part of the active workflow. Track release-impacting changes by appending to the **Unreleased** section of [`CHANGELOG.md`](./CHANGELOG.md) in the same PR that makes the change.

## Local install (development)

While the pi adapter under `src/pi/` is being built up, the extension is not yet runnable as a pi extension. Once Phase 1 lands you will be able to:

```bash
# from a clone of this repo
npm install
npm run build        # (build script to be added in Phase 6)

# point pi at the built extension
mkdir -p ~/.pi/agent/extensions/lossless-claw
ln -s "$PWD/dist/pi/index.js" ~/.pi/agent/extensions/lossless-claw/index.js

# or pass directly for a quick test
pi -e ./dist/pi/index.js
```

See [pi's extensions documentation](https://github.com/earendil-works/pi/blob/main/docs/extensions.md) for extension placement rules.

## Future npm flow

When the pi port reaches feature parity and the package is ready to publish under `@shaunbarlow/lossless-claw`, the upstream's Changesets-based workflow (described in [`CHANGELOG.openclaw-history.md`](./CHANGELOG.openclaw-history.md)'s lineage) can be reactivated. Until then, do not run `changeset publish` or related commands.
