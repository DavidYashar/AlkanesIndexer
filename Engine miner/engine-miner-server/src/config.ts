import { existsSync } from "node:fs";
import { resolve } from "node:path";

let didLoadLocalEnvFile = false;

function loadLocalEnvFile(): void {
  if (didLoadLocalEnvFile) {
    return;
  }

  didLoadLocalEnvFile = true;

  const envFilePath = resolve(process.cwd(), ".env");
  if (!existsSync(envFilePath)) {
    return;
  }

  const processWithLoadEnvFile = process as typeof process & {
    loadEnvFile?: (path?: string) => void;
  };

  if (typeof processWithLoadEnvFile.loadEnvFile === "function") {
    processWithLoadEnvFile.loadEnvFile(envFilePath);
  }
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected ${name} to be an integer, received: ${raw}`);
  }

  return parsed;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  if (raw === "true") {
    return true;
  }

  if (raw === "false") {
    return false;
  }

  throw new Error(`Expected ${name} to be true or false, received: ${raw}`);
}

function readStringEnv(name: string): string | null {
  const raw = process.env[name];
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function readDelimitedEnv(name: string): string[] | null {
  const raw = readStringEnv(name);
  if (!raw) {
    return null;
  }

  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  return values.length > 0 ? values : null;
}

function normalizeBigIntString(name: string, value: string): string {
  if (/^0x[0-9a-fA-F]+$/.test(value) || /^\d+$/.test(value)) {
    return BigInt(value).toString(10);
  }

  throw new Error(`Expected ${name} to be an unsigned integer or hex string, received: ${value}`);
}

function readBigIntStringEnv(name: string): string | null {
  const raw = readStringEnv(name);
  if (!raw) {
    return null;
  }

  return normalizeBigIntString(name, raw);
}

function readPositiveBigIntStringEnv(name: string): string | null {
  const normalized = readBigIntStringEnv(name);
  if (normalized === null) {
    return null;
  }

  if (BigInt(normalized) < 1n) {
    throw new Error(`Expected ${name} to be greater than zero, received: ${normalized}`);
  }

  return normalized;
}

type BitcoinProviderName = "subfrost" | "unisat" | "local-dev";
type SettlementUtxoSource = "metashrew" | "espo";

function readBitcoinProviderEnv(name: string, fallback: BitcoinProviderName | null): BitcoinProviderName | null {
  const raw = readStringEnv(name);
  if (!raw) {
    return fallback;
  }

  if (raw === "subfrost" || raw === "unisat" || raw === "local-dev") {
    return raw;
  }

  throw new Error(`Unsupported ${name}: ${raw}`);
}

function readSettlementUtxoSourceEnv(name: string): SettlementUtxoSource | null {
  const raw = readStringEnv(name);
  if (!raw) {
    return null;
  }

  if (raw === "metashrew" || raw === "espo") {
    return raw;
  }

  throw new Error(`Unsupported ${name}: ${raw}`);
}

function hasAnyEnv(names: string[]): boolean {
  return names.some((name) => readStringEnv(name) !== null);
}

function defaultSubfrostJsonRpcUrl(network: "mainnet" | "signet" | "regtest"): string {
  return `https://${network}.subfrost.io/v4/jsonrpc`;
}

function defaultSubfrostAlkanesRpcUrl(network: "mainnet" | "signet" | "regtest"): string {
  return `https://${network}.subfrost.io/v4/subfrost`;
}

function normalizeAlkanesRpcUrl(raw: string | null, network: "mainnet" | "signet" | "regtest"): string {
  if (!raw) {
    return defaultSubfrostAlkanesRpcUrl(network);
  }

  return raw.endsWith("/jsonrpc") ? `${raw.slice(0, -"/jsonrpc".length)}/subfrost` : raw;
}

export interface EngineMinerSettlementBuilderConfig {
  rpcUrl: string;
  bitcoinRpcUrl: string;
  mnemonic: string;
  passphrase: string | null;
  feeRate: number;
  btcInputSats: number;
  contractBlock: string;
  contractTx: string;
  opcode: string;
  inputTemplate: string[];
  inputRequirementsTemplate: string;
  authTokenBlock: string | null;
  authTokenTx: string | null;
  authTokenUnits: string | null;
  toAddressesTemplate: string[];
  pointer: string;
  refund: string;
  fromAddresses: string[] | null;
  changeAddress: string | null;
  alkanesChangeAddress: string | null;
  traceEnabled: boolean;
  rawOutput: boolean;
  utxoSource: SettlementUtxoSource | null;
  mempoolIndexer: boolean;
  splitTransactions: boolean;
}

