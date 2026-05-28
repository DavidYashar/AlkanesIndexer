# Engine miner Server

Purpose: protocol-aligned backend scaffold for Engine miner.

This service is the backend piece in the three-part Engine miner architecture:

- OpenClaw agent plus wallet plugin
- Engine miner MCP connector
- Engine miner backend service

This scaffold implements the first backend slice in memory so the protocol can be exercised before real persistence, attestation, or Alkanes settlement work is added.

## What Exists Now

- Fastify REST server in TypeScript
- protocol-aligned registration endpoints
- protocol-aligned mining endpoints
- protocol-aligned claim endpoints
- in-memory miner, challenge, round, reward, and claim state
- deterministic sample round generation and answer verification
- Ed25519-signed claim receipts with a built-in development signer by default
- backend verification of Taproot registration proofs before miner binding
- claim submission endpoint that returns a txid and updates claim status

## What Does Not Exist Yet

- persistent database storage
- real agent attestation
- production claim-signing key management and rotation
- Alkanes settlement worker
- Bitcoin or Alkanes provider integration
- production auth and rate limiting

## Commands

```powershell
pnpm install
pnpm dev
```

Build and run:

```powershell
pnpm build
pnpm start
```

## Default Address

- health: `GET http://127.0.0.1:3031/health`

## Protocol Alignment

This service follows:

- `Engine miner/docs/ENGINE-MINER-V1-PROTOCOL-SPEC.md`

## Current Endpoint Surface

- `POST /v1/registration/challenge`
- `POST /v1/registration/complete`
- `POST /v1/mining/start`
- `POST /v1/mining/stop`
- `GET /v1/rounds/current`
- `POST /v1/rounds/:roundId/solutions`
- `GET /v1/miners/:minerId/status`
- `GET /v1/miners/:minerId/claimable-rewards`
- `POST /v1/claims/request`
- `POST /v1/claims/submit`
- `GET /v1/claims/:claimId/status`

## Current Behavior Notes

- rounds are generated in memory from deterministic templates
- the first correct submission wins the active round
- winning a round creates a claimable reward entry
- claim receipts are cryptographically signed, but the default signer is a development key intended only for local contract testing
- claim submissions return a deterministic local-dev txid by default, or can be relayed to a configured submission endpoint

## Next Backend Steps

1. replace in-memory state with persistent storage
2. add real backend signing for claim receipts
3. add authenticated miner identity and rate limiting
4. add settlement job integration for Alkanes claim flow