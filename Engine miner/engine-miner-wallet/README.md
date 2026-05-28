# Engine miner OpenClaw Wallet Plugin

Purpose: local scaffold for an OpenClaw-installable, Taproot-first wallet plugin for Engine miner.

This package is intentionally a scaffold.

What exists now:

- native OpenClaw plugin package structure
- `openclaw.plugin.json` manifest
- installable runtime entry at `index.js`
- Windows DPAPI-backed secret storage when no passphrase is supplied
- explicit passphrase-encrypted keystore fallback for non-Windows or portable setups
- BIP86 Taproot payout-address derivation
- human-only admin entrypoint for wallet initialization and inspection
- placeholder claim tools that expose the intended claim-first interface
- standalone companion skill prepared for separate ClawHub publishing

What does not exist yet:

- secure keystore integration
- PSBT construction or signing
- Engine miner API integration
- Alkanes claim transaction validation
- Bitcoin broadcast integration

## Folder Layout

```text
engine-miner-wallet/
  admin.js
  package.json
  openclaw.plugin.json
  index.js
  lib/
    keystore.js
    taproot.js
    wallet-core.js
  README.md
  SECURITY.md
```

## Current Tool Surface

- `engine_miner_wallet_status`
- `engine_miner_wallet_get_payout_address`
- `engine_miner_wallet_sign_registration_challenge`
- `engine_miner_wallet_list_claimable_rewards`
- `engine_miner_wallet_prepare_claim`
- `engine_miner_wallet_sign_prepared_claim`
- `engine_miner_wallet_broadcast_prepared_claim`

The wallet status, payout-address, and registration-signing tools are real.

The claim tools still return scaffold metadata only.

Registration signing details:

- signs with the same BIP86 Taproot identity key as the payout address
- canonical payload includes challenge, expiry, optional domain, network, address, x-only pubkey, and derivation path
- payload is hashed with the tag `EngineMinerRegistrationChallenge/v1`
- signature format is BIP340 Schnorr in hex encoding

Bitcoin and Alkanes boundary:

- this wallet is still a Bitcoin wallet at the custody and signing layer
- it can be used for Alkanes flows because Alkanes actions settle through Bitcoin transactions rather than a separate chain wallet

## Human-Only Admin Command

The keystore and Taproot layer is initialized through the local admin command, not the agent tool surface.

Examples:

```powershell
npm install
node .\admin.js init --network mainnet
node .\admin.js status
node .\admin.js address
```

Portable encrypted-file mode:

```powershell
node .\admin.js init --network signet --passphrase "choose-a-strong-passphrase"
node .\admin.js address --passphrase "choose-a-strong-passphrase"
```

Runtime environment variables:

- `ENGINE_MINER_WALLET_STATE_DIR` overrides the wallet storage directory
- `ENGINE_MINER_WALLET_PASSPHRASE` unlocks encrypted-file keystores for admin commands or OpenClaw runtime use

Windows behavior:

- if no passphrase is supplied, the mnemonic is stored with DPAPI-backed PowerShell SecureString encryption for the current user
- this is machine-and-user bound, which is appropriate for a local OpenClaw agent host

Non-Windows behavior:

- use a passphrase-backed encrypted keystore file until a native OS secret-store adapter is added

## Local Install Shape

This package is structured so it can be installed into OpenClaw as a local plugin package.

It is also prepared for ClawHub code-plugin publishing under the package name `@kerimatalayturkish-dotcom/engine-miner-openclaw-wallet`.

Typical local install flow:

```powershell
openclaw plugins install "C:\path\to\engine-miner-openclaw-wallet"
```

ClawHub publish flow:

```powershell
clawhub login
clawhub whoami
npm pack
$tgz = (Resolve-Path ".\kerimatalayturkish-dotcom-engine-miner-openclaw-wallet-0.1.0.tgz").Path
clawhub package publish "$tgz" --family code-plugin --owner kerimatalayturkish-dotcom --source-repo kerimatalayturkish-dotcom/engine-miner-openclaw-wallet --source-commit YOUR_COMMIT_SHA --source-ref main --dry-run
clawhub package publish "$tgz" --family code-plugin --owner kerimatalayturkish-dotcom --source-repo kerimatalayturkish-dotcom/engine-miner-openclaw-wallet --source-commit YOUR_COMMIT_SHA --source-ref main --clawscan-note "Taproot-first Engine miner wallet plugin. Stores secrets locally with DPAPI on Windows or passphrase-encrypted fallback. Refuses arbitrary sends and only exposes narrow Engine miner registration and claim flows."
```

Windows note:

- if `clawhub package publish <folder>` fails with `spawnSync npm ENOENT`, publish the packed `.tgz` artifact instead
- this avoids the Windows folder-packaging path that tries to spawn `npm` internally
- ClawHub may also require explicit source provenance for code plugins; for this repo, pass `--source-repo`, `--source-commit`, and `--source-ref`
- on this Windows shell, `clawhub` accepted the tarball only when passed as an absolute path resolved through `Resolve-Path`

Companion standalone skill publish flow:

```powershell
clawhub skill publish ".\skills\engine-miner-wallet" --owner kerimatalayturkish-dotcom --slug engine-miner-wallet --version 0.1.0
```

Then enable it in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "engine-miner-wallet": {
        "enabled": true,
        "config": {
          "network": "mainnet",
          "policyMode": "claim_only",
          "walletStateDir": "C:\\Users\\yasha\\.engine-miner-wallet",
          "engineMinerApiUrl": "https://example.com/api",
          "alkanesProviderUrl": "https://mainnet.subfrost.io/v4/jsonrpc",
          "requireBroadcastConfirmation": true,
          "maxFeeSats": 5000
        }
      }
    }
  }
}
```

Restart the gateway after installation.

## ClawHub Security Posture

This package has been tightened for a safer ClawHub install experience:

- scoped package name matches the intended publisher handle: `@kerimatalayturkish-dotcom/...`
- required OpenClaw compatibility metadata is present in `package.json`
- packaged files are restricted through the `files` allowlist
- mnemonic export is not exposed through the agent tool surface
- arbitrary send-anywhere wallet actions are not exposed
- registration and claim flows are constrained by purpose and policy

See `./SECURITY.md` for the end-user security checklist and publish guidance.

## Why The Scaffold Is Claim-First

Engine miner agents should not receive a generic send-anywhere Bitcoin wallet.

This package is designed to become:

- Taproot-first
- claim-focused
- safe enough for OpenClaw agents
- Engine miner-specific rather than a universal wallet

## Next Implementation Steps

1. add claim receipt verification
2. add PSBT validation and signing
3. add Bitcoin broadcast provider integration

See `../docs/ENGINE-MINER-OPENCLAW-TAPROOT-WALLET-PLUGIN.md` for the full architecture.