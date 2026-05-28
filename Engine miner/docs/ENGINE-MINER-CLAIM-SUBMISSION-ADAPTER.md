# Engine miner Claim Submission Adapter

Date: 2026-05-25

Purpose: map the current `POST /v1/claims/submit` scaffold to the real provider-backed adapter shape needed for signet and mainnet.

## Current Live Signet Status

- Backend claim submission now uses a local `alkanes-cli` executor path instead of the prior ts-sdk execute bridge.
- Deterministic signet validation reaches `POST /v1/claims/submit`, but hosted Subfrost still fails the indexed-state sync precheck.
- Verified current blocker: `metashrew_height` returns `-32603 error decoding response body` on both `https://signet.subfrost.io/v4/jsonrpc` and `https://signet.subfrost.io/v4/subfrost`, after which repeated retries hit Subfrost IP rate limits.
- Practical implication: the remaining signet failure is provider-side endpoint compatibility or missing authenticated access, not backend claim receipt verification, wallet signature verification, or CLI argument wiring.
- Current execution decision: stop depending on hosted signet indexed-state for the unblock path. Run `bitcoind -signet -txindex` on the older Ubuntu laptop, then point local Metashrew and local `alkanes-jsonrpc` on the main development laptop at that remote Bitcoin RPC.
- Confirmed on 2026-05-28 from the Ubuntu host: `getblockchaininfo` shows `blocks=headers=306288`, `verificationprogress=1`, and `initialblockdownload=false`, so the Signet chain sync gate itself is complete.
- Confirmed on 2026-05-28 from the Ubuntu host: `getindexinfo` shows `txindex.synced=true` with `best_block_height=306377`, so the node is fully ready as a remote Signet RPC backend.
- Confirmed on 2026-05-28 from the main development laptop: local `docker-compose.signet-remote.yaml` now starts successfully against the remote Ubuntu Signet RPC after removing the host-side WASM bind mount and normalizing CRLF in the Metashrew entrypoint during image build.
- Confirmed on 2026-05-28 from the main development laptop: `btc_getblockcount` at `http://127.0.0.1:18888` returns Signet height `306386`, and `metashrew_height` at `http://127.0.0.1:8080` returns `26`.
- Confirmed on 2026-05-28 from the main development laptop: `Engine miner/engine-miner-server/.env` is repointed to local `SUBFROST_JSONRPC_URL=http://127.0.0.1:18888` and `ENGINE_MINER_ALKANES_RPC_URL=http://127.0.0.1:8080`.
- Current next checkpoint: re-run the Engine miner claim-settlement path against the local split-machine Signet stack.

## Current Infra Decision

- Ubuntu laptop role: Bitcoin Signet node only.
- Main development laptop role: `rockshrew-mono`/Metashrew, `alkanes-jsonrpc`, Engine miner backend, and the rest of the app stack.
- Explorer side: keep using public Mempool Signet Esplora for the settlement builder and explorer-style BTC reads instead of trying to self-host electrs in the split-machine setup.
- Why this split: the repo already treats Esplora and Bitcoin RPC as separate concerns, while Metashrew still expects a Bitcoin daemon RPC source.

## Current Sync Gate

Treat the Ubuntu node as ready for local Metashrew wiring when all of the following are true:

- `bitcoin-cli -signet getblockchaininfo` shows `initialblockdownload: false`
- `bitcoin-cli -signet getblockcount` stays near current public Signet tip
- `bitcoin-cli -signet getindexinfo` shows `txindex` ready
- remote RPC is reachable from the main laptop over the chosen private network path

Status on 2026-05-28:

- first three checks are complete
- remaining gate is only private remote RPC reachability

## Current Scaffold

Today the backend accepts this simplified request:

```json
{
  "signedClaim": {
    "schema": "engine-miner-signed-claim-v1",
    "claimId": "claimset_123",
    "signedAt": "2026-05-25T12:02:00.000Z",
    "preparedClaim": {},
    "walletSignature": {}
  }
}
```

