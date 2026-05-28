# Engine miner Wallet Security Notes

This package is designed to be auditable and narrow in authority.

## What It Can Do

- initialize a local Taproot wallet
- derive a BIP86 payout address
- sign Engine miner registration challenges
- later validate, sign, and broadcast Engine miner claim transactions

## What It Must Not Do

- export the mnemonic through agent-visible tools
- sign arbitrary messages for unrelated domains
- send Bitcoin to arbitrary addresses
- bypass user confirmation for claim broadcast

## ClawHub-Facing Safety Signals

- package scope matches publisher handle: `@kerimatalayturkish-dotcom/engine-miner-openclaw-wallet`
- OpenClaw compatibility metadata is declared explicitly
- packaged artifact is constrained by the `files` allowlist in `package.json`
- security-sensitive behavior is documented in `README.md`
- the plugin uses local secret storage instead of remote custody

## Recommended ClawScan Note

Use this when publishing:

```text
Taproot-first Engine miner wallet plugin. Stores secrets locally with DPAPI on Windows or passphrase-encrypted fallback. Refuses arbitrary sends and only exposes narrow Engine miner registration and claim flows.
```

## User Trust Checklist

- review the ClawHub audit status before install
- read the publisher note and risk level
- confirm the package owner is `@kerimatalayturkish-dotcom`
- verify the package name matches `@kerimatalayturkish-dotcom/engine-miner-openclaw-wallet`
- install only after understanding the local key-storage model

## Current Residual Risks

- this plugin still holds local wallet authority for future claim signing
- claim validation and broadcast policy are not fully implemented yet
- until claim flow is complete, this should be treated as a wallet foundation release rather than a production reward-claim release