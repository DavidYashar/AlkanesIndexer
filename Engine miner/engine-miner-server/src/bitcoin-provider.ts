import type { EngineMinerServerConfig } from "./config.js";

export interface BitcoinProviderLookupHints {
  preferredProviders?: string[];
}

export interface BitcoinBalanceResult {
  provider: string;
  balanceSats: number;
}

export interface BitcoinTransactionOutput {
  valueSats: number;
  addresses: string[];
}

export interface BitcoinTransactionRecord {
  txid: string;
  outputs: BitcoinTransactionOutput[];
  raw: unknown;
}

export interface BitcoinTransactionLookupResult {
  provider: string;
  transaction: BitcoinTransactionRecord | null;
}

interface BitcoinProvider {
  readonly name: string;
  getAddressSpendableBalance(network: "mainnet" | "signet" | "regtest", address: string): Promise<number>;
  getTransaction(network: "mainnet" | "signet" | "regtest", txid: string): Promise<BitcoinTransactionRecord | null>;
}

export interface BitcoinProviderRouter {
  getAddressSpendableBalance(args: {
    network: "mainnet" | "signet" | "regtest";
    address: string;
    hints?: BitcoinProviderLookupHints;
  }): Promise<BitcoinBalanceResult>;
  getTransaction(args: {
    network: "mainnet" | "signet" | "regtest";
    txid: string;
    hints?: BitcoinProviderLookupHints;
  }): Promise<BitcoinTransactionLookupResult>;
}

function normalizeProviderName(name: string): string {
  return name.trim().toLowerCase();
}

function uniqueProviderNames(names: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  for (const name of names) {
    if (!name) {
      continue;
    }

    const normalized = normalizeProviderName(name);
    if (!result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result;
}

function parseJsonPayload(payload: unknown): unknown {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: unknown }).data;
  }

  if (payload && typeof payload === "object" && "result" in payload) {
    return (payload as { result: unknown }).result;
  }

  return payload;
}

function toSatsFromUtxoValue(value: unknown): number {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : Math.round(value * 100_000_000);
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isNaN(parsed)) {
      throw new Error(`Unexpected UTXO value: ${value}`);
    }
    return Number.isInteger(parsed) ? parsed : Math.round(parsed * 100_000_000);
  }

  throw new Error("Unsupported UTXO value type.");
}

function toSatsFromBitcoinCoreValue(value: unknown): number {
  if (typeof value === "number") {
    return Math.round(value * 100_000_000);
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isNaN(parsed)) {
      throw new Error(`Unexpected tx output value: ${value}`);
    }
    return Math.round(parsed * 100_000_000);
  }

  throw new Error("Unsupported tx output value type.");
}

function asStringArray(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim());
  }

  return [];
}

function normalizeBitcoinCoreTransaction(txid: string, payload: unknown, provider: string): BitcoinTransactionRecord | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const vout = Array.isArray((payload as { vout?: unknown[] }).vout) ? (payload as { vout: unknown[] }).vout : [];
  return {
    txid,
    raw: payload,
    outputs: vout.map((output) => {
      const scriptPubKey = output && typeof output === "object" ? (output as { scriptPubKey?: unknown }).scriptPubKey : null;
      const addresses =
        scriptPubKey && typeof scriptPubKey === "object"
          ? [
              ...asStringArray((scriptPubKey as { address?: unknown }).address),
              ...asStringArray((scriptPubKey as { addresses?: unknown }).addresses)
            ]
          : [];

      return {
        valueSats: toSatsFromBitcoinCoreValue(output && typeof output === "object" ? (output as { value?: unknown }).value : 0),
        addresses: Array.from(new Set(addresses))
      };
    })
  };
}

