# Releasing

This is the pi-port fork. npm publishing remains disabled until feature parity and packaging policy are explicitly approved. Record user-visible changes in the **Unreleased** section of [CHANGELOG.md](./CHANGELOG.md).

## Local install and verification

Pi loads the TypeScript extension directly through its bundled jiti loader; this package deliberately has no `dist/` build step.

```bash
# from a clean checkout
npm install
npm test
pi install .

# confirm the installed package loads without an LLM call
{ echo '{"jsonrpc":"2.0","id":1,"method":"shutdown","params":{}}'; sleep 1; } \
  | pi --mode rpc
```

`pi install .` adds the local package path to `~/.pi/agent/settings.json` without copying it. Use `pi install -l .` for project-local installation. Remove it with `pi remove /absolute/path/to/lossless-claw`.

For one-off development without changing pi settings:

```bash
pi -e ./src/pi/index.ts
```

For eventual git installation, users will install a pinned ref:

```bash
pi install git:github.com/shaunbarlow-stitch/lossless-claw@<tag-or-commit>
```

## Future npm flow

When the port is feature-complete and publication is approved, remove `private`, add the final package metadata, validate `npm pack`, and re-enable the upstream Changesets workflow. Do not run `changeset publish` before that approval.