This is enough for local verification and relay handoff, but it is not enough for the final production flow because it does not explicitly carry the fee-payment transaction that determines whether the provisional winner actually satisfied the 2-minute payment rule.

## Target Request Shape

The production adapter should evolve `POST /v1/claims/submit` into a combined payment-plus-settlement handoff.

```json
{
  "claimReservationId": "reservation_123",
  "claimId": "claimset_123",
  "minerId": "miner_123",
  "network": "signet",
  "feePayment": {
    "fundingAddress": "bc1q...",
    "addressType": "p2wpkh",
    "txid": "fee_txid_abc",
    "rawTxHex": "optional-raw-hex",
    "submittedAt": "2026-05-25T12:01:10.000Z",
    "provider": "unisat"
  },
  "signedClaim": {
    "schema": "engine-miner-signed-claim-v1",
    "claimId": "claimset_123",
    "signedAt": "2026-05-25T12:01:30.000Z",
    "preparedClaim": {},
    "walletSignature": {}
  },
  "providerHints": {
    "bitcoinPrimary": "unisat",
    "bitcoinFallback": "subfrost",
    "alkanesPrimary": "subfrost"
  }
}
```

## Target Validation Responsibilities

Before accepting the claim, the backend adapter should verify all of the following:

- the reservation is still active and within the 2-minute payment window
- the claim id belongs to the provisional winner currently at the head of the FCFS queue
- the fee-payment tx really exists on the target network
- the fee-payment tx came from an approved funding wallet for that miner
- the fee-payment tx includes at least 7,000 sats to the treasury path
- the signed claim still verifies against the backend-issued receipt
- the payout address inside the signed claim still matches the intended recipient for the round

## Target Response Shape

```json
{
  "claimId": "claimset_123",
  "reservationStatus": "payment_accepted",
  "paymentTxid": "fee_txid_abc",
  "settlementStatus": "queued_for_settlement",
  "settlementTxid": null,
  "provider": "engine-miner-settlement-adapter",
  "acceptedAt": "2026-05-25T12:01:31.000Z",
  "nextPollAfterMs": 2000
}
```

Possible `settlementStatus` values:

- `payment_rejected`
- `reservation_expired`
- `payment_accepted`
- `queued_for_settlement`
- `settlement_submitted`
- `settlement_confirmed`

## Adapter Interface By Provider

### Bitcoin provider adapter

Required methods:

- `getRecommendedFees(network)`
- `getAddressUtxos(network, address)`
- `getAddressSpendableBalance(network, address)`
- `getTransaction(network, txid)`
- `broadcastTransaction(network, rawTxHex)`

### Alkanes provider adapter

Required methods:

- `getAlkane(network, alkaneId)`
- `getAddressAlkaneBalances(network, address)`
- `getTransactionTrace(network, txid)`
- `waitForIndexedTransaction(network, txid)`

## Network Routing

### Signet

- short-term unblock path: remote Ubuntu `bitcoind` plus local Metashrew and local `alkanes-jsonrpc`
- BTC explorer/read side for settlement builder: Mempool Signet Esplora
- memshrew, ord, contract indexer, and data API can stay out of the first unblock unless a specific method later proves to require them

### Mainnet

- primary indexed-state path: Subfrost
- primary BTC data and broadcast path: UniSat or Subfrost, chosen by validated integration results
- fallback path: whichever provider is not primary

## Migration Path

### Stage 1

- keep current `signedClaim`-only handoff for local smoke tests

### Stage 2

- add `claimReservationId` and `feePayment` to the request body

### Stage 3

- make payment validation mandatory before settlement submission

### Stage 4

- return settlement txids and indexed confirmation state instead of only local-dev relay acceptance

### Stage 5

- complete Ubuntu Signet node sync and `txindex`
- expose the Ubuntu Signet RPC only on a private path for the main development laptop
- repoint local Metashrew and local `alkanes-jsonrpc` to the Ubuntu node RPC
- retest `metashrew_height` locally before touching the live Engine miner settlement env
- repoint Engine miner env to local `18888`/`8080` and validate the direct settlement path against the split-machine stack