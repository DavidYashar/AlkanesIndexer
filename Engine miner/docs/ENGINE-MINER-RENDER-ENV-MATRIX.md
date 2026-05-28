# Engine miner Render Env Matrix

Date: 2026-05-25

Purpose: define the environment-variable contract for a hosted-provider-first Engine miner deployment on Render, with signet and mainnet separated cleanly and all treasury-sensitive signing kept off Render.

## Deployment Split

- Render hosts the application tier only
- hosted providers supply Bitcoin and Alkanes data and broadcast APIs
- secure local operator systems handle contract deployment, treasury key custody, and emergency signing

## Common Render Env

| Variable | Required | Example | Purpose |
| --- | --- | --- | --- |
| `ENGINE_MINER_SERVER_HOST` | yes | `0.0.0.0` | bind address for the backend service |
| `ENGINE_MINER_SERVER_PORT` | yes | `3031` | backend port |
| `ENGINE_MINER_SERVER_BASE_URL` | yes | `https://engine-miner-api.onrender.com` | public server base URL |
| `ENGINE_MINER_SERVER_DEFAULT_NETWORK` | yes | `signet` or `mainnet` | active network for the deployment |
| `ENGINE_MINER_SERVER_ROUND_DURATION_MS` | yes | `300000` | 5-minute puzzle lifetime |
| `ENGINE_MINER_SERVER_CLAIM_PAYMENT_WINDOW_MS` | yes | `120000` | 2-minute provisional winner payment window |
| `ENGINE_MINER_SERVER_REQUIRED_CLAIM_FEE_SATS` | yes | `7000` | base claim fee |
| `ENGINE_MINER_CLAIM_SUBMISSION_RELAY_URL` | no | `https://relay.example.com/v1/claims/submit` | legacy fallback if direct settlement builder is disabled |

## Provider Selection Env

| Variable | Required | Example | Purpose |
| --- | --- | --- | --- |
| `ENGINE_MINER_BITCOIN_PROVIDER_PRIMARY` | yes | `subfrost` or `unisat` | primary provider for BTC-facing calls |
| `ENGINE_MINER_BITCOIN_PROVIDER_FALLBACK` | no | `unisat` or `subfrost` | fallback BTC provider |
| `ENGINE_MINER_ALKANES_RPC_URL` | no | `https://signet.subfrost.io/v4/subfrost` | direct Alkanes execute/index RPC used by the settlement builder |

## Subfrost Env

| Variable | Required When | Example |
| --- | --- | --- |
| `SUBFROST_JSONRPC_URL` | Subfrost is primary or fallback | `https://signet.subfrost.io/v4/jsonrpc` |
| `ENGINE_MINER_ALKANES_RPC_URL` | direct settlement builder uses Subfrost | `https://signet.subfrost.io/v4/subfrost` |
| `SUBFROST_REST_URL` | Subfrost REST is used | `https://signet.subfrost.io/v4/api` |
| `SUBFROST_API_KEY` | authenticated access is required | `subfrost_live_key` |

Mainnet values:

- `SUBFROST_JSONRPC_URL=https://mainnet.subfrost.io/v4/jsonrpc`
- `SUBFROST_REST_URL=https://mainnet.subfrost.io/v4/api`

Signet values:

- `SUBFROST_JSONRPC_URL=https://signet.subfrost.io/v4/jsonrpc`
- `ENGINE_MINER_ALKANES_RPC_URL=https://signet.subfrost.io/v4/subfrost`
- `SUBFROST_REST_URL=https://signet.subfrost.io/v4/api`

## UniSat Env

| Variable | Required When | Example |
| --- | --- | --- |
| `UNISAT_OPENAPI_URL` | UniSat is primary or fallback | `https://open-api.unisat.io` |
| `UNISAT_API_KEY` | authenticated access is required | `unisat_live_key` |
| `UNISAT_NETWORK` | yes when using UniSat adapters | `mainnet` or `signet` |

Operational note:

- mainnet UniSat coverage is documented and suitable for integration
- signet UniSat support should be validated with a live key before making it the sole signet dependency

## Wallet Plugin Env

These values stay in the operator or agent runtime, not in the public Render web tier.

| Variable | Required | Purpose |
| --- | --- | --- |
| `ENGINE_MINER_WALLET_PASSPHRASE` | yes | unlock local encrypted wallet storage |
| `ENGINE_MINER_WALLET_STATE_DIR` | no | override wallet storage directory |
| `ENGINE_MINER_RECEIPT_PUBLIC_KEY_PEM` | yes in production | trusted backend receipt verification key |

## Secure Local Operator Env

These values must not live in the Render application environment.

| Variable | Required | Purpose |
| --- | --- | --- |
| `ENGINE_TOKEN_DEPLOYER_KEY` | yes for deploys | deploy signet and mainnet Engine contracts |
| `ENGINE_TREASURY_SIGNER_KEY` | yes | treasury and admin operations |
| `ENGINE_CLAIM_MANAGER_ADMIN_KEY` | yes | privileged settlement operations |
| `ENGINE_MINER_CLAIM_SIGNING_PRIVATE_KEY_PEM` | yes in production | backend receipt signer private key |

## Direct Settlement Builder Env

