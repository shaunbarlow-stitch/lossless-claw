# Recall tools

The pi port registers two recall tools:

- `lcm_grep`: search the active conversation's stored history for terms, paths, identifiers, or phrases.
- `lcm_describe`: inspect a known summary (`sum_*`) or large-file (`file_*`) record.

Recommended workflow:

1. Use `lcm_grep` to find evidence.
2. Use `lcm_describe` only with an ID returned for a summary or file.
3. Quote retrieved evidence rather than reconstructing exact details from summaries.

`lcm_expand` and `lcm_expand_query` are not registered in the pi port. They depended on the removed OpenClaw gateway subagent protocol.
