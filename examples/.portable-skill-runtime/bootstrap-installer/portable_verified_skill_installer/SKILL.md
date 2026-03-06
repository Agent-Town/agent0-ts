# Skill: portable_verified_skill_installer

## Purpose
Install and run verifiable `SKILL.md` packages by:
1. installing local helper tools,
2. downloading skill content from a URI,
3. verifying a pinned hash,
4. installing the skill for a target runtime,
5. using the verified skill instructions.

## Inputs
- `skillAgentId`: On-chain `chainId:tokenId` of the skill entity.
- `skillUri`: URI to the raw `SKILL.md` bytes (`ipfs://` or `https://`).
- `expectedSha256`: Pinned SHA-256 hash in hex (`0x...`).
- `targetRuntime`: One of `codex`, `claude-code`, `chatgpt`, `claude`.

## Tool Bootstrap
Install (or generate) the following helper tools in the agent workspace:
- `fetch-skill.mjs`: Downloads raw markdown from IPFS gateways or HTTP(S).
- `verify-skill.mjs`: Computes `sha256` for downloaded bytes.
- `install-manifest.json`: Tracks installed tool versions and paths.

## Verification Workflow
1. Resolve `skillUri`, `expectedSha256`, and `hashAlg` from chain metadata.
2. Download exact `SKILL.md` bytes.
3. Compute SHA-256 over UTF-8 bytes.
4. Compare with pinned hash.
5. Abort install on mismatch.
6. Persist a local install receipt with metadata + verified hash.

## Runtime Adapters
- `codex`:
  - Install to `$CODEX_HOME/skills/<skillId>/SKILL.md`.
- `claude-code`:
  - Install to `$CLAUDE_CODE_SKILLS_DIR/<skillId>/SKILL.md` (or configured fallback path).
- `chatgpt`:
  - Export a prompt bundle markdown for manual paste/import.
- `claude`:
  - Export a prompt bundle markdown for manual paste/import.

## Use After Install
When the skill is verified and installed, the agent:
1. loads the `SKILL.md`,
2. builds a task-specific scaffold prompt,
3. executes the task using only verified instructions.

## Safety Rules
- Never execute an unverified `SKILL.md`.
- Never ignore hash mismatches.
- Include provenance (agent id, URI, expected hash, computed hash, timestamp) in install receipts.
