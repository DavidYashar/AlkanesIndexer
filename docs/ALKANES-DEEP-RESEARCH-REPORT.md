# Alkanes Deep Research Report

Date: 2026-05-24

Scope: This report consolidates the research performed in this workspace on Alkanes, with emphasis on:

- What Alkanes actually is
- How execution works from Bitcoin transaction to indexed state
- DIESEL token mechanics and upgrade behavior
- frBTC wrap, unwrap, solvency, and custody model
- Governance claims versus what is visibly implemented and deployed

This report is based on repository inspection, tests, implementation code, deployment scripts, and the public Alkanes site.

## Executive Summary

Alkanes is best understood as a Bitcoin L1 metaprotocol with indexed WASM execution, not as a conventional layer 2 with a sequencer, validator set, or separate settlement domain. It uses Bitcoin transactions as the data source, Protorunes as the message and balance-carrier layer, and a Metashrew-based indexer stack to deterministically derive smart-contract state from chain data.

The architecture is coherent in code. Contracts are WASM binaries, deployed or bootstrapped into indexed state, then executed by an Alkanes-aware runtime whenever a Protorune message with protocol tag `1` is encountered. The critical execution path is real and inspectable: Bitcoin transaction -> Runestone -> Protostone -> Cellpack -> runtime context -> WASM execution -> indexed storage and balance reconciliation.

The economic story is more mixed. DIESEL clearly exists as a core ecosystem asset at Alkane ID `[2,0]`, but the code does not support the strongest public claims that it is a protocol gas token. Execution costs are enforced via Bitcoin miner fees plus runtime fuel metering. After upgrade, DIESEL becomes a hybrid block-reward plus fee-capture asset, with owner-controlled fee collection using auth-token-based control.

frBTC is not a trustless bridge. It behaves like a signer-backed wrapped BTC system with a premium, a queued unwrap mechanism, and a custody model centered on a signer address that can be queried and, in some cases, updated through authenticated flows. The repository includes enough tests and tooling to reconstruct these mechanics, even though the readable Rust source for the genesis frBTC contract itself is not exposed in the same way as DIESEL.

Governance currently looks more like a product direction plus deployment scaffolding than a transparently live, fully visible on-chain governance system. Governance-related templates and compiled WASMs are present. The live site exposes governance, forum, and vault pages. But the visible public state is empty, and the default open-source regtest deployment scripts leave the core veDIESEL and gauge instantiation flows commented out.

## Research Method

The conclusions in this report were derived from the following sources:

- Public repository top-level docs, especially `README.md` and `FAQ.md`
- Core runtime and indexing code under `crates/alkanes`, `crates/alkanes-runtime`, `crates/protorune`, `crates/protorune-support`, and `crates/alkanes-support`
- Canonical tests, especially `crates/alkanes/src/tests/genesis_upgrade.rs` and `crates/alkanes/src/tests/fr_btc.rs`
- CLI and operator tooling under `crates/alkanes-cli-common`
- Deployment scripts under `scripts/`
- Public site content at `https://alkanes.build/`

## Part I: What Alkanes Is

### High-level identity

The repo and FAQ align on the core point that Alkanes is not a traditional rollup.

- `FAQ.md` describes Alkanes as a Bitcoin L1 metaprotocol that brings WASM smart contracts to Bitcoin and explicitly says it has no sequencer and no separate validator set.
- `README.md` describes Alkanes as a metaprotocol designed for DeFi on Bitcoin and explicitly notes that it does not have a network token.

The cleanest description is:

> Alkanes is a Protorunes-compatible Bitcoin metaprotocol that treats Bitcoin blocks and transactions as the canonical data source and uses deterministic indexed WASM execution to derive smart-contract state.

That differs from a normal L2 in three important ways:

1. There is no separate consensus process for contract execution.
2. There is no sequencer ordering layer beyond Bitcoin block order.
3. State is not enforced by Bitcoin script itself; it is derived by Alkanes-aware indexers replaying chain data.

### What that means operationally

The phrase "runs on Bitcoin" is true, but only with care. Bitcoin itself does not execute Alkanes WASM contracts at consensus level. Instead:

- Bitcoin stores the relevant transaction data
- Protorunes identifies the protocol messages and virtual balances
- Metashrew plus the Alkanes runtime interprets and executes the contracts
- Any correct Alkanes-aware indexer should derive the same result from the same chain data

That is why the project can plausibly call itself a sovereign-style Bitcoin execution system while still being technically different from both native Bitcoin script and a sequencer-based rollup.

