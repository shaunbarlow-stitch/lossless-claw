# Lossless Claw for pi

Lossless Claw is a pi extension that preserves long-running conversation history in a SQLite-backed summary DAG. It ingests every finalized message, reconstructs context before each model call, and provides retrieval tools for compacted history.

> This is the in-progress pi fork of `@martian-engineering/lossless-claw@0.11.2`. It is local-install only while the port reaches parity.

## Install from a local checkout

Requirements: pi `>=0.74 <1` and Node with `node:sqlite` support.

```bash
git clone git@github.com:shaunbarlow-stitch/lossless-claw.git
cd lossless-claw
npm install
pi install .
```

`pi install .` records the absolute local package path in your user pi settings; it does not copy the checkout. Restart pi (or run `/reload`) after changing extension source. To install only for one project, use `pi install -l .` from that project.

For a one-off development run without installing:

```bash
pi -e ./src/pi/index.ts
```

To remove the local package later:

```bash
pi remove /absolute/path/to/lossless-claw
```

## Use

Start pi normally after installation. The extension stores its user-wide data at:

- database: `~/.pi/agent/extensions/lossless-claw/lcm.db`
- large payloads: `~/.pi/agent/extensions/lossless-claw/files/`
- extension config: `~/.pi/agent/extensions/lossless-claw/config.json`

Commands:

```text
/lcm [status]                         Show LCM status.
/lcm backup                           Create a timestamped database backup.
/lcm rotate                           Back up and shrink the active session transcript tail.
/lcm doctor                           Scan the active conversation for broken summaries.
/lcm doctor apply                     Repair detected summaries.
/lcm doctor clean                     Scan legacy cleanup candidates; does not delete data.
/lcm doctor clean apply [filter] [vacuum]  Confirmed cleanup with a backup first.
```

The model can use `lcm_grep` to search stored history and `lcm_describe` to inspect a summary or large-file record.

## Configuration

Create `~/.pi/agent/extensions/lossless-claw/config.json` only when defaults need changing. Environment variables override this file. See [configuration reference](docs/configuration.md) for all keys and precedence.

## Status and limitations

Implemented: persistence, context assembly, `lcm_grep`, `lcm_describe`, and the `/lcm` command surface.

Not yet ported: in-process `lcm_expand`, ephemeral-session pruning, and an LCM-specific pi compaction hook. These do not block normal installation or recall testing.

## Development

```bash
npm test
```

See [the port tracker](docs/pi-port-plan.md) and [releasing notes](RELEASING.md).
