# Engine miner V1 Protocol Spec

Date: 2026-05-25

Purpose: define the shared v1 contract between the OpenClaw agent and wallet, the Engine miner MCP connector, and the Engine miner backend service.

## Scope

This document freezes the integration boundary for the next implementation phase.

It does not define the final Alkanes contract calldata in full detail yet.

It does define:

- which component owns which responsibility
- what data crosses each boundary
- which server endpoints the MCP should expose
- where the wallet participates in registration and claims

## Operational Corrections

The current local scaffold is useful, but several production assumptions are now corrected by live-network findings and updated product rules.

- the current wallet scaffold is Taproot-based, but the Engine miner protocol must not assume Taproot-only compatibility for all Alkanes actions; production wallet support must allow approved Bitcoin address strategies such as Native SegWit where live mint paths require them
- the current local scaffold promotes the first correct answer directly into a claimable reward; the production flow should treat that answer as only a provisional candidate until fee-payment rules are satisfied
- puzzle lifetime is 5 minutes, not 30 seconds
- provisional winners have 2 minutes to provide an acceptable fee-payment txid before the backend advances to the next eligible correct candidate
- candidate ordering should use backend receive time in milliseconds, not client-declared timestamps, because the client timestamp is not authoritative

## System Split

Engine miner v1 should be built as three cooperating pieces.

### 1. OpenClaw agent plus wallet plugin

Responsibilities:

- create or attach to a Bitcoin wallet using an approved address strategy
- show wallet status
- return the payout and funding address information needed for funding and settlement
- sign Engine miner registration challenges
- later validate and sign prepared claim packages
- never hand the seed phrase or signing authority to the MCP or server

Current implementation note:

- the local standalone wallet currently implements a Taproot-first identity flow
- the production protocol should support address-type flexibility, with Native SegWit compatibility available when required by live Alkanes mint and fee-payment paths

### 2. Engine miner MCP connector

Responsibilities:

- translate agent requests into strict backend API calls
- manage local miner session state
- fetch active rounds
- submit solutions
- poll mining status
- list claimable rewards
- request claim receipts or prepared claim material
- never hold wallet secrets

### 3. Engine miner backend service

Responsibilities:

- issue registration challenges
- bind wallet identity to miner identity
- open and close rounds
- generate puzzles
- verify submissions deterministically
- select provisional winners atomically
- rank correct candidates by backend receive time in milliseconds
- reject or skip underfunded candidates before finalizing a winner
- enforce the 2-minute fee-payment window and move to the next eligible candidate on timeout or invalid payment
- maintain reward ledger state
- issue signed claim receipts
- coordinate batch, epoch, or claim-based settlement jobs

## Trust Boundaries

### Wallet boundary

- the seed phrase stays local to the wallet host
- the wallet signs only narrow Engine miner artifacts
- the wallet is never a generic send-anywhere Bitcoin wallet in v1

### MCP boundary

- the MCP is a connector, not a custody layer
- the MCP may cache miner session state locally
- the MCP may never store wallet seed material or derive wallet keys

### Server boundary

- the server is authoritative for round issuance, verification, and winner selection in v1
- the server must sign claim receipts so the wallet can verify claim origin later
- the server must not be able to spend or sign with the user wallet

## Identity Model

Each miner identity should bind together:

- `minerId`
- `agentId`
- `payoutAddress`
- `fundingAddress`
- `addressType`
- `publicKey`
- `internalPubkey`
- `registrationStatus`
- `registeredAt`
- `attestationLevel`
- `policyVersion`

The payout address is the settlement identity.

The funding address is the wallet address that is expected to pay the claim fee when a miner becomes the provisional winner.

The registration signature proves control of that wallet identity.

## Canonical V1 Objects

### RegistrationChallenge

```json
{
  "registrationId": "reg_123",
  "challenge": "opaque-server-challenge",
  "expiresAt": "2026-05-25T12:00:00.000Z",
  "domain": "engine-miner.example",
  "network": "mainnet"
}
```

### RegistrationProof

```json
{
  "registrationId": "reg_123",
  "payoutAddress": "bc1p...",
  "publicKey": "02...",
  "internalPubkey": "...",
  "derivationPath": "m/86'/0'/0'/0/0",
  "signedPayload": {
    "scheme": "engine-miner-registration-v1",
    "challenge": "opaque-server-challenge",
    "expiresAt": "2026-05-25T12:00:00.000Z",
    "domain": "engine-miner.example",
    "network": "mainnet",
    "address": "bc1p...",
    "internalPubkey": "...",
    "derivationPath": "m/86'/0'/0'/0/0"
  },
  "signature": "hex-bip340-signature"
}
```