## Part II: Architecture Deep Dive

### Core execution path

The controlling path through the codebase is:

1. `crates/alkanes/src/indexer.rs`
2. `Protorune::index_block::<AlkaneMessageContext>(...)`
3. `crates/protorune/src/protostone.rs`
4. `crates/alkanes/src/message.rs`
5. `crates/alkanes/src/vm/*`
6. Storage and balance reconciliation back into the Metashrew index

Each step matters.

### 1. Block indexing entrypoint

`crates/alkanes/src/indexer.rs` is the top-level block handler.

Per block, it does the following:

- Configures network address prefixes
- Clears view mode and DIESEL mint caches
- Detects whether this is the effective genesis initialization point
- Bootstraps the core system contracts if the protocol is active
- Applies precompiled upgrades when configured heights are reached
- Initializes the fuel tank for the block
- Runs Protorune indexing for protocol tag `1`
- Updates the frBTC unwrap tracker after execution

This is the clearest evidence that Alkanes state is derived inside an indexer environment rather than a separate chain.

### 2. Genesis and system bootstrap

`crates/alkanes/src/network.rs` installs the system contracts and seeds genesis state.

Verified fixed IDs:

- DIESEL: `[2,0]`
- frBTC: `[32,0]`
- frSIGIL: `[32,1]`

Important bootstrap functions:

- `setup_diesel(block)`
- `setup_frbtc(block)`
- `setup_frsigil(block)`
- `genesis()`
- `check_and_upgrade_precompiled(height)`

The bootstrap flow is not just code installation. Each core contract is initialized through a simulated parcel call after its WASM bytes are inserted into indexed storage. This means the system contracts start life with populated storage and balances, not just raw code bytes.

The same file also defines the upgrade checkpoints. At configured block heights, DIESEL is swapped to upgraded variants, and frBTC can be replaced with a newer precompiled binary as part of the EOA-upgrade phase.

### 3. Protorunes handoff and message parcel construction

The handoff into Alkanes happens through the Protorune message processor in `crates/protorune/src/protostone.rs`.

This layer:

- Parses Runestone payloads into Protostones
- Validates pointer and refund targets
- Tracks balances by output, including virtual outputs for protostones
- Builds a `MessageContextParcel`
- Wraps the full execution in an atomic checkpoint
- Refunds value to the refund pointer on failure

The important implication is that Alkanes contract execution is balance-aware and tied to the Protorunes balance sheet machinery. Incoming balances to a contract call are not abstract; they are concretely carried through the parcel and reconciled against outputs.

### 4. Protostone and Cellpack encoding

Two small support modules explain the wire format clearly:

- `crates/protorune-support/src/protostone.rs`
- `crates/alkanes-support/src/cellpack.rs`

`Protostone` includes:

- protocol tag
- message bytes
- pointer
- refund pointer
- optional burns
- optional edicts

`Cellpack` is the contract-call payload inside the protostone message and is simply:

- target block
- target tx
- input vector of `u128`

So the effective message model is:

Bitcoin tx -> Runestone payload -> Protostone envelope -> Cellpack target and opcode inputs

### 5. Alkanes message handling

`crates/alkanes/src/message.rs` is the main message bridge.

Confirmed facts:

- The Alkanes protocol tag is `1`.
- `handle_message()` decodes the cellpack from the parcel calldata.
- It constructs an `AlkanesRuntimeContext` from the parcel and cellpack.
- It resolves special cellpacks before normal execution.
- It credits incoming balances to the contract.
- It prepares runtime context for the call.
- It allocates fuel for the transaction.
- It runs the WASM execution path.
- It writes returned storage into indexed storage.
- It reconciles outgoing balances and persistent runtime balances.
- It records traces and revert data.

This file is the clearest single statement of what the runtime believes a contract call is: a deterministic transformation from parcel plus indexed state into storage changes, outgoing token transfers, and trace data.

### 6. WASM runtime surface

`crates/alkanes-runtime/src/runtime.rs` defines the contract-facing ABI wrappers.

Contracts can access:

- `context()`
- `transaction()` and `transaction_id()`
- `block()` via helper methods
- `load()` and `store()` for storage
- `balance()`
- `sequence()`
- `fuel()`
- `height()`
- `call()`
- `delegatecall()`
- `staticcall()`

This is not EVM-compatible semantics dressed up in WASM. It is its own runtime model, but it deliberately exposes enough context for complex contract behavior and composition.

