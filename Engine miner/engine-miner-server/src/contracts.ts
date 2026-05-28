import { z } from "zod";

export const AddressTypeSchema = z.enum(["p2tr", "p2wpkh"]);
export const NetworkSchema = z.enum(["mainnet", "signet", "regtest"]);
export const ClaimRewardStatusSchema = z.enum(["payment_pending", "claimable", "receipt_issued", "submitted", "expired"]);

export const AgentProfileSchema = z.object({
  name: z.string().min(1),
  runtime: z.string().min(1),
  version: z.string().min(1)
});

export const RegistrationChallengeRequestSchema = z.object({
  agentId: z.string().min(1),
  agentProfile: AgentProfileSchema,
  requestedNetwork: NetworkSchema
});

export const RegistrationSignedPayloadSchema = z.object({
  scheme: z.literal("engine-miner-registration-v1"),
  challenge: z.string().min(1),
  expiresAt: z.string().datetime(),
  domain: z.string().min(1),
  network: NetworkSchema,
  address: z.string().min(1),
  fundingAddress: z.string().min(1),
  addressType: AddressTypeSchema,
  internalPubkey: z.string().min(1),
  derivationPath: z.string().min(1)
});

export const RegistrationProofSchema = z.object({
  registrationId: z.string().min(1),
  payoutAddress: z.string().min(1),
  fundingAddress: z.string().min(1),
  addressType: AddressTypeSchema,
  publicKey: z.string().min(1),
  internalPubkey: z.string().min(1),
  derivationPath: z.string().min(1),
  signedPayload: RegistrationSignedPayloadSchema,
  signature: z.string().min(1)
});

export const MiningStartRequestSchema = z.object({
  minerId: z.string().min(1),
  strategy: z.object({
    categories: z.array(z.string().min(1)).default([]),
    maxParallelRounds: z.number().int().positive().default(1)
  })
});

export const MiningStopRequestSchema = z.object({
  minerId: z.string().min(1)
});

export const SolutionSubmissionSchema = z.object({
  roundId: z.string().min(1),
  minerId: z.string().min(1),
  answer: z.record(z.unknown()),
  reasoningCommitment: z.string().optional(),
  toolTraceHash: z.string().optional(),
  submittedAtClient: z.string().datetime()
});

export const ClaimRequestSchema = z.object({
  minerId: z.string().min(1),
  claimIds: z.array(z.string().min(1)).min(1)
});

export const ClaimReceiptSchema = z.object({
  claimId: z.string().min(1),
  payoutAddress: z.string().min(1),
  rewardTokens: z.number().nonnegative(),
  roundIds: z.array(z.string().min(1)).min(1),
  nonce: z.string().min(1),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  settlementMode: z.literal("claim"),
  backendSignature: z.string().min(1)
});

export const PreparedClaimSchema = z.object({
  schema: z.literal("engine-miner-prepared-claim-v1"),
  claimId: z.string().min(1),
  preparedAt: z.string().datetime(),
  claimReceipt: ClaimReceiptSchema,
  wallet: z.object({
    network: NetworkSchema,
    addressType: AddressTypeSchema,
    payoutAddress: z.string().min(1),
    fundingAddress: z.string().min(1),
    derivationPath: z.string().min(1),
    publicKey: z.string().min(1),
    internalPubkey: z.string().min(1),
    masterFingerprint: z.string().min(1)
  }),
  policy: z.object({
    policyMode: z.string().min(1),
    requireBroadcastConfirmation: z.boolean(),
    maxFeeSats: z.number().int().nonnegative()
  }),
  backendVerification: z.object({
    verified: z.boolean(),
    algorithm: z.string().min(1),
    signerKeyId: z.string().min(1),
    trustedKeySource: z.string().min(1),
    receiptPayloadHash: z.string().min(1)
  }),
  settlement: z.object({
    mode: z.string().min(1),
    engineMinerApiConfigured: z.boolean(),
    alkanesProviderConfigured: z.boolean(),
    broadcastStrategy: z.string().min(1)
  }),
  preparedClaimDigestHex: z.string().min(1)
});

export const SignedClaimSchema = z.object({
  schema: z.literal("engine-miner-signed-claim-v1"),
  claimId: z.string().min(1),
  signedAt: z.string().datetime(),
  preparedClaim: PreparedClaimSchema,
  walletSignature: z.object({
    tag: z.string().min(1),
    payloadJson: z.string().min(1),
    digestHex: z.string().min(1),
    signatureAlgorithm: z.string().min(1),
    signatureEncoding: z.string().min(1),
    address: z.string().min(1),
    publicKey: z.string().min(1),
    internalPubkey: z.string().min(1),
    derivationPath: z.string().min(1),
    signature: z.string().min(1)
  })
});

