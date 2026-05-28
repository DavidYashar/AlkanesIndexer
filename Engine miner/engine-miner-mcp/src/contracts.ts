import { z } from "zod";

export const NetworkSchema = z.enum(["mainnet", "signet", "regtest"]);
export type Network = z.infer<typeof NetworkSchema>;

export const AddressTypeSchema = z.enum(["p2tr", "p2wpkh"]);
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

export const RegistrationChallengeSchema = z.object({
  registrationId: z.string().min(1),
  challenge: z.string().min(1),
  expiresAt: z.string().datetime(),
  domain: z.string().min(1),
  network: NetworkSchema
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

export const RegistrationCompleteResponseSchema = z.object({
  minerId: z.string().min(1),
  registrationStatus: z.literal("registered"),
  payoutAddress: z.string().min(1),
  fundingAddress: z.string().min(1),
  addressType: AddressTypeSchema,
  registeredAt: z.string().datetime()
});

export const RoundDescriptorSchema = z.object({
  roundId: z.string().min(1),
  roundNumber: z.number().int().positive(),
  category: z.string().min(1),
  difficulty: z.number(),
  parameters: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  rewardTokens: z.number().nonnegative(),
  submissionRules: z.object({
    maxAttempts: z.number().int().positive(),
    answerFormat: z.string().min(1),
    puzzleLifetimeMs: z.number().int().positive().optional(),
    claimPaymentWindowMs: z.number().int().positive().optional(),
    requiredClaimFeeSats: z.number().int().nonnegative().optional(),
    winnerSelectionMode: z.string().min(1).optional(),
    fundingEligibilityRequired: z.boolean().optional()
  })
});

export const SolutionResultSchema = z.object({
  submissionId: z.string().min(1),
  roundId: z.string().min(1),
  accepted: z.boolean(),
  verificationStatus: z.string().min(1),
  winner: z.boolean(),
  winnerStatus: z.string().min(1).optional(),
  claimReservationId: z.string().nullable().optional(),
  queuePosition: z.number().int().positive().optional(),
  serverReceivedAt: z.string().datetime().optional(),
  paymentDeadlineAt: z.string().datetime().nullable().optional(),
  rewardTokens: z.number().nonnegative(),
  claimable: z.boolean(),
  nextPollAfterMs: z.number().int().nonnegative()
});

export const MiningStateSchema = z.enum(["idle", "active"]);

export const MiningStartResponseSchema = z.object({
  accepted: z.literal(true),
  miningState: z.literal("active"),
  pollAfterMs: z.number().int().nonnegative()
});

export const MiningStopResponseSchema = z.object({
  accepted: z.literal(true),
  miningState: z.literal("idle")
});

export const ClaimableRewardSchema = z.object({
  claimId: z.string().min(1),
  claimReservationId: z.string().nullable(),
  roundId: z.string().min(1),
  payoutAddress: z.string().min(1),
  rewardTokens: z.number().nonnegative(),
  status: ClaimRewardStatusSchema,
  paymentDeadlineAt: z.string().datetime().nullable(),
  paymentTxid: z.string().nullable().optional(),
  expiresAt: z.string().datetime()
});

export const ClaimableRewardsResponseSchema = z.object({
  minerId: z.string().min(1),
  rewards: z.array(ClaimableRewardSchema)
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

export const MinerStatusResponseSchema = z.object({
  minerId: z.string().min(1),
  registrationStatus: z.literal("registered"),
  miningState: MiningStateSchema,
  currentRoundId: z.string().nullable(),
  lastSubmissionId: z.string().nullable(),
  totalWins: z.number().int().nonnegative(),
  totalRewards: z.number().nonnegative(),
  claimableRewards: z.number().nonnegative()
});

export const ClaimStatusResponseSchema = z.object({
  claimId: z.string().min(1),
  status: ClaimRewardStatusSchema,
  lastKnownTxid: z.string().nullable()
});

export const ClaimPaymentResponseSchema = z.object({
  claimId: z.string().min(1),
  claimReservationId: z.string().min(1),
  status: z.enum(["payment_accepted", "payment_rejected", "reservation_expired"]),
  paymentTxid: z.string().min(1),
  provider: z.string().min(1),
  acceptedAt: z.string().datetime(),
  nextPollAfterMs: z.number().int().nonnegative()
});

export const RegistrationChallengeToolInputSchema = z.object({
  agentId: z.string().min(1).optional(),
  agentName: z.string().min(1).optional(),
  agentRuntime: z.string().min(1).optional(),
  agentVersion: z.string().min(1).optional(),
  requestedNetwork: NetworkSchema.optional()
});

export const SubmitRegistrationToolInputSchema = z.object({
  proof: RegistrationProofSchema
});

export const StartMiningToolInputSchema = z.object({
  minerId: z.string().min(1).optional(),
  categories: z.array(z.string().min(1)).default([]),
  maxParallelRounds: z.number().int().positive().default(1)
});

export const StopMiningToolInputSchema = z.object({
  minerId: z.string().min(1).optional()
});

export const GetCurrentRoundToolInputSchema = z.object({
  minerId: z.string().min(1).optional()
});

export const SubmitSolutionToolInputSchema = z.object({
  minerId: z.string().min(1).optional(),
  roundId: z.string().min(1),
  answer: z.record(z.unknown()),
  reasoningCommitment: z.string().min(1).optional(),
  toolTraceHash: z.string().min(1).optional(),
  submittedAtClient: z.string().datetime().optional()
});

export const GetMiningStatusToolInputSchema = z.object({
  minerId: z.string().min(1).optional()
});

export const ListClaimableRewardsToolInputSchema = z.object({
  minerId: z.string().min(1).optional()
});

export const RequestClaimReceiptToolInputSchema = z.object({
  minerId: z.string().min(1).optional(),
  claimIds: z.array(z.string().min(1)).min(1)
});

export const SubmitClaimFeePaymentToolInputSchema = z.object({
  claimReservationId: z.string().min(1),
  minerId: z.string().min(1).optional(),
  fundingAddress: z.string().min(1),
  addressType: AddressTypeSchema,
  txid: z.string().min(1),
  rawTxHex: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  bitcoinPrimary: z.string().min(1).optional(),
  bitcoinFallback: z.string().min(1).optional(),
  alkanesPrimary: z.string().min(1).optional()
});

export const GetClaimStatusToolInputSchema = z.object({
  claimId: z.string().min(1)
});

export const MinerLifecycleStateSchema = z.enum([
  "unregistered",
  "registered",
  "idle",
  "active",
  "cooldown",
  "claimable",
  "claim_pending"
]);

export const PendingRegistrationSchema = z.object({
  registrationId: z.string().min(1),
  requestedNetwork: NetworkSchema,
  expiresAt: z.string().datetime(),
  domain: z.string().min(1)
});

export const MinerLocalStateRecordSchema = z.object({
  minerId: z.string().min(1),
  payoutAddress: z.string(),
  registrationStatus: z.enum(["registered", "unknown"]),
  localState: MinerLifecycleStateSchema,
  currentRoundId: z.string().nullable(),
  lastSubmissionId: z.string().nullable(),
  claimableClaimIds: z.array(z.string().min(1)),
  lastClaimReceiptId: z.string().nullable(),
  lastKnownNetwork: NetworkSchema,
  lastUpdatedAt: z.string().datetime()
});

export const LocalConnectorStateSchema = z.object({
  currentMinerId: z.string().nullable(),
  pendingRegistration: PendingRegistrationSchema.nullable(),
  miners: z.record(MinerLocalStateRecordSchema)
});

export type RegistrationChallenge = z.infer<typeof RegistrationChallengeSchema>;
export type RegistrationProof = z.infer<typeof RegistrationProofSchema>;
export type RegistrationCompleteResponse = z.infer<typeof RegistrationCompleteResponseSchema>;
export type RoundDescriptor = z.infer<typeof RoundDescriptorSchema>;
export type SolutionResult = z.infer<typeof SolutionResultSchema>;
export type ClaimableReward = z.infer<typeof ClaimableRewardSchema>;
export type ClaimReceipt = z.infer<typeof ClaimReceiptSchema>;
export type MinerStatusResponse = z.infer<typeof MinerStatusResponseSchema>;
export type ClaimStatusResponse = z.infer<typeof ClaimStatusResponseSchema>;
export type ClaimPaymentResponse = z.infer<typeof ClaimPaymentResponseSchema>;
export type MinerLifecycleState = z.infer<typeof MinerLifecycleStateSchema>;
export type MinerLocalStateRecord = z.infer<typeof MinerLocalStateRecordSchema>;
export type LocalConnectorState = z.infer<typeof LocalConnectorStateSchema>;