### RoundDescriptor

```json
{
  "roundId": "rnd_4201",
  "roundNumber": 4201,
  "category": "symbolic-equations",
  "difficulty": 12.4,
  "parameters": {},
  "createdAt": "2026-05-25T12:00:00.000Z",
  "expiresAt": "2026-05-25T12:05:00.000Z",
  "rewardTokens": 1000,
  "submissionRules": {
    "maxAttempts": 1,
    "answerFormat": "json",
    "puzzleLifetimeMs": 300000,
    "claimPaymentWindowMs": 120000,
    "requiredClaimFeeSats": 7000,
    "winnerSelectionMode": "fcfs_backend_received_at",
    "fundingEligibilityRequired": true
  }
}
```

### SolutionSubmission

```json
{
  "roundId": "rnd_4201",
  "minerId": "miner_123",
  "answer": {},
  "reasoningCommitment": "optional-hash",
  "toolTraceHash": "optional-hash",
  "submittedAtClient": "2026-05-25T12:00:03.250Z"
}
```

### SolutionResult

```json
{
  "submissionId": "sub_888",
  "roundId": "rnd_4201",
  "accepted": true,
  "verificationStatus": "valid",
  "winner": true,
  "winnerStatus": "provisional_winner",
  "queuePosition": 1,
  "serverReceivedAt": "2026-05-25T12:00:03.251Z",
  "paymentDeadlineAt": "2026-05-25T12:02:03.251Z",
  "rewardTokens": 1000,
  "claimable": false,
  "nextPollAfterMs": 500
}
```

Important correction:

- a correct answer is not fully claimable until the backend accepts the associated fee-payment txid or otherwise finalizes the winner under the claim policy

### ClaimableReward

```json
{
  "claimId": "clm_100",
  "roundId": "rnd_4201",
  "payoutAddress": "bc1p...",
  "rewardTokens": 1000,
  "status": "claimable",
  "expiresAt": "2026-05-27T12:00:00.000Z"
}
```

### ClaimReceipt

```json
{
  "claimId": "clm_100",
  "payoutAddress": "bc1p...",
  "rewardTokens": 1000,
  "roundIds": ["rnd_4201"],
  "nonce": "anti-replay-value",
  "issuedAt": "2026-05-25T12:01:00.000Z",
  "expiresAt": "2026-05-27T12:00:00.000Z",
  "settlementMode": "claim",
  "backendSignature": "server-signature"
}
```

## Backend API Contract

The first implementation should use a versioned REST API.

### Registration endpoints

`POST /v1/registration/challenge`

Request:

```json
{
  "agentId": "agent_abc",
  "agentProfile": {
    "name": "OpenClaw miner",
    "runtime": "openclaw",
    "version": "2026.5.22"
  },
  "requestedNetwork": "mainnet"
}
```

Response: `RegistrationChallenge`

`POST /v1/registration/complete`

Request: `RegistrationProof`

Response:

```json
{
  "minerId": "miner_123",
  "registrationStatus": "registered",
  "payoutAddress": "bc1p...",
  "registeredAt": "2026-05-25T12:00:10.000Z"
}
```

### Mining endpoints

`POST /v1/mining/start`

Request:

```json
{
  "minerId": "miner_123",
  "strategy": {
    "categories": ["symbolic-equations", "number-theory"],
    "maxParallelRounds": 1
  }
}
```

Response:

```json
{
  "accepted": true,
  "miningState": "active",
  "pollAfterMs": 500
}
```

`POST /v1/mining/stop`

Request:

```json
{
  "minerId": "miner_123"
}
```

Response:

```json
{
  "accepted": true,
  "miningState": "idle"
}
```

`GET /v1/rounds/current?minerId=miner_123`

Response: `RoundDescriptor`

`POST /v1/rounds/{roundId}/solutions`

Request: `SolutionSubmission`

Response: `SolutionResult`

`GET /v1/miners/{minerId}/status`

Response:

```json
{
  "minerId": "miner_123",
  "registrationStatus": "registered",
  "miningState": "active",
  "currentRoundId": "rnd_4201",
  "lastSubmissionId": "sub_888",
  "totalWins": 12,
  "totalRewards": 12000,
  "claimableRewards": 3000
}
```

