import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EngineMinerServerConfig, EngineMinerSettlementBuilderConfig } from "./config.js";
import type { ClaimSubmissionResponse, SignedClaim } from "./contracts.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function buildDeterministicTxid(signedClaim: SignedClaim): string {
  return createHash("sha256").update(JSON.stringify(signedClaim)).digest("hex");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeDigestHex(name: string, value: string): string {
  const normalized = value.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`Expected ${name} to be a 32-byte hex digest, received: ${value}`);
  }

  return normalized;
}

function splitDigestToU128Words(digestHex: string): { hi: string; lo: string } {
  const value = BigInt(`0x${digestHex}`);
  const loMask = (1n << 128n) - 1n;

  return {
    hi: (value >> 128n).toString(10),
    lo: (value & loMask).toString(10)
  };
}

function buildTemplateContext(config: EngineMinerServerConfig, signedClaim: SignedClaim): Record<string, string> {
  const claimReceipt = signedClaim.preparedClaim.claimReceipt;
  const receiptPayloadHash = normalizeDigestHex(
    "preparedClaim.backendVerification.receiptPayloadHash",
    signedClaim.preparedClaim.backendVerification.receiptPayloadHash
  );
  const claimDigest = normalizeDigestHex(
    "preparedClaim.preparedClaimDigestHex",
    signedClaim.preparedClaim.preparedClaimDigestHex
  );
  const claimIdHash = sha256Hex(claimReceipt.claimId);
  const nonceHash = sha256Hex(claimReceipt.nonce);
  const receiptPayloadHashWords = splitDigestToU128Words(receiptPayloadHash);
  const claimDigestWords = splitDigestToU128Words(claimDigest);
  const claimIdHashWords = splitDigestToU128Words(claimIdHash);
  const nonceHashWords = splitDigestToU128Words(nonceHash);
  const btcInputSats = config.settlementBuilder ? String(config.settlementBuilder.btcInputSats) : "0";

  return {
    payoutAddress: claimReceipt.payoutAddress,
    fundingAddress: signedClaim.preparedClaim.wallet.fundingAddress,
    claimId: claimReceipt.claimId,
    nonce: claimReceipt.nonce,
    network: signedClaim.preparedClaim.wallet.network,
    rewardTokens: String(claimReceipt.rewardTokens),
    roundCount: String(claimReceipt.roundIds.length),
    btcSats: btcInputSats,
    requiredClaimFeeSats: String(config.requiredClaimFeeSats),
    receiptPayloadHash,
    receiptPayloadHashHi: receiptPayloadHashWords.hi,
    receiptPayloadHashLo: receiptPayloadHashWords.lo,
    claimDigest,
    claimDigestHi: claimDigestWords.hi,
    claimDigestLo: claimDigestWords.lo,
    claimIdHash,
    claimIdHashHi: claimIdHashWords.hi,
    claimIdHashLo: claimIdHashWords.lo,
    nonceHash,
    nonceHashHi: nonceHashWords.hi,
    nonceHashLo: nonceHashWords.lo
  };
}

function substituteTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_match, key: string) => {
    const replacement = values[key];
    if (replacement === undefined) {
      throw new Error(`Unknown settlement template placeholder: {${key}}`);
    }

    return replacement;
  });
}

function resolveNumericToken(token: string, values: Record<string, string>): string {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error("Settlement input template entries must not be empty.");
  }

  const resolved = trimmed in values ? values[trimmed] : substituteTemplate(trimmed, values);
  if (/^0x[0-9a-fA-F]+$/.test(resolved) || /^\d+$/.test(resolved)) {
    return BigInt(resolved).toString(10);
  }

  throw new Error(`Settlement input template entry did not resolve to an unsigned integer: ${trimmed}`);
}

function buildProtostones(settlement: EngineMinerSettlementBuilderConfig, resolvedInputs: string[]): string {
  const cellpackValues = [settlement.contractBlock, settlement.contractTx, settlement.opcode, ...resolvedInputs];
  return `[${cellpackValues.join(",")}]:${settlement.pointer}:${settlement.refund}`;
}

function buildInputRequirements(
  settlement: EngineMinerSettlementBuilderConfig,
  templateValues: Record<string, string>
): string {
  const requirements = substituteTemplate(settlement.inputRequirementsTemplate, templateValues)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (settlement.authTokenBlock && settlement.authTokenTx && settlement.authTokenUnits) {
    const authRequirement = `${settlement.authTokenBlock}:${settlement.authTokenTx}:${settlement.authTokenUnits}`;
    if (!requirements.includes(authRequirement)) {
      requirements.push(authRequirement);
    }
  }

  return requirements.join(",");
}

function getAlkanesCliPath(): string {
  return resolve(repoRoot, "target", "release", process.platform === "win32" ? "alkanes-cli.exe" : "alkanes-cli");
}

function getDefaultEsploraApiUrl(network: string): string {
  switch (network) {
    case "mainnet":
      return "https://blockstream.info/api";
    case "regtest":
      return "http://127.0.0.1:3000";
    case "signet":
      return "https://mempool.space/signet/api";
    case "testnet":
      return "https://mempool.space/testnet/api";
    default:
      throw new Error(`Unsupported settlement network for alkanes-cli execution: ${network}`);
  }
}

async function runAlkanesCli(cliPath: string, args: string[]): Promise<string> {
  return await new Promise((resolveOutput, reject) => {
    const child = spawn(cliPath, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      if (code === 0) {
        resolveOutput(output);
        return;
      }

      reject(new Error(output || `alkanes-cli exited with status ${code ?? "unknown"}.`));
    });
  });
}