function normalizeUniSatTransaction(txid: string, payload: unknown, provider: string): BitcoinTransactionRecord | null {
  const data = parseJsonPayload(payload);
  if (!data || typeof data !== "object") {
    return null;
  }

  const outputs =
    Array.isArray((data as { outputs?: unknown[] }).outputs)
      ? (data as { outputs: unknown[] }).outputs
      : Array.isArray((data as { vout?: unknown[] }).vout)
        ? (data as { vout: unknown[] }).vout
        : [];

  return {
    txid,
    raw: payload,
    outputs: outputs.map((output) => {
      const outputRecord = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
      const scriptPubKey = outputRecord.scriptPubKey && typeof outputRecord.scriptPubKey === "object"
        ? (outputRecord.scriptPubKey as Record<string, unknown>)
        : null;
      const addresses = Array.from(
        new Set([
          ...asStringArray(outputRecord.address),
          ...asStringArray(outputRecord.addresses),
          ...asStringArray(scriptPubKey?.address),
          ...asStringArray(scriptPubKey?.addresses)
        ])
      );

      const value = outputRecord.satoshi ?? outputRecord.value ?? outputRecord.valueSats ?? scriptPubKey?.value;
      return {
        valueSats: toSatsFromUtxoValue(value ?? 0),
        addresses
      };
    })
  };
}

function parseUniSatBalance(payload: unknown): number | null {
  const data = parseJsonPayload(payload);
  if (!data || typeof data !== "object") {
    return null;
  }

  const balanceRecord = data as Record<string, unknown>;
  for (const fieldName of ["totalSatoshi", "satoshi", "confirmedSatoshi", "balanceSats"]) {
    const value = balanceRecord[fieldName];
    if (value !== undefined) {
      return toSatsFromUtxoValue(value);
    }
  }

  if (balanceRecord.confirmed !== undefined) {
    const confirmed = toSatsFromUtxoValue(balanceRecord.confirmed);
    const unconfirmed = balanceRecord.unconfirmed !== undefined ? toSatsFromUtxoValue(balanceRecord.unconfirmed) : 0;
    return confirmed + unconfirmed;
  }

  return null;
}

function renderUniSatPath(template: string, values: Record<string, string>): string {
  let rendered = template;
  for (const [key, value] of Object.entries(values)) {
    rendered = rendered.replaceAll(`{${key}}`, encodeURIComponent(value));
  }
  return rendered;
}

class LocalDevBitcoinProvider implements BitcoinProvider {
  readonly name = "local-dev";

  constructor(private readonly config: EngineMinerServerConfig) {}

  async getAddressSpendableBalance(): Promise<number> {
    return this.config.devFundingBalanceSats;
  }

  async getTransaction(_network: "mainnet" | "signet" | "regtest", txid: string): Promise<BitcoinTransactionRecord | null> {
    return {
      txid,
      raw: { txid, mode: "local-dev" },
      outputs: []
    };
  }
}

class SubfrostBitcoinProvider implements BitcoinProvider {
  readonly name = "subfrost";

  constructor(private readonly config: EngineMinerServerConfig) {}

  private async jsonRpc(method: string, params: unknown[]): Promise<unknown> {
    const response = await fetch(this.config.subfrostJsonRpcUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.config.subfrostApiKey ? { "x-subfrost-api-key": this.config.subfrostApiKey } : {})
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
        id: 1
      })
    });

    const payload = await response.json();
    if (!response.ok || payload?.error) {
      throw new Error(
        payload?.error?.message
          ? `Subfrost ${method} failed: ${String(payload.error.message)}`
          : `Subfrost ${method} failed with status ${response.status}.`
      );
    }

    return payload?.result;
  }

  async getAddressSpendableBalance(_network: "mainnet" | "signet" | "regtest", address: string): Promise<number> {
    const utxos = await this.jsonRpc("esplora_address::utxo", [address]);
    if (!Array.isArray(utxos)) {
      throw new Error("Subfrost address UTXO lookup returned an invalid payload.");
    }

    return utxos.reduce((total, utxo) => {
      const value = utxo && typeof utxo === "object" ? (utxo as { value?: unknown }).value : 0;
      return total + toSatsFromUtxoValue(value);
    }, 0);
  }

  async getTransaction(_network: "mainnet" | "signet" | "regtest", txid: string): Promise<BitcoinTransactionRecord | null> {
    const transaction = await this.jsonRpc("btc_getrawtransaction", [txid, true]);
    return normalizeBitcoinCoreTransaction(txid, transaction, this.name);
  }
}

class UniSatBitcoinProvider implements BitcoinProvider {
  readonly name = "unisat";