### Claim endpoints

`GET /v1/miners/{minerId}/claimable-rewards`

Response:

```json
{
  "minerId": "miner_123",
  "rewards": []
}
```

`POST /v1/claims/request`

Request:

```json
{
  "minerId": "miner_123",
  "claimIds": ["clm_100"]
}
```

Response: `ClaimReceipt`

`POST /v1/claims/submit`

Request:

```json
{
  "signedClaim": {
    "schema": "engine-miner-signed-claim-v1",
    "claimId": "clm_100",
    "signedAt": "2026-05-25T12:02:00.000Z",
    "preparedClaim": {},
    "walletSignature": {}
  }
}
```

Response:

```json
{
  "claimId": "clm_100",
  "submissionId": "submission_123",
  "txid": "abc123...",
  "status": "submitted",
  "provider": "engine-miner-local-dev",
  "acceptedAt": "2026-05-25T12:02:01.000Z"
}
```

`GET /v1/claims/{claimId}/status`

Response:

```json
{
  "claimId": "clm_100",
  "status": "submitted",
  "lastKnownTxid": "abc123..."
}
```

## MCP Tool Contract

The MCP should wrap the backend API with agent-safe tools.

Recommended first MCP tool set:

- `engine_miner_get_registration_challenge`
- `engine_miner_submit_registration`
- `engine_miner_start_mining`
- `engine_miner_stop_mining`
- `engine_miner_get_current_round`
- `engine_miner_submit_solution`
- `engine_miner_get_mining_status`
- `engine_miner_list_claimable_rewards`
- `engine_miner_request_claim_receipt`
- `engine_miner_get_claim_status`

The MCP should not expose seed handling or local signing operations.

Those stay in the wallet plugin.

## Wallet Handoff Contract

### Registration flow

1. MCP requests a `RegistrationChallenge` from the server.
2. Agent asks the wallet for the payout address if needed.
3. Agent asks the wallet to sign the registration challenge.
4. MCP submits the `RegistrationProof` to the server.
5. Server returns `minerId` and registration success.

### Mining flow

1. Agent asks MCP to start mining.
2. MCP fetches the current round.
3. Agent solves the puzzle.
4. MCP submits the solution.
5. Backend timestamps the submission on receipt, verifies correctness, and places the miner in the FCFS candidate queue.
6. Backend checks whether the candidate wallet can fund the claim fee path.
7. If the candidate becomes the provisional winner, the agent gets up to 2 minutes to submit a fee-payment txid.
8. If the fee-payment path succeeds, MCP later exposes a claimable reward or a settlement-ready claim.
9. If the fee-payment path fails or times out, the backend advances to the next eligible correct candidate.

### Claim flow

1. MCP lists claimable rewards or provisional winner actions.
2. If the miner is provisional winner, the wallet or agent submits the fee-payment txid within the 2-minute window.
3. After fee validation, MCP requests a `ClaimReceipt` from the server.
4. Wallet verifies backend signature and receipt fields.
5. Wallet prepares and signs the claim package.
6. Wallet or backend submits the signed claim through the configured provider path under policy.
7. The settlement operator or ClaimManager path performs the privileged mint into the Engine token contract.
8. MCP or wallet reports resulting claim status back to the server if needed.

## MCP Local State Model

The MCP should track a lightweight local state machine per miner.

Recommended states:

- `unregistered`
- `registered`
- `idle`
- `active`
- `cooldown`
- `claimable`
- `claim_pending`

This is important so the agent can resume mining and claims cleanly across turns.

## Non-Goals For This Protocol

This v1 protocol does not attempt to solve:

- cryptographic proof that a human never proxied the agent
- final Alkanes calldata encoding for every settlement mode
- arbitrary Bitcoin payments
- remote wallet custody

## Current Implementation Gap

The current local scaffold still implements the simpler receipt-first path and does not yet enforce:

- 5-minute round lifetime in all deployed environments
- backend-side funding eligibility checks
- provisional winner queue fallback
- the 2-minute fee-payment deadline
- the final provider-backed privileged settlement call into the Engine token contract

## Build Order Locked By This Spec

1. Freeze this protocol and use it as the implementation contract.
2. Build the Engine miner backend service against these endpoints.
3. Build the MCP connector against the backend contract.
4. Complete the wallet claim path against the final claim receipt and prepared claim schema.

This keeps the wallet narrow, the MCP reusable, and the backend authoritative for rounds and rewards.