### 7. Host function wiring and extcalls

`crates/alkanes/src/vm/instance.rs` wires the WASM imports to host functionality.

The runtime exposes explicit imported functions such as:

- `__call`
- `__delegatecall`
- `__staticcall`
- `__request_context`
- `__load_context`
- `__request_block`
- `__load_block`
- `__request_transaction`
- `__load_transaction`
- storage and balance helpers

`execute()` in the same module wraps execution in checkpoint and rollback behavior. If the call fails or marks failure, the instance rolls back and surfaces revert data.

### 8. Special extcalls and precompiles

`crates/alkanes/src/vm/host_functions.rs` implements a hidden precompile space keyed under block `800000000`.

Verified mapping:

- `[800000000,0]` -> block header
- `[800000000,1]` -> coinbase transaction
- `[800000000,2]` -> number of DIESEL mints in the current block
- `[800000000,3]` -> total miner fee proxy derived from coinbase outputs

The `number_diesel_mints` precompile scans the current block, deciphers Runestones, filters to protocol tag `1`, decodes cellpacks, and counts DIESEL mint opcodes. The result is cached per block.

This is a crucial architectural detail because the upgraded DIESEL economics are not driven by a separate governance ledger. They are computed inside contract execution from current-block inspection.

### 9. Contract creation and template patterns

`crates/alkanes/src/vm/utils.rs` implements the special create and factory patterns.

Observed deployment patterns:

- `[1,0]` means CREATE into the next available `[2,n]`
- `[3,n]` means create a reserved contract into `[4,n]`
- `[6,n]` means clone a template from `[4,n]` into the next `[2,n]`

This is consistent with the comments and usage in:

- `scripts/deploy-regtest.sh`
- `scripts/deploy-subfrost-regtest.sh`

The implication is that a substantial amount of system deployment is meant to be done through reserved template slots and cloning flows, not only through one-off user deployment.

### 10. Fuel model

Fuel is implemented in `crates/alkanes/src/vm/fuel.rs`.

Important points:

- Fuel is metered by transaction and block, based on virtual transaction size.
- This is runtime fuel, not a DIESEL-denominated gas token model.
- frBTC at `[32,0]` is explicitly whitelisted as a gasless contract for tx-level charging.

The reason is documented directly in the source: frBTC wrap and unwrap parse full Bitcoin transactions and would otherwise consume nearly the entire tx fuel budget in common flows.

This exemption matters for two reasons:

1. It confirms that execution cost is enforced at runtime, not via DIESEL gas spending.
2. It shows that the system already relies on trusted special cases for system contracts.

## Part III: DIESEL Tokenomics

### Identity and placement

DIESEL is the genesis Alkane at `[2,0]`.

The canonical readable contract source exists in:

- `alkanes/alkanes-std-genesis-alkane/src/lib.rs`
- `alkanes/alkanes-std-genesis-alkane-upgraded/src/lib.rs`
- `alkanes/alkanes-std-genesis-alkane-upgraded-eoa/src/lib.rs`

### Legacy DIESEL behavior

The original DIESEL contract behaves like a block-reward token.

Key properties:

- Initialization mints a premine.
- Minting is restricted to once per block via `observe_mint()`.
- Each successful mint adds the current block reward to total supply.
- Supply grows mechanically unless capped by chain configuration.

On regtest:

- Premine: `50_000_000`
- Block reward at the start: `5_000_000_000`

The contract uses a chain trait to derive reward behavior and, in the legacy contract, the premine can be derived from blocks since genesis depending on network configuration.

### Upgrade mechanics

The upgraded DIESEL contract introduces materially different economics.

Important additions:

- `/fees` claimable fee storage
- `/upgraded_seen` tracking for upgraded minting
- transaction hash replay protection via `/tx-hashes/`
- owner-authenticated fee collection
- upgraded mint accounting based on block inspection

The upgrade path is activated in `network.rs` by replacing the stored precompiled binary at `[2,0]` once the configured height is reached.

### Upgraded mint formula

The upgraded mint path computes:

- `total_mints` from the current block
- `total_miner_fee` from coinbase output value
- `block_reward`
- `total_tx_fee = max(total_miner_fee - block_reward, 0)`
- `diesel_fee = min(block_reward / 2, total_tx_fee)`
- `value_per_mint = (block_reward - diesel_fee) / total_mints`

This has three consequences:

1. Some value is siphoned into claimable DIESEL fees.
2. The fee skim is capped at 50 percent of block reward.
3. The remaining reward is divided across all DIESEL mint calls in the block.

