# Engine miner Provider Matrix

Date: 2026-05-25

Purpose: define the hosted-provider-first network plan for Engine miner v1, including which concerns stay local, which can run on Render, and which should be delegated to Subfrost, UniSat, Sandshrew, or a later self-hosted stack.

## Core Policy

- signet is the only required public pre-production network for Engine miner v1
- mainnet is the production target after signet validation
- classic Bitcoin testnet is not required for v1 parity because the current Alkanes deployment guidance is much clearer around signet and mainnet
- Render hosts the Engine miner application tier, not the full Bitcoin plus Alkanes indexing stack
- deployment keys, treasury keys, and admin signing authority stay off Render on a secure operator machine
- provider routing must be abstracted so one vendor outage does not force a code redesign

## Deployment Roles

| Role | Where It Runs | Responsibilities |
| --- | --- | --- |
| Local secure operator | developer workstation, secure laptop, HSM-backed signer, or equivalent | deploy signet and mainnet contracts, hold treasury and admin keys, sign emergency operations, approve manual migrations |
| Render application tier | Render web service, background worker, scheduled jobs | Engine miner backend, dashboard APIs, provider adapters, claim preparation, buyback coordination, monitoring |
| Hosted provider tier | Subfrost, UniSat, Sandshrew, Ordiscan | Bitcoin data, fee estimation, broadcast, indexed Alkanes state, reconciliation, explorer support |
| Future hardening tier | dedicated VM or stateful container host outside Render | `bitcoind`, `metashrew`, `jsonrpc`, contract indexer, data API, persistent chain databases |

## Provider Matrix By Concern

| Concern | Signet primary | Signet fallback | Mainnet primary | Mainnet fallback | Local only |
| --- | --- | --- | --- | --- | --- |
| Bitcoin chain height, block hash, raw transaction lookup | Subfrost | Sandshrew or validated UniSat signet key | UniSat or Subfrost | the other provider | no |
| Fee estimates | Subfrost | validated UniSat signet key | UniSat or Subfrost | the other provider | no |
| Address BTC balance and UTXO lookup | Subfrost | validated UniSat signet key | UniSat | Subfrost | no |
| Raw transaction broadcast | Subfrost or validated UniSat signet key | manual local broadcast path | UniSat | Subfrost | manual local fallback for treasury-sensitive operations |
| Indexed Alkanes token balances | Subfrost | UniSat if signet support is validated | Subfrost | UniSat | no |
| Alkanes contract events and traces | Subfrost | local deferred verification | Subfrost | UniSat if sufficient coverage exists | no |
| Explorer support for ops and customer support | Ordiscan or provider dashboards | n/a | Ordiscan or provider dashboards | n/a | no |
| Token deployment transaction construction | n/a | n/a | n/a | n/a | yes |
| Token deployment signing | n/a | n/a | n/a | n/a | yes |
| Treasury or claim-manager admin signing | n/a | n/a | n/a | n/a | yes |

## Practical Recommendation

### Signet

- primary hosted provider: Subfrost
- fallback provider: Sandshrew or UniSat once the live signet API key is validated against the exact methods Engine miner needs
- use signet for public testing and collaborative validation
- deploy the signet Engine token and any signet DIESEL-like test asset from the local secure operator environment

### Mainnet

- primary Alkanes indexed-state provider: Subfrost
- primary Bitcoin data and broadcast provider: UniSat or Subfrost, selected by cost, reliability, and method coverage during integration testing
- fallback provider: whichever of Subfrost or UniSat is not primary
- keep all deployment and treasury signing local even when day-to-day claim traffic uses hosted providers

## Provider Adapter Requirements

- one adapter for Bitcoin-facing operations: fee rates, BTC balance, UTXOs, tx fetch, broadcast
- one adapter for Alkanes-facing operations: balances, token metadata, holder views, event history, traces
- network-specific configuration for signet and mainnet
- fallback routing when a primary provider fails, rate limits, or lags
- reconciliation checks so claim status and balances can be compared across providers before any irreversible treasury action

## Non-Goals For V1

- do not run the full `bitcoind + metashrew` stack inside Render
- do not require classical Bitcoin testnet in addition to signet just for conceptual symmetry
- do not store deployment or treasury keys in the Render environment

## Upgrade Trigger For Self-Hosting

Move from hosted-provider-first to self-hosted chain infrastructure when one or more of these become true:

- hosted providers become a single point of failure for claims or treasury operations
- rate limits or indexing lag materially affect user-visible balances or claim status
- daily treasury exposure becomes too large to trust to third-party availability alone
- compliance, audit, or incident response requires a self-controlled source of truth