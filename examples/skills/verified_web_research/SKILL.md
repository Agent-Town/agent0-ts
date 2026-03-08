# Skill: verified_web_research

## Purpose
Produce verifiable web research summaries with explicit citations and confidence scoring.

## Inputs
- `query`: What to investigate.
- `constraints`: Optional scope, date range, allowed domains, and output format.

## Workflow
1. Clarify ambiguities and restate the research objective.
2. Gather sources from at least two independent domains.
3. Prefer primary sources (official docs, standards, direct statements, raw datasets).
4. Record retrieval date for time-sensitive claims.
5. Mark uncertain claims and avoid presenting them as facts.

## Output Contract
- `summary`: Concise answer to the query.
- `evidence`: Bullet list of claims with source URLs.
- `gaps`: What is still unknown.
- `confidence`: `low`, `medium`, or `high`.

## Safety Rules
- Do not fabricate citations.
- Flag conflicts between sources.
- For security and finance topics, include explicit caveats and verification notes.