These values enable `/v1/claims/submit` to build and broadcast the privileged Alkanes settlement transaction directly. Keep them only on a trusted backend or local operator machine.

| Variable | Required | Example | Purpose |
| --- | --- | --- | --- |
| `ENGINE_MINER_SETTLEMENT_MNEMONIC` | yes | `abandon ...` | operator wallet mnemonic used to build the settlement tx |
| `ENGINE_MINER_SETTLEMENT_PASSPHRASE` | no | `engine-signet-passphrase` | optional BIP39 passphrase |
| `ENGINE_MINER_SETTLEMENT_FEE_RATE` | no | `2` | sats/vbyte fee rate for the settlement transaction |
| `ENGINE_MINER_SETTLEMENT_BTC_INPUT_SATS` | no | `10000` | BTC funding requirement passed into the execution builder |
| `ENGINE_MINER_SETTLEMENT_CONTRACT_BLOCK` | yes | `4` | target claim-manager contract block |
| `ENGINE_MINER_SETTLEMENT_CONTRACT_TX` | yes | `61001` | target claim-manager contract tx index |
| `ENGINE_MINER_SETTLEMENT_OPCODE` | yes | `1` | final settlement opcode for the in-repo `EngineClaimManager` contract |
| `ENGINE_MINER_SETTLEMENT_INPUT_TEMPLATE` | no | `rewardTokens,receiptPayloadHashHi,receiptPayloadHashLo` | numeric calldata words appended after `[block,tx,opcode,...]` |
| `ENGINE_MINER_SETTLEMENT_INPUT_REQUIREMENTS_TEMPLATE` | no | `B:{btcSats}` | base builder input requirements string before auth-token requirements are appended |
| `ENGINE_MINER_SETTLEMENT_AUTH_TOKEN_BLOCK` | no | `2` | settlement auth token block required by `ClaimManager.only_owner()` |
| `ENGINE_MINER_SETTLEMENT_AUTH_TOKEN_TX` | no | `34567` | settlement auth token tx required by `ClaimManager.only_owner()` |
| `ENGINE_MINER_SETTLEMENT_AUTH_TOKEN_UNITS` | no | `1` | auth token units to consume per settlement |
| `ENGINE_MINER_SETTLEMENT_TO_ADDRESSES_TEMPLATE` | no | `{payoutAddress}` | recipient addresses for the settlement transaction |
| `ENGINE_MINER_SETTLEMENT_POINTER` | no | `v0` | protostone pointer component |
| `ENGINE_MINER_SETTLEMENT_REFUND` | no | `v0` | protostone refund component |
| `ENGINE_MINER_SETTLEMENT_FROM_ADDRESSES` | no | `p2wpkh:0,p2tr:0` | optional wallet source-address selectors |
| `ENGINE_MINER_SETTLEMENT_CHANGE_ADDRESS` | no | `p2wpkh:0` | optional BTC change selector |
| `ENGINE_MINER_SETTLEMENT_ALKANES_CHANGE_ADDRESS` | no | `p2wpkh:0` | optional alkane change selector |
| `ENGINE_MINER_SETTLEMENT_TRACE_ENABLED` | no | `false` | request trace output from the builder |
| `ENGINE_MINER_SETTLEMENT_RAW_OUTPUT` | no | `false` | keep SDK output parsed instead of raw |
| `ENGINE_MINER_SETTLEMENT_UTXO_SOURCE` | no | `metashrew` or `espo` | force the settlement builder UTXO source |
| `ENGINE_MINER_SETTLEMENT_MEMPOOL_INDEXER` | no | `false` | opt into mempool-aware indexing |
| `ENGINE_MINER_SETTLEMENT_SPLIT_TRANSACTIONS` | no | `false` | enable split-transaction execution if required by the target contract |

Operational notes:

- the in-repo `EngineClaimManager` now uses self-auth during settlement; the auth-token coordinates should match the ClaimManager alkane ID itself
- each successful settlement consumes one self-auth token unit so owner authority cannot be forwarded to the payout output
- default settlement config should prefer native segwit (`p2wpkh:0`) for alkane change unless a deployment path explicitly requires taproot for a particular reveal flow
- set `ENGINE_MINER_SETTLEMENT_AUTH_TOKEN_BLOCK`, `ENGINE_MINER_SETTLEMENT_AUTH_TOKEN_TX`, and usually `ENGINE_MINER_SETTLEMENT_AUTH_TOKEN_UNITS=1` after deployment to the same block/tx as the ClaimManager so the backend appends the required self-auth input automatically

## Recommended Render Topology

### Signet service

- `ENGINE_MINER_SERVER_DEFAULT_NETWORK=signet`
- Subfrost primary
- Sandshrew or validated UniSat signet as fallback

### Mainnet service

- `ENGINE_MINER_SERVER_DEFAULT_NETWORK=mainnet`
- Subfrost for indexed Alkanes state
- UniSat or Subfrost for Bitcoin data and broadcast, chosen by validated provider adapter behavior

## Non-Goals

- do not place treasury or deployment keys in Render env vars
- do not run `bitcoind + metashrew` in the Render web service for v1
- do not assume one provider is sufficient forever; provider adapters and fallback routing are required