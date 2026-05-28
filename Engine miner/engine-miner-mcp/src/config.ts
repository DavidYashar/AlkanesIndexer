import path from "node:path";
import { NetworkSchema, type Network } from "./contracts.js";

function readStringEnv(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw ? raw : undefined;
}

export interface EngineMinerMcpConfig {
  backendBaseUrl: string;
  defaultNetwork: Network;
  stateDir: string;
  providerDefaults: {
    bitcoinPrimary?: string;
    bitcoinFallback?: string;
    alkanesPrimary?: string;
  };
  agentDefaults: {
    agentId: string;
    name: string;
    runtime: string;
    version: string;
  };
}

export function loadConfig(): EngineMinerMcpConfig {
  const backendBaseUrl = process.env.ENGINE_MINER_BACKEND_BASE_URL || "http://127.0.0.1:3031";
  const defaultNetwork = NetworkSchema.parse(process.env.ENGINE_MINER_DEFAULT_NETWORK || "mainnet");
  const stateDir = path.resolve(process.env.ENGINE_MINER_MCP_STATE_DIR || ".engine-miner-mcp-state");

  new URL(backendBaseUrl);

  return {
    backendBaseUrl,
    defaultNetwork,
    stateDir,
    providerDefaults: {
      bitcoinPrimary: readStringEnv("ENGINE_MINER_MCP_DEFAULT_BITCOIN_PRIMARY"),
      bitcoinFallback: readStringEnv("ENGINE_MINER_MCP_DEFAULT_BITCOIN_FALLBACK"),
      alkanesPrimary: readStringEnv("ENGINE_MINER_MCP_DEFAULT_ALKANES_PRIMARY")
    },
    agentDefaults: {
      agentId: process.env.ENGINE_MINER_MCP_AGENT_ID || "openclaw-local-agent",
      name: process.env.ENGINE_MINER_MCP_AGENT_NAME || "OpenClaw Engine Miner",
      runtime: process.env.ENGINE_MINER_MCP_AGENT_RUNTIME || "github-copilot/gpt-5.4",
      version: process.env.ENGINE_MINER_MCP_AGENT_VERSION || "0.1.0"
    }
  };
}