function loadSettlementBuilderConfig(defaultNetwork: "mainnet" | "signet" | "regtest"): EngineMinerSettlementBuilderConfig | null {
  const requiredEnvNames = [
    "ENGINE_MINER_SETTLEMENT_MNEMONIC",
    "ENGINE_MINER_SETTLEMENT_CONTRACT_BLOCK",
    "ENGINE_MINER_SETTLEMENT_CONTRACT_TX",
    "ENGINE_MINER_SETTLEMENT_OPCODE"
  ];

  if (!hasAnyEnv(requiredEnvNames)) {
    return null;
  }

  const mnemonic = readStringEnv("ENGINE_MINER_SETTLEMENT_MNEMONIC");
  const contractBlock = readBigIntStringEnv("ENGINE_MINER_SETTLEMENT_CONTRACT_BLOCK");
  const contractTx = readBigIntStringEnv("ENGINE_MINER_SETTLEMENT_CONTRACT_TX");
  const opcode = readBigIntStringEnv("ENGINE_MINER_SETTLEMENT_OPCODE");
  const hasAnyAuthTokenEnv = hasAnyEnv([
    "ENGINE_MINER_SETTLEMENT_AUTH_TOKEN_BLOCK",
    "ENGINE_MINER_SETTLEMENT_AUTH_TOKEN_TX",
    "ENGINE_MINER_SETTLEMENT_AUTH_TOKEN_UNITS"
  ]);
  const authTokenBlock = readBigIntStringEnv("ENGINE_MINER_SETTLEMENT_AUTH_TOKEN_BLOCK");
  const authTokenTx = readBigIntStringEnv("ENGINE_MINER_SETTLEMENT_AUTH_TOKEN_TX");
  const authTokenUnits = readPositiveBigIntStringEnv("ENGINE_MINER_SETTLEMENT_AUTH_TOKEN_UNITS");

  if (!mnemonic || !contractBlock || !contractTx || !opcode) {
    throw new Error(
      "ENGINE_MINER_SETTLEMENT_MNEMONIC, ENGINE_MINER_SETTLEMENT_CONTRACT_BLOCK, ENGINE_MINER_SETTLEMENT_CONTRACT_TX, and ENGINE_MINER_SETTLEMENT_OPCODE are required when the direct settlement builder is enabled."
    );
  }

  if (hasAnyAuthTokenEnv && (!authTokenBlock || !authTokenTx)) {
    throw new Error(
      "ENGINE_MINER_SETTLEMENT_AUTH_TOKEN_BLOCK and ENGINE_MINER_SETTLEMENT_AUTH_TOKEN_TX must both be set when configuring settlement auth token requirements."
    );
  }

  return {
    rpcUrl: normalizeAlkanesRpcUrl(
      readStringEnv("ENGINE_MINER_ALKANES_RPC_URL") || readStringEnv("SUBFROST_JSONRPC_URL"),
      defaultNetwork
    ),
    bitcoinRpcUrl: readStringEnv("SUBFROST_JSONRPC_URL") || defaultSubfrostJsonRpcUrl(defaultNetwork),
    mnemonic,
    passphrase: readStringEnv("ENGINE_MINER_SETTLEMENT_PASSPHRASE"),
    feeRate: readNumberEnv("ENGINE_MINER_SETTLEMENT_FEE_RATE", 2),
    btcInputSats: readNumberEnv("ENGINE_MINER_SETTLEMENT_BTC_INPUT_SATS", 10000),
    contractBlock,
    contractTx,
    opcode,
    inputTemplate: readDelimitedEnv("ENGINE_MINER_SETTLEMENT_INPUT_TEMPLATE") || ["rewardTokens", "receiptPayloadHashHi", "receiptPayloadHashLo"],
    inputRequirementsTemplate:
      readStringEnv("ENGINE_MINER_SETTLEMENT_INPUT_REQUIREMENTS_TEMPLATE") || "B:{btcSats}",
    authTokenBlock,
    authTokenTx,
    authTokenUnits: authTokenBlock && authTokenTx ? authTokenUnits || "1" : null,
    toAddressesTemplate: readDelimitedEnv("ENGINE_MINER_SETTLEMENT_TO_ADDRESSES_TEMPLATE") || ["{payoutAddress}"],
    pointer: readStringEnv("ENGINE_MINER_SETTLEMENT_POINTER") || "v0",
    refund: readStringEnv("ENGINE_MINER_SETTLEMENT_REFUND") || "v0",
    fromAddresses: readDelimitedEnv("ENGINE_MINER_SETTLEMENT_FROM_ADDRESSES"),
    changeAddress: readStringEnv("ENGINE_MINER_SETTLEMENT_CHANGE_ADDRESS"),
    alkanesChangeAddress: readStringEnv("ENGINE_MINER_SETTLEMENT_ALKANES_CHANGE_ADDRESS"),
    traceEnabled: readBooleanEnv("ENGINE_MINER_SETTLEMENT_TRACE_ENABLED", false),
    rawOutput: readBooleanEnv("ENGINE_MINER_SETTLEMENT_RAW_OUTPUT", false),
    utxoSource: readSettlementUtxoSourceEnv("ENGINE_MINER_SETTLEMENT_UTXO_SOURCE"),
    mempoolIndexer: readBooleanEnv("ENGINE_MINER_SETTLEMENT_MEMPOOL_INDEXER", false),
    splitTransactions: readBooleanEnv("ENGINE_MINER_SETTLEMENT_SPLIT_TRANSACTIONS", false)
  };
}

