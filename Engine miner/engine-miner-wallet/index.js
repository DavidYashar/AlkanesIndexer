import { getPayoutAddress, getWalletStatus, signWalletRegistrationChallenge } from "./lib/wallet-core.js";

const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {}
};

const STRING_SCHEMA = (description) => ({
  type: "string",
  ...(description ? { description } : {})
});

const BOOLEAN_SCHEMA = (description) => ({
  type: "boolean",
  ...(description ? { description } : {})
});

function textResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
  };
}

function errorResult(error) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            error: error instanceof Error ? error.message : String(error)
          },
          null,
          2
        )
      }
    ],
    isError: true
  };
}

function resolvePluginConfig(api) {
  const pluginConfig =
    (api && typeof api === "object" && "pluginConfig" in api && api.pluginConfig) ||
    (api && typeof api === "object" && "config" in api && api.config) ||
    {};

  return {
    enabled: pluginConfig.enabled !== false,
    network: pluginConfig.network || "mainnet",
    policyMode: pluginConfig.policyMode || "claim_only",
    engineMinerApiUrl: pluginConfig.engineMinerApiUrl || null,
    alkanesProviderUrl: pluginConfig.alkanesProviderUrl || null,
    walletStateDir: pluginConfig.walletStateDir || null,
    requireBroadcastConfirmation: pluginConfig.requireBroadcastConfirmation !== false,
    maxFeeSats: Number.isInteger(pluginConfig.maxFeeSats) ? pluginConfig.maxFeeSats : 5000,
    coldSweepAddress: pluginConfig.coldSweepAddress || null
  };
}

function buildWalletOptions(config) {
  return {
    stateDir: config.walletStateDir || undefined
  };
}

function createTool(name, description, parameters, handler) {
  return {
    name,
    description,
    parameters,
    async execute(_id, params) {
      try {
        return await handler(params || {});
      } catch (error) {
        return errorResult(error);
      }
    }
  };
}

function scaffoldResult(config, toolName, params = {}) {
  return textResult({
    pluginId: "engine-miner-wallet",
    tool: toolName,
    scaffold: true,
    implemented: false,
    policyMode: config.policyMode,
    network: config.network,
    keystoreAndTaprootReady: true,
    configPreview: {
      enabled: config.enabled,
      engineMinerApiConfigured: Boolean(config.engineMinerApiUrl),
      alkanesProviderConfigured: Boolean(config.alkanesProviderUrl),
      requireBroadcastConfirmation: config.requireBroadcastConfirmation,
      maxFeeSats: config.maxFeeSats,
      hasColdSweepAddress: Boolean(config.coldSweepAddress),
      hasCustomWalletStateDir: Boolean(config.walletStateDir)
    },
    receivedParams: params,
    nextStep:
      "Claim receipt verification, PSBT policy validation, and constrained signing remain to be implemented."
  });
}

const plugin = {
  id: "engine-miner-wallet",
  name: "Engine miner Wallet",
  description: "Taproot-first claim-focused wallet scaffold for Engine miner agents on OpenClaw.",
  register(api) {
    const config = resolvePluginConfig(api);
    const walletOptions = buildWalletOptions(config);

    const tools = [
      createTool(
        "engine_miner_wallet_status",
        "Inspect Engine miner wallet plugin status, keystore accessibility, and payout-address readiness.",
        EMPTY_OBJECT_SCHEMA,
        async () => {
          const walletStatus = getWalletStatus(walletOptions);
          return textResult({
            pluginId: "engine-miner-wallet",
            policyMode: config.policyMode,
            configuredNetwork: config.network,
            keystoreAndTaprootReady: true,
            wallet: walletStatus,
            configPreview: {
              enabled: config.enabled,
              engineMinerApiConfigured: Boolean(config.engineMinerApiUrl),
              alkanesProviderConfigured: Boolean(config.alkanesProviderUrl),
              requireBroadcastConfirmation: config.requireBroadcastConfirmation,
              maxFeeSats: config.maxFeeSats,
              hasColdSweepAddress: Boolean(config.coldSweepAddress),
              hasCustomWalletStateDir: Boolean(config.walletStateDir)
            },
            setupHint: walletStatus.initialized
              ? null
              : "Run the human-only admin command `node ./admin.js init` inside the plugin folder before agent wallet tools are used."
          });
        }
      ),
      createTool(
        "engine_miner_wallet_get_payout_address",
        "Return the current BIP86 Taproot payout address for the initialized Engine miner wallet.",
        EMPTY_OBJECT_SCHEMA,
        async () => {
          const payout = getPayoutAddress(walletOptions);
          return textResult({
            pluginId: "engine-miner-wallet",
            addressFormat: "bip86-p2tr",
            ...payout
          });
        }
      ),
      createTool(
        "engine_miner_wallet_sign_registration_challenge",
        "Sign an Engine miner registration challenge with the wallet identity key.",
        {
          type: "object",
          additionalProperties: false,
          required: ["challenge", "expiresAt"],
          properties: {
            challenge: STRING_SCHEMA("Opaque registration challenge from Engine miner backend."),
            expiresAt: STRING_SCHEMA("Challenge expiry timestamp in ISO 8601 format."),
            domain: STRING_SCHEMA("Optional domain or origin binding.")
          }
        },
        async (params) => {
          const signedChallenge = signWalletRegistrationChallenge({
            ...walletOptions,
            challenge: params.challenge,
            expiresAt: params.expiresAt,
            domain: params.domain
          });
          return textResult({
            pluginId: "engine-miner-wallet",
            ...signedChallenge
          });
        }
      ),
      createTool(
        "engine_miner_wallet_list_claimable_rewards",
        "List claimable Engine miner rewards for the currently registered payout address.",
        EMPTY_OBJECT_SCHEMA,
        async (params) => scaffoldResult(config, "engine_miner_wallet_list_claimable_rewards", params)
      ),
      createTool(
        "engine_miner_wallet_prepare_claim",
        "Validate a claim receipt and prepare a signable claim transaction package.",
        {
          type: "object",
          additionalProperties: false,
          required: ["claimReceipt"],
          properties: {
            claimReceipt: STRING_SCHEMA("Serialized Engine miner claim receipt or claim bundle."),
            claimId: STRING_SCHEMA("Optional explicit claim id when the receipt carries multiple claims.")
          }
        },
        async (params) => scaffoldResult(config, "engine_miner_wallet_prepare_claim", params)
      ),
      createTool(
        "engine_miner_wallet_sign_prepared_claim",
        "Locally sign a previously prepared and validated claim package.",
        {
          type: "object",
          additionalProperties: false,
          required: ["preparedClaim"],
          properties: {
            preparedClaim: STRING_SCHEMA("Prepared claim package generated by engine_miner_wallet_prepare_claim.")
          }
        },
        async (params) => scaffoldResult(config, "engine_miner_wallet_sign_prepared_claim", params)
      ),
      createTool(
        "engine_miner_wallet_broadcast_prepared_claim",
        "Broadcast a signed Engine miner claim transaction after explicit confirmation.",
        {
          type: "object",
          additionalProperties: false,
          required: ["signedClaim", "confirmed"],
          properties: {
            signedClaim: STRING_SCHEMA("Signed claim transaction package ready for broadcast."),
            confirmed: BOOLEAN_SCHEMA("Must be true after the user has explicitly approved broadcast.")
          }
        },
        async (params) => scaffoldResult(config, "engine_miner_wallet_broadcast_prepared_claim", params)
      )
    ];

    for (const tool of tools) {
      api.registerTool(tool);
    }
  }
};

export default plugin;
export const activate = plugin.register;