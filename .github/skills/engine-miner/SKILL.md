---
name: engine-miner
description: 'Use when discussing, planning, or implementing Engine miner, an Alkanes-linked AI-only token mining app where agents solve mathematical puzzles to win round rewards. Use for tokenomics, puzzle-model design, AI-only mining constraints, off-chain round architecture, and Alkanes settlement design.'
user-invocable: true
---

# Engine miner

Use this skill when working on Engine miner, the AI-only mining project inside this repository.

## Project Facts

- Token network target: Alkanes
- Total supply: 21,000,000
- Campaign duration: 48 hours
- Total rounds: 21,000
- Reward per round: 1,000 tokens
- Winner rule: first AI agent with a correct solution wins the round reward

## Non-Negotiable Constraint

Alkanes does not have separate native blocks. It settles through Bitcoin blocks and Bitcoin transactions.

Therefore:

- Do not design Engine miner as if it has 21,000 chain-level Alkanes blocks.
- Treat Engine miner rounds as application-level rounds.
- Assume rewards need batch settlement, epoch settlement, or claim-based settlement on Alkanes.

## Design Rules

1. Keep puzzle generation and winner selection off-chain in early versions.
2. Keep token accounting and reward settlement on Alkanes.
3. Treat "wins the block" as "wins the round" unless an explicit internal block abstraction is defined.
4. Favor fast verification and deterministic puzzle checking.
5. Preserve a math-first identity for mining work.
6. Explicitly call out that AI-only participation is difficult to prove cryptographically without attestation.

## Preferred Puzzle Families

Primary categories:

- symbolic equations
- constrained number theory
- sequence pattern discovery

Secondary categories:

- graph route search
- logic deduction
- hash-hybrid challenge

## Learned Reference Models From aiagentMiner

Use these mathematical patterns as references:

- Number theory: prime search under modular constraints, with CRT-style narrowing and primality testing
- Graph search: weighted directed path with required visits and budget limits
- Equation systems: planted integer solutions across linear, quadratic, mixed, cubic, modular, and sum-of-squares forms
- Logic deduction: CSP-style entity-to-property assignment with uniqueness checks
- Sequence mining: recurrence discovery across linear, modular, polynomial, and multi-term systems
- Hash-hybrid: solve a math question first, then satisfy a SHA-256 leading-zero-bit target

## Recommended Difficulty Model

Use a retarget model driven by:

- target solve time
- actual solve time
- unique agent pressure
- gradual baseline growth

Suggested formula shape:

- `timeFactor = clamp(targetSolveTime / actualSolveTime, 0.7, 1.5)`
- `agentPressure = 1 + 0.05 * log2(max(uniqueAgentsAttempted, 1))`
- `newDifficulty = currentDifficulty * timeFactor * agentPressure`

Use `log2(1 + difficulty)` as an effective difficulty mapping for puzzle parameter scaling.

## Recommended Working Procedure

1. Start from the current Engine miner project brief in `Engine miner/docs/`.
2. Check whether the task is about off-chain engine logic, Alkanes settlement, or miner-agent behavior.
3. Preserve the distinction between application rounds and Bitcoin/Alkanes settlement.
4. If proposing tokenomics changes, confirm they still sum correctly to the 21,000,000 total supply.
5. If proposing faster round cadence, avoid implying one on-chain event per round.
6. If proposing AI-only enforcement, state the trust model explicitly.

## When Writing Specs Or Code

- Prefer deterministic verification over expensive re-solving.
- Prefer planted-solution puzzle generation.
- Prefer replay-safe reward claims.
- Prefer batch or claim settlement over per-round on-chain minting.
- Keep contract scope minimal in v1.

## Deliverable Guidance

When asked to extend the project:

- update the living project brief first if the change affects scope or assumptions
- keep math models explicit, not hand-wavy
- note any mismatch between product speed and Bitcoin settlement constraints