export interface EngineMinerServerConfig {
  host: string;
  port: number;
  publicBaseUrl: string;
  defaultNetwork: "mainnet" | "signet" | "regtest";
  roundDurationMs: number;
  claimPaymentWindowMs: number;
  requiredClaimFeeSats: number;
  claimFeeTreasuryAddress: string | null;
  devFundingBalanceSats: number;
  bitcoinProviderPrimary: BitcoinProviderName;
  bitcoinProviderFallback: BitcoinProviderName | null;
  subfrostJsonRpcUrl: string;
  subfrostApiKey: string | null;
  unisatOpenApiUrl: string;
  unisatApiKey: string | null;
  unisatAddressBalancePath: string;
  unisatAddressUtxoPath: string;
  unisatTransactionPath: string;
  settlementBuilder: EngineMinerSettlementBuilderConfig | null;
  claimSubmissionRelayUrl: string | null;
}

export function loadConfig(): EngineMinerServerConfig {
  loadLocalEnvFile();

  const defaultNetwork =
    (process.env.ENGINE_MINER_SERVER_DEFAULT_NETWORK as EngineMinerServerConfig["defaultNetwork"] | undefined) ||
    "mainnet";

  if (!["mainnet", "signet", "regtest"].includes(defaultNetwork)) {
    throw new Error(`Unsupported ENGINE_MINER_SERVER_DEFAULT_NETWORK: ${defaultNetwork}`);
  }

  const bitcoinProviderPrimary = readBitcoinProviderEnv("ENGINE_MINER_BITCOIN_PROVIDER_PRIMARY", "local-dev") || "local-dev";
  const bitcoinProviderFallback = readBitcoinProviderEnv("ENGINE_MINER_BITCOIN_PROVIDER_FALLBACK", null);

  return {
    host: process.env.ENGINE_MINER_SERVER_HOST || "127.0.0.1",
    port: readNumberEnv("ENGINE_MINER_SERVER_PORT", 3031),
    publicBaseUrl: process.env.ENGINE_MINER_SERVER_BASE_URL || "http://127.0.0.1:3031",
    defaultNetwork,
    roundDurationMs: readNumberEnv("ENGINE_MINER_SERVER_ROUND_DURATION_MS", 300000),
    claimPaymentWindowMs: readNumberEnv("ENGINE_MINER_SERVER_CLAIM_PAYMENT_WINDOW_MS", 120000),
    requiredClaimFeeSats: readNumberEnv("ENGINE_MINER_SERVER_REQUIRED_CLAIM_FEE_SATS", 7000),
    claimFeeTreasuryAddress: readStringEnv("ENGINE_MINER_CLAIM_FEE_TREASURY_ADDRESS"),
    devFundingBalanceSats: readNumberEnv("ENGINE_MINER_DEV_FUNDING_BALANCE_SATS", 100000),
    bitcoinProviderPrimary,
    bitcoinProviderFallback,
    subfrostJsonRpcUrl: readStringEnv("SUBFROST_JSONRPC_URL") || defaultSubfrostJsonRpcUrl(defaultNetwork),
    subfrostApiKey: readStringEnv("SUBFROST_API_KEY"),
    unisatOpenApiUrl: readStringEnv("UNISAT_OPENAPI_URL") || "https://open-api.unisat.io",
    unisatApiKey: readStringEnv("UNISAT_API_KEY"),
    unisatAddressBalancePath:
      readStringEnv("UNISAT_ADDRESS_BALANCE_PATH") || "/v1/indexer/address/{address}/balance",
    unisatAddressUtxoPath:
      readStringEnv("UNISAT_ADDRESS_UTXO_PATH") || "/v1/indexer/address/{address}/utxo-data",
    unisatTransactionPath: readStringEnv("UNISAT_TRANSACTION_PATH") || "/v1/indexer/tx/{txid}",
    settlementBuilder: loadSettlementBuilderConfig(defaultNetwork),
    claimSubmissionRelayUrl: process.env.ENGINE_MINER_CLAIM_SUBMISSION_RELAY_URL || null
  };
}