export const ClaimSubmissionRequestSchema = z.object({
  signedClaim: SignedClaimSchema
});

export const ProviderHintsSchema = z
  .object({
    bitcoinPrimary: z.string().min(1).optional(),
    bitcoinFallback: z.string().min(1).optional(),
    alkanesPrimary: z.string().min(1).optional()
  })
  .optional();

export const ClaimFeePaymentSchema = z.object({
  fundingAddress: z.string().min(1),
  addressType: AddressTypeSchema,
  txid: z.string().min(1),
  rawTxHex: z.string().min(1).optional(),
  submittedAt: z.string().datetime().optional(),
  provider: z.string().min(1).optional()
});

export const ClaimPaymentSubmissionSchema = z.object({
  minerId: z.string().min(1),
  network: NetworkSchema.optional(),
  feePayment: ClaimFeePaymentSchema,
  providerHints: ProviderHintsSchema
});

export type RegistrationChallengeRequest = z.infer<typeof RegistrationChallengeRequestSchema>;
export type RegistrationProof = z.infer<typeof RegistrationProofSchema>;
export type MiningStartRequest = z.infer<typeof MiningStartRequestSchema>;
export type MiningStopRequest = z.infer<typeof MiningStopRequestSchema>;
export type SolutionSubmission = z.infer<typeof SolutionSubmissionSchema>;
export type ClaimRequest = z.infer<typeof ClaimRequestSchema>;
export type SignedClaim = z.infer<typeof SignedClaimSchema>;
export type ClaimSubmissionRequest = z.infer<typeof ClaimSubmissionRequestSchema>;
export type ClaimPaymentSubmission = z.infer<typeof ClaimPaymentSubmissionSchema>;

export interface RegistrationChallenge {
  registrationId: string;
  challenge: string;
  expiresAt: string;
  domain: string;
  network: "mainnet" | "signet" | "regtest";
}

export interface RoundDescriptor {
  roundId: string;
  roundNumber: number;
  category: string;
  difficulty: number;
  parameters: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  rewardTokens: number;
  submissionRules: {
    maxAttempts: number;
    answerFormat: string;
    puzzleLifetimeMs?: number;
    claimPaymentWindowMs?: number;
    requiredClaimFeeSats?: number;
    winnerSelectionMode?: string;
    fundingEligibilityRequired?: boolean;
  };
}

export interface SolutionResult {
  submissionId: string;
  roundId: string;
  accepted: boolean;
  verificationStatus: string;
  winner: boolean;
  winnerStatus?: string;
  claimReservationId?: string | null;
  queuePosition?: number;
  serverReceivedAt?: string;
  paymentDeadlineAt?: string | null;
  rewardTokens: number;
  claimable: boolean;
  nextPollAfterMs: number;
}

export interface ClaimableReward {
  claimId: string;
  claimReservationId: string | null;
  roundId: string;
  payoutAddress: string;
  rewardTokens: number;
  status: "payment_pending" | "claimable" | "receipt_issued" | "submitted" | "expired";
  paymentDeadlineAt: string | null;
  paymentTxid?: string | null;
  expiresAt: string;
}

export interface ClaimReceipt {
  claimId: string;
  payoutAddress: string;
  rewardTokens: number;
  roundIds: string[];
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  settlementMode: "claim";
  backendSignature: string;
}

export interface ClaimSubmissionResponse {
  claimId: string;
  submissionId: string;
  txid: string;
  status: "submitted";
  provider: string;
  acceptedAt: string;
}

export interface ClaimPaymentResponse {
  claimId: string;
  claimReservationId: string;
  status: "payment_accepted" | "payment_rejected" | "reservation_expired";
  paymentTxid: string;
  provider: string;
  acceptedAt: string;
  nextPollAfterMs: number;
}

export interface MinerStatusResponse {
  minerId: string;
  registrationStatus: "registered";
  miningState: "idle" | "active";
  currentRoundId: string | null;
  lastSubmissionId: string | null;
  totalWins: number;
  totalRewards: number;
  claimableRewards: number;
}

export interface ClaimStatusResponse {
  claimId: string;
  status: "payment_pending" | "claimable" | "receipt_issued" | "submitted" | "expired";
  lastKnownTxid: string | null;
}