  constructor(private readonly config: EngineMinerServerConfig) {}

  private async request(pathname: string): Promise<unknown> {
    const response = await fetch(new URL(pathname, this.config.unisatOpenApiUrl), {
      method: "GET",
      headers: {
        accept: "application/json",
        ...(this.config.unisatApiKey
          ? {
              authorization: `Bearer ${this.config.unisatApiKey}`,
              "x-api-key": this.config.unisatApiKey
            }
          : {})
      }
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(
        payload?.msg
          ? `UniSat ${pathname} failed: ${String(payload.msg)}`
          : `UniSat ${pathname} failed with status ${response.status}.`
      );
    }

    return payload;
  }

  async getAddressSpendableBalance(network: "mainnet" | "signet" | "regtest", address: string): Promise<number> {
    const balancePayload = await this.request(
      renderUniSatPath(this.config.unisatAddressBalancePath, { address, network })
    );
    const parsedBalance = parseUniSatBalance(balancePayload);
    if (parsedBalance !== null) {
      return parsedBalance;
    }

    const utxoPayload = await this.request(renderUniSatPath(this.config.unisatAddressUtxoPath, { address, network }));
    const utxos = parseJsonPayload(utxoPayload);
    if (!Array.isArray(utxos)) {
      throw new Error("UniSat address lookup returned an invalid payload.");
    }

    return utxos.reduce((total, utxo) => {
      const value = utxo && typeof utxo === "object" ? (utxo as { satoshi?: unknown; value?: unknown }).satoshi ?? (utxo as { value?: unknown }).value : 0;
      return total + toSatsFromUtxoValue(value);
    }, 0);
  }

  async getTransaction(network: "mainnet" | "signet" | "regtest", txid: string): Promise<BitcoinTransactionRecord | null> {
    const payload = await this.request(renderUniSatPath(this.config.unisatTransactionPath, { txid, network }));
    return normalizeUniSatTransaction(txid, payload, this.name);
  }
}

function createProvider(name: string, config: EngineMinerServerConfig): BitcoinProvider {
  switch (name) {
    case "subfrost":
      return new SubfrostBitcoinProvider(config);
    case "unisat":
      return new UniSatBitcoinProvider(config);
    case "local-dev":
      return new LocalDevBitcoinProvider(config);
    default:
      throw new Error(`Unsupported Bitcoin provider: ${name}`);
  }
}

export function createBitcoinProviderRouter(config: EngineMinerServerConfig): BitcoinProviderRouter {
  const providerNames = uniqueProviderNames([
    config.bitcoinProviderPrimary,
    config.bitcoinProviderFallback,
    config.bitcoinProviderPrimary === "local-dev" && config.bitcoinProviderFallback === null ? null : "local-dev"
  ]);

  const providers = providerNames.map((name) => createProvider(name, config));

  async function withProviders<T>(
    preferredProviders: string[] | undefined,
    executor: (provider: BitcoinProvider) => Promise<T>
  ): Promise<{ provider: string; value: T }> {
    const orderedNames = uniqueProviderNames([...(preferredProviders || []), ...providerNames]);
    const orderedProviders = orderedNames.map((name) => {
      const provider = providers.find((candidate) => candidate.name === name);
      if (!provider) {
        throw new Error(`Bitcoin provider is not configured: ${name}`);
      }
      return provider;
    });

    const errors: string[] = [];
    for (const provider of orderedProviders) {
      try {
        const value = await executor(provider);
        return {
          provider: provider.name,
          value
        };
      } catch (error) {
        errors.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new Error(`All configured Bitcoin providers failed. ${errors.join(" | ")}`);
  }

  return {
    async getAddressSpendableBalance({ network, address, hints }) {
      const result = await withProviders(hints?.preferredProviders, (provider) =>
        provider.getAddressSpendableBalance(network, address)
      );
      return {
        provider: result.provider,
        balanceSats: result.value
      };
    },
    async getTransaction({ network, txid, hints }) {
      const result = await withProviders(hints?.preferredProviders, (provider) => provider.getTransaction(network, txid));
      return {
        provider: result.provider,
        transaction: result.value
      };
    }
  };
}