This means upgraded DIESEL is no longer a plain one-minter-per-block emission token. It becomes a block-participation asset whose economics depend on both mint crowding and miner-fee conditions.

### Fee collection and control

`collect_fees()` is owner-only in the upgraded contracts.

The upgrade call also deploys five auth tokens, and the tests confirm fee collection by spending the auth-controlled outpoint.

This means fee capture is not automatically socialized by default. It is routed through authenticated ownership logic.

### EOA-only upgrade phase

The EOA-upgraded version adds another meaningful restriction:

- DIESEL minting must be initiated by an EOA-style first call in a protostone
- Non-EOA contract-mediated mint attempts revert

This is enforced by checking that the caller is the sentinel `[0,0]` origin in the upgraded EOA contract.

### Burn support

The EOA-upgraded contract also adds explicit burn behavior:

- burning reduces total supply
- attempting to burn more than the incoming amount reverts

This is validated in `crates/alkanes/src/tests/genesis_upgrade.rs`.

### Tests that anchor DIESEL conclusions

The most important DIESEL tests are in `crates/alkanes/src/tests/genesis_upgrade.rs`.

They confirm:

- successful upgrade
- legacy and upgraded mint incompatibility in the same block
- value split across multiple upgraded mints
- EOA-only mint enforcement
- burn behavior and over-burn rejection
- fee collection from claimable DIESEL fees

These tests are strong evidence that the upgraded DIESEL economic model is intentional rather than incidental.

## Part IV: frBTC Mechanics

### Identity

frBTC is the genesis BTC-wrapped Alkane at `[32,0]`.

frSIGIL lives at `[32,1]` and appears to be the corresponding auth or control asset in the BTC wrapping system.

### Source visibility caveat

Unlike DIESEL, the readable Rust source for the genesis frBTC contract is not exposed in the repo in the same way as the genesis DIESEL contract. Instead, the project ships and bootstraps a precompiled WASM for frBTC.

So frBTC behavior here is inferred from:

- precompiled binary installation in `crates/alkanes/src/network.rs`
- tests in `crates/alkanes/src/tests/fr_btc.rs`
- unwrap tracking in `crates/alkanes/src/unwrap.rs`
- operator tooling in `crates/alkanes-cli-common/src/subfrost.rs`
- related integration tests such as `crates/alkanes-integ-tests/tests/frbtc_set_signer.rs`

That evidence is still strong enough to describe the mechanics with confidence.

### Wrap behavior

The canonical wrap test is in `crates/alkanes/src/tests/fr_btc.rs`.

Observed behavior:

- A Bitcoin transaction sends BTC to the correct signer-controlled Taproot output.
- A cellpack calls frBTC opcode `77`.
- If BTC was sent to the correct signer output, frBTC is minted.
- If BTC was not sent to the correct signer output, no frBTC is minted.

In the test flow:

- `100_000_000` sats sent to signer
- `99_900_000` frBTC minted

That implies a default premium of `100_000` parts per `100_000_000`, or 0.1 percent.

The same wrap flow in the canonical test also mints `5_000_000_000` DIESEL, because the test transaction includes a DIESEL mint protostone alongside the frBTC wrap.

### Signer model

The signer address is not treated as a normal user address. It is a special subfrost signer address derived from frBTC contract data.

The tooling path is visible in `crates/alkanes-cli-common/src/subfrost.rs` and `crates/alkanes-cli-common/src/address_resolver.rs`:

- query frBTC with opcode `103`
- receive signer pubkey or signer-script data
- convert it to a Taproot address

This is operationally important because it means the minting condition depends on sending BTC to a contract-controlled signer destination, not merely on calling a wrap opcode.

### Opcode 103 nuance

There is documentation drift around opcode `103` in the repo. The frBTC tooling clearly treats `103` as GET_SIGNER for frBTC. Some unrelated or experimental docs describe opcode `103` differently in other contexts.

The correct safe conclusion is:

- For frBTC, the active tooling and tests treat opcode `103` as the signer query path.
- Opcode numbers are contract-local, so documentation using the same numeric opcode elsewhere is not automatically a contradiction unless it refers to the same contract.

### Unwrap behavior

The canonical unwrap path is tested in `crates/alkanes/src/tests/fr_btc.rs` and tracked in `crates/alkanes/src/unwrap.rs`.

Observed behavior:

