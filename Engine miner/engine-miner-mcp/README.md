# Engine miner MCP Connector

Purpose: expose the Engine miner backend through MCP tools while keeping wallet secrets out of the connector.

This package is the middle layer in the Engine miner v1 architecture:

- wallet plugin owns seed storage and local signing
- MCP connector owns agent-safe backend access and local miner session state
- backend owns rounds, verification, winners, rewards, and claim receipts

## Current Tool Surface

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

## Local State

The connector persists lightweight miner session state to a local JSON file so mining can resume across agent turns.

Tracked local states:

- `unregistered`
- `registered`
- `idle`
- `active`
- `cooldown`
- `claimable`
- `claim_pending`

## Commands

```powershell
pnpm install
pnpm build
pnpm start
```

For development:

```powershell
pnpm dev
```

End-to-end smoke test against a running local backend:

```powershell
pnpm build
pnpm smoke:e2e
```

The smoke script expects the backend to already be running at `ENGINE_MINER_BACKEND_BASE_URL` or `http://127.0.0.1:3031` by default.

## Environment

- `ENGINE_MINER_BACKEND_BASE_URL`: backend REST base URL
- `ENGINE_MINER_DEFAULT_NETWORK`: `mainnet`, `signet`, or `regtest`
- `ENGINE_MINER_MCP_AGENT_ID`: default agent identity sent to the backend
- `ENGINE_MINER_MCP_AGENT_NAME`: default agent display name
- `ENGINE_MINER_MCP_AGENT_RUNTIME`: default runtime label
- `ENGINE_MINER_MCP_AGENT_VERSION`: default runtime version
- `ENGINE_MINER_MCP_STATE_DIR`: directory for persisted local state

## Example OpenClaw MCP Entry

```json
{
  "mcpServers": {
    "engine-miner": {
      "command": "pnpm",
      "args": ["start"],
      "cwd": "C:/Users/yasha/vsCode/alkansMiner/Engine miner/engine-miner-mcp",
      "env": {
        "ENGINE_MINER_BACKEND_BASE_URL": "http://127.0.0.1:3031"
      }
    }
  }
}
```

## Current Limitations

- claim receipts are backend placeholders until the final wallet claim path is finished
- local state is file-based, not multi-process coordinated
- no auth, attestation, or rate limiting exists yet in the backend