function extractRevealTxid(cliOutput: string): string {
  const revealTxid = cliOutput.match(/Reveal TXID:\s*([0-9a-f]{64})/i)?.[1];
  if (revealTxid) {
    return revealTxid.toLowerCase();
  }

  throw new Error(`alkanes-cli execution completed without printing a reveal txid. Output: ${cliOutput}`);
}

async function submitSignedClaimViaSettlementBuilder(
  config: EngineMinerServerConfig,
  signedClaim: SignedClaim
): Promise<Omit<ClaimSubmissionResponse, "claimId" | "status"> | null> {
  const settlement = config.settlementBuilder;
  if (!settlement) {
    return null;
  }

  const network = signedClaim.preparedClaim.wallet.network;
  if (network !== config.defaultNetwork) {
    throw new Error(
      `Signed claim network ${network} does not match the configured server network ${config.defaultNetwork}.`
    );
  }

  const templateValues = buildTemplateContext(config, signedClaim);
  const toAddresses = settlement.toAddressesTemplate.map((template) => substituteTemplate(template, templateValues).trim());
  const fromAddresses = settlement.fromAddresses?.map((template) => substituteTemplate(template, templateValues).trim());
  const changeAddress = settlement.changeAddress
    ? substituteTemplate(settlement.changeAddress, templateValues).trim()
    : undefined;
  const alkanesChangeAddress = settlement.alkanesChangeAddress
    ? substituteTemplate(settlement.alkanesChangeAddress, templateValues).trim()
    : undefined;
  const inputRequirements = buildInputRequirements(settlement, templateValues);

  if (toAddresses.length === 0 || toAddresses.some((address) => !address)) {
    throw new Error("Settlement to-address template did not resolve to at least one valid address.");
  }

  if (!inputRequirements) {
    throw new Error("Settlement input requirements template resolved to an empty string.");
  }

  const resolvedInputs = settlement.inputTemplate.map((token) => resolveNumericToken(token, templateValues));
  const protostones = buildProtostones(settlement, resolvedInputs);
  const cliPath = getAlkanesCliPath();
  const esploraApiUrl = getDefaultEsploraApiUrl(network);
  const passphrase = settlement.passphrase ?? "";
  const walletDirectory = await mkdtemp(join(tmpdir(), "engine-miner-alkanes-cli-"));
  const walletFile = join(walletDirectory, "settlement-wallet.json");

  try {
    await runAlkanesCli(cliPath, [
      "-p",
      network,
      "--passphrase",
      passphrase,
      "wallet",
      "create",
      settlement.mnemonic,
      "--output",
      walletFile
    ]);

    const executeArgs = [
      "-p",
      network,
      "--wallet-file",
      walletFile,
      "--passphrase",
      passphrase,
      "--jsonrpc-url",
      settlement.bitcoinRpcUrl,
      "--metashrew-rpc-url",
      settlement.rpcUrl,
      "--esplora-api-url",
      esploraApiUrl,
      "alkanes",
      "execute",
      protostones,
      "--inputs",
      inputRequirements,
      "--to",
      ...toAddresses
    ];

    if (fromAddresses && fromAddresses.length > 0) {
      executeArgs.push("--from", ...fromAddresses);
    }

    if (changeAddress) {
      executeArgs.push("--change", changeAddress);
    }

    if (alkanesChangeAddress) {
      executeArgs.push("--alkanes-change", alkanesChangeAddress);
    }

    if (settlement.mempoolIndexer) {
      executeArgs.push("--mempool-indexer");
    }

    if (settlement.splitTransactions) {
      executeArgs.push("--split-transactions");
    }

    if (settlement.utxoSource) {
      executeArgs.push("--utxo-source", settlement.utxoSource);
    }

    executeArgs.push("--fee-rate", String(settlement.feeRate), "--auto-confirm");

    const cliOutput = await runAlkanesCli(cliPath, executeArgs);

    return {
      submissionId: createId("submission"),
      txid: extractRevealTxid(cliOutput),
      provider: "engine-miner-alkanes-cli",
      acceptedAt: new Date().toISOString()
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Direct claim settlement transaction build failed: ${message}`);
  } finally {
    await rm(walletDirectory, { recursive: true, force: true });
  }
}

export async function submitSignedClaimToProvider(config: EngineMinerServerConfig, signedClaim: SignedClaim): Promise<Omit<ClaimSubmissionResponse, "claimId" | "status">> {
  const settlementResult = await submitSignedClaimViaSettlementBuilder(config, signedClaim);
  if (settlementResult) {
    return settlementResult;
  }

  if (config.claimSubmissionRelayUrl) {
    const response = await fetch(config.claimSubmissionRelayUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({ signedClaim })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error ? String(payload.error) : `Claim submission relay failed with status ${response.status}.`);
    }

    if (!payload || typeof payload !== "object" || typeof payload.txid !== "string" || !payload.txid.trim()) {
      throw new Error("Claim submission relay returned an invalid response; expected a txid string.");
    }

    return {
      submissionId: typeof payload.submissionId === "string" && payload.submissionId.trim() ? payload.submissionId : createId("submission"),
      txid: payload.txid.trim(),
      provider: typeof payload.provider === "string" && payload.provider.trim() ? payload.provider : "claim-submission-relay",
      acceptedAt: typeof payload.acceptedAt === "string" && payload.acceptedAt.trim() ? payload.acceptedAt : new Date().toISOString()
    };
  }

  return {
    submissionId: createId("submission"),
    txid: buildDeterministicTxid(signedClaim),
    provider: "engine-miner-local-dev",
    acceptedAt: new Date().toISOString()
  };
}