- frBTC opcode `78` burns some or all of a frBTC balance.
- The burn produces a `Payment` record representing a pending BTC obligation.
- That `Payment` contains a spendable outpoint and a desired output script/value.
- If the requested burn exceeds available frBTC, the actual burn is clamped to the available amount in the test flow.
- The resulting pending payments can be viewed through the unwrap view path.

This means unwrap is not immediate native BTC redemption at call time. It creates a tracked pending obligation that must later be fulfilled by spending the designated outpoint.

### Pending unwrap tracking

`crates/alkanes/src/unwrap.rs` maintains the pending unwrap view.

Key details:

- frBTC storage is read under a specific indexed storage pointer
- pending payments are indexed by block height
- a cache of pending payments is built and incrementally maintained
- fulfillment is determined by whether the spendable outpoint is still marked spendable in the Protorune tables
- `last_block` advances only when earlier pending work is cleared

This is a strong signal that frBTC redemptions are modeled as queued obligations rather than synchronous redemptions.

### Solvency model

`crates/alkanes-cli-common/src/subfrost.rs` includes a solvency check routine.

It does the following:

1. Derives the frBTC vault or signer address via opcode `103`
2. Fetches BTC UTXOs at that address
3. Reads frBTC total supply
4. Reads pending unwrap obligations
5. Compares vault BTC balance against total frBTC supply

The key interpretation is that the real liability is considered to be total frBTC supply, not merely pending unwraps.

That is exactly how a custodied wrapped asset is usually analyzed. The system assumes there is a signer-controlled BTC vault that should be able to cover the outstanding wrapped supply.

### Custody implications

Based on the tests and tooling, frBTC should be treated as:

- signer-backed
- operator-mediated for unwrap fulfillment
- premium-charging on wrap
- solvency-sensitive

It should not be described as a trustless bridge in the usual cryptographic sense.

### Signer administration

`crates/alkanes-integ-tests/tests/frbtc_set_signer.rs` demonstrates a flow where a custom frBTC deployment can be initialized with a signer and where signer-related behavior is tied to an auth asset.

Combined with the revert tested in `crates/alkanes/src/tests/fr_btc.rs` for unauthorized signer changes, this indicates that signer management is an authenticated administrative surface.

That further confirms the custody and operator-dependence of the frBTC system.

## Part V: Governance Sanity Check

### What the site claims

The live docs and dashboard currently expose governance as a first-class concept.

Observed public-site claims and sections:

- The docs page describes DIESEL as the native governance token used for voting, gas, and staking.
- The dashboard exposes proposals and DIESEL vault sections.
- Public governance and forum pages exist.

### What the public pages currently show

At the time of research, the live English pages showed:

- Governance: "No proposals found"
- Forum: "No discussions found"
- Vaults: `0.00 DIESEL` TVL and `0` active pools

So governance is exposed in the product surface, but the visible live state appears empty.

### What the repo contains

The repo contains governance-related compiled WASMs in `prod_wasms/`, including:

- `ve_diesel_vault.wasm`
- `ve_token_vault_template.wasm`
- `yve_diesel_vault.wasm`
- `yve_token_nft_template.wasm`
- `vx_frost_gauge.wasm`
- `vx_token_gauge_template.wasm`
- `gauge_contract.wasm`

This shows that governance and voting-escrow-like mechanics are not imaginary. There is real artifact inventory for them.

### What the default deployment scripts actually do

The most important evidence is in:

- `scripts/deploy-regtest.sh`
- `scripts/deploy-subfrost-regtest.sh`

Those scripts:

- reserve template slots under `[4,0x1f20-0x1f2f]`
- deploy template contracts for ve-token vaults, YVE NFTs, and VX gauges
- describe veDIESEL, yveDIESEL, and vxDIESEL as instances that should be created from those templates

But the core Phase 5 governance instantiation flow is commented out in both scripts.

That means the open deployment path does not, by default, stand up the full DIESEL governance system even though the scripts and comments clearly anticipate it.

### Governance conclusion

The safest conclusion is:

- governance-related contract artifacts and template patterns exist
- governance branding is live on the public site
- default open-source deployment does not visibly instantiate the full governance stack
- current public governance activity appears empty

So governance is better described as partially implemented and productized, but not transparently evidenced as a live, active, mature public governance system from the materials inspected here.

## Part VI: Contradictions And Drift

### 1. "No network token" versus DIESEL as governance and gas token

The strongest contradiction is between:

- `README.md`: Alkanes does not have a network token
- public docs: DIESEL is used for voting, gas, and staking

