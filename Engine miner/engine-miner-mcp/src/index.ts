import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { EngineMinerBackendClient } from "./backend-client.js";
import {
  GetClaimStatusToolInputSchema,
  GetCurrentRoundToolInputSchema,
  GetMiningStatusToolInputSchema,
  ListClaimableRewardsToolInputSchema,
  RequestClaimReceiptToolInputSchema,
  RegistrationChallengeToolInputSchema,
  StartMiningToolInputSchema,
  StopMiningToolInputSchema,
  SubmitClaimFeePaymentToolInputSchema,
  SubmitRegistrationToolInputSchema,
  SubmitSolutionToolInputSchema
} from "./contracts.js";
import { LocalStateStore } from "./local-state.js";

function asToolResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

export function createMcpServer() {
  const config = loadConfig();
  const backend = new EngineMinerBackendClient(config.backendBaseUrl);
  const localState = new LocalStateStore(config.stateDir);

  const server = new McpServer({
    name: "engine-miner-mcp",
    version: "0.1.0"
  });

  server.tool(
    "engine_miner_get_registration_challenge",
    "Request a backend registration challenge for the current agent.",
    RegistrationChallengeToolInputSchema.shape,
    async (input) => {
      const challenge = await backend.getRegistrationChallenge({
        agentId: input.agentId || config.agentDefaults.agentId,
        agentProfile: {
          name: input.agentName || config.agentDefaults.name,
          runtime: input.agentRuntime || config.agentDefaults.runtime,
          version: input.agentVersion || config.agentDefaults.version
        },
        requestedNetwork: input.requestedNetwork || config.defaultNetwork
      });

      await localState.rememberChallenge(challenge);

      return asToolResult({
        challenge,
        nextAction: "Ask the wallet plugin to sign this challenge, then submit the RegistrationProof through engine_miner_submit_registration."
      });
    }
  );

  server.tool(
    "engine_miner_submit_registration",
    "Submit a wallet-signed registration proof and bind a wallet identity to a miner identity.",
    SubmitRegistrationToolInputSchema.shape,
    async (input) => {
      const registration = await backend.completeRegistration(input.proof);
      const minerState = await localState.recordRegistration(registration, input.proof);

      return asToolResult({
        registration,
        localState: minerState,
        nextAction: "Use engine_miner_start_mining to participate in rounds."
      });
    }
  );

  server.tool(
    "engine_miner_start_mining",
    "Mark the miner active and request backend participation in puzzle rounds.",
    StartMiningToolInputSchema.shape,
    async (input) => {
      const minerId = await localState.resolveMinerId(input.minerId);
      const response = await backend.startMining({
        minerId,
        strategy: {
          categories: input.categories,
          maxParallelRounds: input.maxParallelRounds
        }
      });
      const minerState = await localState.markMiningStarted(minerId);

      return asToolResult({
        mining: response,
        localState: minerState
      });
    }
  );

  server.tool(
    "engine_miner_stop_mining",
    "Stop active mining for the selected miner.",
    StopMiningToolInputSchema.shape,
    async (input) => {
      const minerId = await localState.resolveMinerId(input.minerId);
      const response = await backend.stopMining(minerId);
      const minerState = await localState.markMiningStopped(minerId);

      return asToolResult({
        mining: response,
        localState: minerState
      });
    }
  );

  server.tool(
    "engine_miner_get_current_round",
    "Fetch the current backend round descriptor for the selected miner.",
    GetCurrentRoundToolInputSchema.shape,
    async (input) => {
      const minerId = await localState.resolveMinerId(input.minerId);
      const round = await backend.getCurrentRound(minerId);
      const minerState = await localState.rememberRound(minerId, round.roundId);

      return asToolResult({
        round,
        localState: minerState
      });
    }
  );

  server.tool(
    "engine_miner_submit_solution",
    "Submit a solved puzzle answer for a backend round.",
    SubmitSolutionToolInputSchema.shape,
    async (input) => {
      const minerId = await localState.resolveMinerId(input.minerId);
      const result = await backend.submitSolution({
        roundId: input.roundId,
        minerId,
        answer: input.answer,
        reasoningCommitment: input.reasoningCommitment,
        toolTraceHash: input.toolTraceHash,
        submittedAtClient: input.submittedAtClient || new Date().toISOString()
      });

      const minerState = await localState.recordSolutionResult(minerId, result);
      let claimableRewards: unknown[] = [];

      if (result.claimable) {
        const rewardsResponse = await backend.listClaimableRewards(minerId);
        claimableRewards = rewardsResponse.rewards;
        await localState.recordClaimableRewards(minerId, rewardsResponse.rewards);
      }

      return asToolResult({
        solution: result,
        localState: minerState,
        claimableRewards
      });
    }
  );

  server.tool(
    "engine_miner_get_mining_status",
    "Fetch the current backend mining status and sync local MCP state.",
    GetMiningStatusToolInputSchema.shape,
    async (input) => {
      const minerId = await localState.resolveMinerId(input.minerId);
      const status = await backend.getMiningStatus(minerId);
      const syncedMinerState = await localState.syncStatus(status);

      return asToolResult({
        status,
        localState: syncedMinerState
      });
    }
  );

  server.tool(
    "engine_miner_list_claimable_rewards",
    "List claimable reward entries for the selected miner.",
    ListClaimableRewardsToolInputSchema.shape,
    async (input) => {
      const minerId = await localState.resolveMinerId(input.minerId);
      const response = await backend.listClaimableRewards(minerId);
      const minerState = await localState.recordClaimableRewards(minerId, response.rewards);

      return asToolResult({
        rewards: response.rewards,
        localState: minerState
      });
    }
  );

  server.tool(
    "engine_miner_request_claim_receipt",
    "Request a backend claim receipt for one or more claimable rewards.",
    RequestClaimReceiptToolInputSchema.shape,
    async (input) => {
      const minerId = await localState.resolveMinerId(input.minerId);
      const receipt = await backend.requestClaimReceipt({
        minerId,
        claimIds: input.claimIds
      });
      const minerState = await localState.recordClaimReceipt(minerId, receipt);

      return asToolResult({
        claimReceipt: receipt,
        localState: minerState,
        nextAction: "In the later wallet claim phase, the wallet will verify this receipt, prepare the claim, sign it locally, and broadcast under policy."
      });
    }
  );

  server.tool(
    "engine_miner_submit_claim_fee_payment",
    "Submit a claim-fee payment txid for a provisional winner reservation.",
    SubmitClaimFeePaymentToolInputSchema.shape,
    async (input) => {
      const minerId = await localState.resolveMinerId(input.minerId);
      const response = await backend.submitClaimFeePayment({
        claimReservationId: input.claimReservationId,
        minerId,
        fundingAddress: input.fundingAddress,
        addressType: input.addressType,
        txid: input.txid,
        rawTxHex: input.rawTxHex,
        provider: input.provider,
        bitcoinPrimary: input.bitcoinPrimary || config.providerDefaults.bitcoinPrimary,
        bitcoinFallback: input.bitcoinFallback || config.providerDefaults.bitcoinFallback,
        alkanesPrimary: input.alkanesPrimary || config.providerDefaults.alkanesPrimary
      });

      let claimableRewards: unknown[] = [];
      if (response.status === "payment_accepted") {
        const rewardsResponse = await backend.listClaimableRewards(minerId);
        claimableRewards = rewardsResponse.rewards;
        await localState.recordClaimableRewards(minerId, rewardsResponse.rewards);
      }

      return asToolResult({
        payment: response,
        claimableRewards,
        nextAction:
          response.status === "payment_accepted"
            ? "Request the claim receipt next, then have the wallet prepare and sign the claim."
            : "Check the reservation status and current round before retrying."
      });
    }
  );

  server.tool(
    "engine_miner_get_claim_status",
    "Fetch the backend status for a previously issued claim or claim receipt.",
    GetClaimStatusToolInputSchema.shape,
    async (input) => {
      const status = await backend.getClaimStatus(input.claimId);
      return asToolResult({
        claimStatus: status
      });
    }
  );

  return server;
}

async function start() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}