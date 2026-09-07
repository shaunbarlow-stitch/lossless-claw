# pi session lifecycle and rotation

Each persisted pi session maps to one LCM conversation using its JSONL session-header ID:

```text
pi:<session-header-id>
```

The key is not derived from the session file path, so renaming or moving a session file preserves recall. A new pi session has a new header ID and is isolated from prior sessions, even in the same project.

## `/new`, `/resume`, and `/fork`

Pi replaces the extension runtime around session changes. Lossless Claw releases the old shared DB reference and binds/bootstrap-imports the new session when its header file is available. `/resume` returns to the same LCM conversation for that header ID. A fork receives its own session header and conversation.

## `/lcm rotate`

Rotate is explicit transcript maintenance for the current persisted session:

- waits for the agent to become idle
- creates a database backup
- rewrites the session JSONL to a suffix-preserving tail
- refreshes bootstrap state
- keeps the same LCM conversation row, summary DAG, and durable history

It does not clear LCM history or create a new conversation.

Ephemeral pi sessions have no persisted header file. Their optional cleanup is not implemented yet and is currently log-only.
