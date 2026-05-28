#!/usr/bin/env node

import { getPayoutAddress, getWalletStatus, initializeWallet } from "./lib/wallet-core.js";

function parseArgs(argv) {
  const result = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      result._.push(token);
      continue;
    }

    const equalsIndex = token.indexOf("=");
    if (equalsIndex !== -1) {
      const key = token.slice(2, equalsIndex);
      result[key] = token.slice(equalsIndex + 1);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      result[key] = true;
      continue;
    }

    result[key] = next;
    index += 1;
  }

  return result;
}

function toInteger(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected an integer value but received: ${value}`);
  }

  return parsed;
}

function printHelp() {
  console.log(`Engine miner wallet admin

Usage:
  node ./admin.js init [--network mainnet|signet|regtest] [--mnemonic "..."] [--passphrase "..."] [--state-dir PATH] [--force]
  node ./admin.js status [--state-dir PATH] [--passphrase "..."]
  node ./admin.js address [--state-dir PATH] [--passphrase "..."]

Notes:
  - On Windows, init defaults to DPAPI-backed storage when no passphrase is supplied.
  - On non-Windows systems, provide --passphrase or set ENGINE_MINER_WALLET_PASSPHRASE.
  - These are human-only setup and inspection commands, not agent tools.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "status";

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const sharedOptions = {
    stateDir: args["state-dir"],
    passphrase: args.passphrase
  };

  if (command === "init") {
    const result = initializeWallet({
      ...sharedOptions,
      network: args.network,
      mnemonic: args.mnemonic,
      account: toInteger(args.account, 0),
      change: toInteger(args.change, 0),
      index: toInteger(args.index, 0),
      wordCount: toInteger(args["word-count"], 24),
      force: args.force === true
    });

    console.log(
      JSON.stringify(
        {
          command: "init",
          storageDir: result.storageDir,
          keystoreProvider: result.keystoreProvider,
          network: result.network,
          derivationPath: result.derivationPath,
          payoutAddress: result.payoutAddress,
          createdNewMnemonic: result.createdNewMnemonic,
          mnemonic: result.mnemonic,
          warning:
            "Store the mnemonic securely offline. It is only returned by this human-only admin command."
        },
        null,
        2
      )
    );
    return;
  }

  if (command === "status") {
    console.log(JSON.stringify({ command: "status", ...getWalletStatus(sharedOptions) }, null, 2));
    return;
  }

  if (command === "address") {
    console.log(JSON.stringify({ command: "address", ...getPayoutAddress(sharedOptions) }, null, 2));
    return;
  }

  throw new Error(`Unknown admin command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});