What the code supports:

- DIESEL is undeniably a real core asset
- DIESEL has mint, burn, fee, and governance-adjacent roles
- execution protection is implemented through wasmi fuel plus Bitcoin fees
- there is no evidence in the runtime inspected here that DIESEL is actually spent as protocol gas

So the stronger public statement about DIESEL as a gas token appears ahead of the code-based evidence.

### 2. Wrap-BTC docs versus current CLI builder

`docs/features/wrap-btc.md` still describes a two-protostone flow with a vault lock after mint.

But `crates/alkanes-cli-common/src/alkanes/wrap_btc.rs` currently constructs a single-protostone wrap flow that:

- sends BTC to the signer output
- calls frBTC opcode `77`
- points minted frBTC directly to the recipient output

So the doc and the current builder are out of sync.

### 3. frBTC source visibility

The project exposes DIESEL source directly but relies on precompiled frBTC binaries for the genesis install path. That makes frBTC more opaque and pushes interpretation toward tests and tooling rather than a single readable contract source.

### 4. Governance presentation versus default deployment

The site presents governance as a built feature surface. The scripts show serious intent. But the commented-out default instantiation path means the open deployment story is less complete than the presentation implies.

## Part VII: Practical Interpretation

If evaluating Alkanes as a protocol, the strongest technically grounded statements are:

- It is a real Bitcoin-indexed WASM metaprotocol.
- The core execution path from Bitcoin transaction to indexed contract state is coherent and inspectable.
- System contracts are bootstrapped as precompiled WASM and live at well-known IDs.
- DIESEL is a real core asset, but the runtime does not support marketing language that implies DIESEL is the base protocol gas token.
- frBTC behaves like a signer-backed wrapped BTC system with premiums, queued redemption obligations, and solvency risk.
- Governance exists more convincingly as artifacts, templates, and UI surface than as an obviously active, transparent live system in the default public flows examined here.

If evaluating Alkanes as a product or investment thesis, the most important cautions are:

- distinguish deterministic indexing from trustless consensus execution
- distinguish ecosystem token utility from protocol gas-token status
- distinguish signer-backed wrap mechanics from trustless bridge semantics
- distinguish governance branding from visibly instantiated and active governance infrastructure

## Part VIII: Key Verified Facts

- Alkanes protocol tag is `1`.
- DIESEL is bootstrapped at `[2,0]`.
- frBTC is bootstrapped at `[32,0]`.
- frSIGIL is bootstrapped at `[32,1]`.
- Upgraded DIESEL reads block-local mint count and fee data via precompiles.
- Upgraded DIESEL fee skim is capped at 50 percent of block reward.
- The EOA-upgraded DIESEL contract restricts mint initiation to EOA-style first-call origin.
- frBTC wrap mints only when BTC is sent to the correct signer output.
- The canonical wrap test implies a 0.1 percent premium.
- frBTC unwrap creates pending payment obligations rather than immediate BTC redemption.
- Solvency tooling compares signer-vault BTC balance against total frBTC supply.
- Governance template deployment exists, but default regtest governance instantiation is commented out.
- Public governance, forum, and vault surfaces currently appear empty.

## Part IX: Open Uncertainties

The following points remain less transparent from the inspected materials:

- the full readable source of the genesis frBTC contract as currently bootstrapped on the main path
- whether the live production governance system, if any, is deployed through a path not reflected in the public default scripts
- how much of the public-site token and governance language reflects future roadmap rather than already-active protocol behavior

These are not blockers to understanding the core architecture, but they do limit how strongly one should generalize product claims from the available code.

## Final Conclusion

Alkanes is technically most convincing as a Bitcoin metaprotocol for deterministic indexed WASM execution. The execution architecture is substantial, not hand-wavy. The path from Bitcoin transaction to contract execution and indexed state mutation is explicit in the code and backed by tests.

The weakest part of the public story is not the architecture. It is the economic and governance presentation. DIESEL is real and important, but its role in code is more nuanced than the public docs language suggests. frBTC is functional, but it is a signer-backed wrapped asset with custody and solvency assumptions. Governance is visibly scaffolded and branded, but the public evidence of live, populated, default governance deployment is thin.

In practical terms:

- architecture: credible
- runtime model: clear
- tokenomics: real but more centralized and upgrade-dependent than simple branding suggests
- frBTC: useful but custodial in structure
- governance: present as scaffolding and UI, not yet strongly evidenced as active public infrastructure by the inspected materials