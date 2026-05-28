import {
  ClaimPaymentResponseSchema,
  ClaimReceiptSchema,
  ClaimStatusResponseSchema,
  ClaimableRewardsResponseSchema,
  MinerStatusResponseSchema,
  MiningStartResponseSchema,
  MiningStopResponseSchema,
  RegistrationChallengeRequestSchema,
  RegistrationChallengeSchema,
  RegistrationCompleteResponseSchema,
  RegistrationProofSchema,
  RoundDescriptorSchema,
  SolutionResultSchema,
  type RegistrationProof
} from "./contracts.js";

interface StartMiningInput {
  minerId: string;
  strategy: {
    categories: string[];
    maxParallelRounds: number;
  };
}

interface SubmitSolutionInput {
  roundId: string;
  minerId: string;
  answer: Record<string, unknown>;
  reasoningCommitment?: string;
  toolTraceHash?: string;
  submittedAtClient: string;
}

interface RequestClaimReceiptInput {
  minerId: string;
  claimIds: string[];
}

interface SubmitClaimFeePaymentInput {
  claimReservationId: string;
  minerId: string;
  fundingAddress: string;
  addressType: "p2tr" | "p2wpkh";
  txid: string;
  rawTxHex?: string;
  provider?: string;
  bitcoinPrimary?: string;
  bitcoinFallback?: string;
  alkanesPrimary?: string;
}

function buildErrorMessage(status: number, payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    return `Backend request failed with ${status}: ${String(payload.error)}`;
  }

  return `Backend request failed with ${status}: ${JSON.stringify(payload)}`;
}

export class EngineMinerBackendClient {
  constructor(private readonly baseUrl: string) {}

  async getRegistrationChallenge(input: {
    agentId: string;
    agentProfile: { name: string; runtime: string; version: string };
    requestedNetwork: "mainnet" | "signet" | "regtest";
  }) {
    return this.request(
      "/v1/registration/challenge",
      {
        method: "POST",
        body: JSON.stringify(RegistrationChallengeRequestSchema.parse(input))
      },
      RegistrationChallengeSchema
    );
  }

  async completeRegistration(proof: RegistrationProof) {
    return this.request(
      "/v1/registration/complete",
      {
        method: "POST",
        body: JSON.stringify(RegistrationProofSchema.parse(proof))
      },
      RegistrationCompleteResponseSchema
    );
  }

  async startMining(input: StartMiningInput) {
    return this.request(
      "/v1/mining/start",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      MiningStartResponseSchema
    );
  }

  async stopMining(minerId: string) {
    return this.request(
      "/v1/mining/stop",
      {
        method: "POST",
        body: JSON.stringify({ minerId })
      },
      MiningStopResponseSchema
    );
  }

  async getCurrentRound(minerId: string) {
    return this.request(
      `/v1/rounds/current?minerId=${encodeURIComponent(minerId)}`,
      { method: "GET" },
      RoundDescriptorSchema
    );
  }

  async submitSolution(input: SubmitSolutionInput) {
    return this.request(
      `/v1/rounds/${encodeURIComponent(input.roundId)}/solutions`,
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      SolutionResultSchema
    );
  }

  async getMiningStatus(minerId: string) {
    return this.request(
      `/v1/miners/${encodeURIComponent(minerId)}/status`,
      { method: "GET" },
      MinerStatusResponseSchema
    );
  }

  async listClaimableRewards(minerId: string) {
    return this.request(
      `/v1/miners/${encodeURIComponent(minerId)}/claimable-rewards`,
      { method: "GET" },
      ClaimableRewardsResponseSchema
    );
  }

  async requestClaimReceipt(input: RequestClaimReceiptInput) {
    return this.request(
      "/v1/claims/request",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      ClaimReceiptSchema
    );
  }

  async submitClaimFeePayment(input: SubmitClaimFeePaymentInput) {
    return this.request(
      `/v1/claims/reservations/${encodeURIComponent(input.claimReservationId)}/payment`,
      {
        method: "POST",
        body: JSON.stringify({
          minerId: input.minerId,
          feePayment: {
            fundingAddress: input.fundingAddress,
            addressType: input.addressType,
            txid: input.txid,
            ...(input.rawTxHex ? { rawTxHex: input.rawTxHex } : {}),
            ...(input.provider ? { provider: input.provider } : {})
          },
          providerHints: {
            ...(input.bitcoinPrimary ? { bitcoinPrimary: input.bitcoinPrimary } : {}),
            ...(input.bitcoinFallback ? { bitcoinFallback: input.bitcoinFallback } : {}),
            ...(input.alkanesPrimary ? { alkanesPrimary: input.alkanesPrimary } : {})
          }
        })
      },
      ClaimPaymentResponseSchema
    );
  }

  async getClaimStatus(claimId: string) {
    return this.request(
      `/v1/claims/${encodeURIComponent(claimId)}/status`,
      { method: "GET" },
      ClaimStatusResponseSchema
    );
  }

  private async request<T>(pathname: string, init: RequestInit, schema: { parse(data: unknown): T }): Promise<T> {
    const response = await fetch(new URL(pathname, this.baseUrl), {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init.headers || {})
      }
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    if (!response.ok) {
      throw new Error(buildErrorMessage(response.status, payload));
    }

    return schema.parse(payload);
  }
}