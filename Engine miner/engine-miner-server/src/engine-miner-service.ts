import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createBitcoinProviderRouter, type BitcoinProviderLookupHints, type BitcoinProviderRouter } from "./bitcoin-provider.js";
import { submitSignedClaimToProvider } from "./claim-submission-provider.js";
import { signClaimReceipt } from "./claim-receipt-signing.js";
import { verifyRegistrationProof } from "./registration-verification.js";
import { PREPARED_CLAIM_TAG, deriveWalletAddress, verifyTaggedSchnorrSignature } from "./taproot-verification.js";
import type { EngineMinerServerConfig } from "./config.js";
import type {
  ClaimPaymentResponse,
  ClaimPaymentSubmission,
  ClaimReceipt,
  ClaimRequest,
  ClaimSubmissionResponse,
  ClaimStatusResponse,
  ClaimableReward,
  MinerStatusResponse,
  MiningStartRequest,
  RegistrationChallenge,
  RegistrationChallengeRequest,
  RegistrationProof,
  RoundDescriptor,
  SignedClaim,
  SolutionResult,
  SolutionSubmission
} from "./contracts.js";

type Network = EngineMinerServerConfig["defaultNetwork"];
type AddressType = "p2tr" | "p2wpkh";
type CandidateStatus = "queued" | "underfunded" | "reservation_active" | "payment_rejected" | "timed_out" | "paid";

interface StoredChallenge extends RegistrationChallengeRequest, RegistrationChallenge {
  used: boolean;
}

interface MinerRecord {
  minerId: string;
  agentId: string;
  payoutAddress: string;
  fundingAddress: string;
  addressType: AddressType;
  network: Network;
  publicKey: string;
  internalPubkey: string;
  derivationPath: string;
  registrationStatus: "registered";
  registeredAt: string;
  attestationLevel: string;
  policyVersion: string;
  miningState: "idle" | "active";
  totalWins: number;
  totalRewards: number;
  currentRoundId: string | null;
  lastSubmissionId: string | null;
}

interface RoundTemplate {
  category: string;
  parameters: Record<string, unknown>;
  expectedAnswer: Record<string, unknown>;
}

interface ActiveRound extends RoundDescriptor {
  expectedAnswer: Record<string, unknown>;
  winnerMinerId: string | null;
  winnerSubmissionId: string | null;
  attemptedMinerIds: string[];
  candidates: CandidateRecord[];
  currentReservationId: string | null;
}

interface CandidateRecord {
  minerId: string;
  submissionId: string;
  serverReceivedAt: string;
  status: CandidateStatus;
  fundingBalanceSats: number | null;
  fundingProvider: string | null;
  claimId: string | null;
  claimReservationId: string | null;
  paymentDeadlineAt: string | null;
}

interface RewardRecord extends ClaimableReward {
  minerId: string;
  paymentAcceptedAt: string | null;
  paymentProvider: string | null;
}

interface ClaimReceiptRecord extends ClaimReceipt {
  status: "claimable" | "receipt_issued" | "submitted";
  lastKnownTxid: string | null;
}

interface ClaimSubmissionRecord extends ClaimSubmissionResponse {
  signedClaimDigestHex: string;
}

interface FundingEligibilityResult {
  eligible: boolean;
  balanceSats: number;
  provider: string;
}

interface PaymentValidationResult {
  accepted: boolean;
  provider: string;
}

const ROUND_REWARD_TOKENS = 1000;

const ROUND_TEMPLATES: RoundTemplate[] = [
  {
    category: "symbolic-equations",
    parameters: {
      prompt: "Solve for x: 4x - 5 = 19",
      answerShape: { x: "integer" }
    },
    expectedAnswer: { x: 6 }
  },
  {
    category: "number-theory",
    parameters: {
      prompt: "Find the smallest prime p such that 40 <= p <= 60 and p mod 7 = 5.",
      answerShape: { p: "integer" }
    },
    expectedAnswer: { p: 47 }
  },
  {
    category: "sequence-pattern",
    parameters: {
      prompt: "Sequence: 3, 6, 11, 18, 27. Return the next term as n6.",
      answerShape: { n6: "integer" }
    },
    expectedAnswer: { n6: 38 }
  }
];

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function toIsoString(date: Date): string {
  return date.toISOString();
}

function isExpired(isoTimestamp: string): boolean {
  return Date.parse(isoTimestamp) <= Date.now();
}

export class EngineMinerService {
  private readonly challenges = new Map<string, StoredChallenge>();
  private readonly miners = new Map<string, MinerRecord>();
  private readonly rewards = new Map<string, RewardRecord>();
  private readonly rewardReservations = new Map<string, string>();
  private readonly claimReceipts = new Map<string, ClaimReceiptRecord>();
  private readonly claimSubmissions = new Map<string, ClaimSubmissionRecord>();
  private readonly bitcoinProvider: BitcoinProviderRouter;
  private roundCounter = 0;
  private activeRound: ActiveRound | null = null;

  constructor(private readonly config: EngineMinerServerConfig) {
    this.bitcoinProvider = createBitcoinProviderRouter(config);
  }

  issueRegistrationChallenge(input: RegistrationChallengeRequest): RegistrationChallenge {
    const registrationId = createId("reg");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const domain = new URL(this.config.publicBaseUrl).hostname;
    const challenge: StoredChallenge = {
      ...input,
      registrationId,
      challenge: createId("challenge"),
      expiresAt: toIsoString(expiresAt),
      domain,
      network: input.requestedNetwork,
      used: false
    };

    this.challenges.set(registrationId, challenge);
    return {
      registrationId: challenge.registrationId,
      challenge: challenge.challenge,
      expiresAt: challenge.expiresAt,
      domain: challenge.domain,
      network: challenge.network
    };
  }

  completeRegistration(input: RegistrationProof): {
    minerId: string;
    registrationStatus: "registered";
    payoutAddress: string;
    fundingAddress: string;
    addressType: AddressType;
    registeredAt: string;
  } {
    const challenge = this.challenges.get(input.registrationId);
    if (!challenge) {
      throw new Error("Unknown registrationId.");
    }

    if (challenge.used) {
      throw new Error("Registration challenge has already been used.");
    }

    if (isExpired(challenge.expiresAt)) {
      throw new Error("Registration challenge has expired.");
    }

    if (input.signedPayload.challenge !== challenge.challenge) {
      throw new Error("Registration proof challenge does not match the issued challenge.");
    }

    if (input.signedPayload.expiresAt !== challenge.expiresAt) {
      throw new Error("Registration proof expiry does not match the issued challenge.");
    }

    if (input.signedPayload.domain !== challenge.domain) {
      throw new Error("Registration proof domain does not match the issued challenge.");
    }

    if (input.signedPayload.network !== challenge.network) {
      throw new Error("Registration proof network does not match the issued challenge.");
    }

    if (input.signedPayload.address !== input.payoutAddress) {
      throw new Error("Registration proof address does not match payoutAddress.");
    }

    verifyRegistrationProof(input);

    challenge.used = true;

    const minerId = createId("miner");
    const registeredAt = toIsoString(new Date());
    this.miners.set(minerId, {
      minerId,
      agentId: challenge.agentId,
      payoutAddress: input.payoutAddress,
      fundingAddress: input.fundingAddress,
      addressType: input.addressType,
      network: input.signedPayload.network,
      publicKey: input.publicKey,
      internalPubkey: input.internalPubkey,
      derivationPath: input.derivationPath,
      registrationStatus: "registered",
      registeredAt,
      attestationLevel: "self-asserted",
      policyVersion: "v1",
      miningState: "idle",
      totalWins: 0,
      totalRewards: 0,
      currentRoundId: null,
      lastSubmissionId: null
    });

    return {
      minerId,
      registrationStatus: "registered",
      payoutAddress: input.payoutAddress,
      fundingAddress: input.fundingAddress,
      addressType: input.addressType,
      registeredAt
    };
  }

  async startMining(input: MiningStartRequest): Promise<{ accepted: true; miningState: "active"; pollAfterMs: number }> {
    const miner = this.getMiner(input.minerId);
    miner.miningState = "active";
    miner.currentRoundId = (await this.ensureActiveRound()).roundId;
    return {
      accepted: true,
      miningState: "active",
      pollAfterMs: 500
    };
  }

  stopMining(minerId: string): { accepted: true; miningState: "idle" } {
    const miner = this.getMiner(minerId);
    miner.miningState = "idle";
    miner.currentRoundId = null;
    return {
      accepted: true,
      miningState: "idle"
    };
  }

  async getCurrentRound(minerId: string): Promise<RoundDescriptor> {
    const miner = this.getMiner(minerId);
    const round = await this.ensureActiveRound();
    miner.currentRoundId = round.roundId;
    return this.toRoundDescriptor(round);
  }

  async submitSolution(input: SolutionSubmission): Promise<SolutionResult> {
    const miner = this.getMiner(input.minerId);
    const round = await this.ensureActiveRound();
    miner.currentRoundId = round.roundId;

    if (input.roundId !== round.roundId) {
      return {
        submissionId: createId("sub"),
        roundId: input.roundId,
        accepted: false,
        verificationStatus: "round_mismatch",
        winner: false,
        rewardTokens: 0,
        claimable: false,
        nextPollAfterMs: 500
      };
    }

    if (isExpired(round.expiresAt)) {
      await this.reconcileActiveRoundState();
      return {
        submissionId: createId("sub"),
        roundId: input.roundId,
        accepted: false,
        verificationStatus: "round_expired",
        winner: false,
        rewardTokens: 0,
        claimable: false,
        nextPollAfterMs: 500
      };
    }

    if (round.winnerMinerId) {
      return {
        submissionId: createId("sub"),
        roundId: input.roundId,
        accepted: false,
        verificationStatus: "round_closed",
        winner: false,
        rewardTokens: 0,
        claimable: false,
        nextPollAfterMs: 500
      };
    }

    if (round.attemptedMinerIds.includes(miner.minerId)) {
      return {
        submissionId: createId("sub"),
        roundId: input.roundId,
        accepted: false,
        verificationStatus: "attempt_limit_reached",
        winner: false,
        rewardTokens: 0,
        claimable: false,
        nextPollAfterMs: 500
      };
    }

    const submissionId = createId("sub");
    const serverReceivedAt = toIsoString(new Date());
    miner.lastSubmissionId = submissionId;
    round.attemptedMinerIds.push(miner.minerId);

    if (!isDeepStrictEqual(input.answer, round.expectedAnswer)) {
      return {
        submissionId,
        roundId: input.roundId,
        accepted: false,
        verificationStatus: "invalid",
        winner: false,
        rewardTokens: 0,
        claimable: false,
        nextPollAfterMs: 500
      };
    }

    round.candidates.push({
      minerId: miner.minerId,
      submissionId,
      serverReceivedAt,
      status: "queued",
      fundingBalanceSats: null,
      fundingProvider: null,
      claimId: null,
      claimReservationId: null,
      paymentDeadlineAt: null
    });

    await this.reconcileActiveRoundState();

    const candidate = this.getCandidate(round, submissionId);
    const reward = candidate.claimId ? this.rewards.get(candidate.claimId) ?? null : null;

    return {
      submissionId,
      roundId: round.roundId,
      accepted: true,
      verificationStatus: "valid",
      winner: candidate.status === "reservation_active" || candidate.status === "paid",
      winnerStatus: this.mapCandidateStatusToWinnerStatus(candidate.status),
      claimReservationId: candidate.claimReservationId,
      queuePosition: this.getQueuePosition(round, submissionId),
      serverReceivedAt,
      paymentDeadlineAt: reward?.paymentDeadlineAt ?? candidate.paymentDeadlineAt,
      rewardTokens: candidate.status === "reservation_active" || candidate.status === "paid" ? ROUND_REWARD_TOKENS : 0,
      claimable: false,
      nextPollAfterMs: candidate.status === "reservation_active" ? 1000 : 500
    };
  }

  async getMinerStatus(minerId: string): Promise<MinerStatusResponse> {
    await this.reconcileActiveRoundState();
    const miner = this.getMiner(minerId);
    const claimableRewards = Array.from(this.rewards.values())
      .filter((reward) => reward.minerId === minerId && reward.status === "claimable")
      .reduce((total, reward) => total + reward.rewardTokens, 0);

    return {
      minerId: miner.minerId,
      registrationStatus: miner.registrationStatus,
      miningState: miner.miningState,
      currentRoundId: miner.currentRoundId,
      lastSubmissionId: miner.lastSubmissionId,
      totalWins: miner.totalWins,
      totalRewards: miner.totalRewards,
      claimableRewards
    };
  }

  async listClaimableRewards(minerId: string): Promise<{ minerId: string; rewards: ClaimableReward[] }> {
    await this.reconcileActiveRoundState();
    this.getMiner(minerId);
    return {
      minerId,
      rewards: Array.from(this.rewards.values())
        .filter((reward) => reward.minerId === minerId)
        .map(({ minerId: _minerId, paymentAcceptedAt: _paymentAcceptedAt, paymentProvider: _paymentProvider, ...reward }) => reward)
    };
  }

  async requestClaimReceipt(input: ClaimRequest): Promise<ClaimReceipt> {
    await this.reconcileActiveRoundState();
    const miner = this.getMiner(input.minerId);
    const rewards = input.claimIds.map((claimId) => {
      const reward = this.rewards.get(claimId);
      if (!reward || reward.minerId !== input.minerId) {
        throw new Error(`Claimable reward not found for claimId: ${claimId}`);
      }

      if (reward.status !== "claimable") {
        throw new Error(`Claimable reward ${claimId} is not ready for receipt issuance.`);
      }

      return reward;
    });

    const claimId = createId("claimset");
    const rewardTokens = rewards.reduce((total, reward) => total + reward.rewardTokens, 0);
    const issuedAt = toIsoString(new Date());
    const expiresAt = toIsoString(new Date(Date.now() + 48 * 60 * 60 * 1000));
    const signedReceipt = signClaimReceipt({
      claimId,
      payoutAddress: miner.payoutAddress,
      rewardTokens,
      roundIds: rewards.map((reward) => reward.roundId),
      nonce: createId("nonce"),
      issuedAt,
      expiresAt,
      settlementMode: "claim"
    });
    const receipt: ClaimReceiptRecord = {
      ...signedReceipt,
      status: "receipt_issued",
      lastKnownTxid: null
    };

    for (const reward of rewards) {
      reward.status = "receipt_issued";
    }

    this.claimReceipts.set(claimId, receipt);

    return signedReceipt;
  }

  async submitClaimPayment(claimReservationId: string, input: ClaimPaymentSubmission): Promise<ClaimPaymentResponse> {
    await this.reconcileActiveRoundState();

    const reward = this.getRewardByReservationId(claimReservationId);
    if (!reward) {
      throw new Error(`Unknown claimReservationId: ${claimReservationId}`);
    }

    if (reward.minerId !== input.minerId) {
      throw new Error("Claim reservation does not belong to the submitting miner.");
    }

    const miner = this.getMiner(input.minerId);
    if (input.network && input.network !== miner.network) {
      throw new Error("Claim payment network does not match the registered miner network.");
    }

    if (input.feePayment.fundingAddress !== miner.fundingAddress) {
      throw new Error("Claim fee payment fundingAddress does not match the registered miner fundingAddress.");
    }

    if (input.feePayment.addressType !== miner.addressType) {
      throw new Error("Claim fee payment addressType does not match the registered miner addressType.");
    }

    if (reward.status === "claimable" || reward.status === "receipt_issued" || reward.status === "submitted") {
      return {
        claimId: reward.claimId,
        claimReservationId,
        status: "payment_accepted",
        paymentTxid: reward.paymentTxid || input.feePayment.txid,
        provider: reward.paymentProvider || "engine-miner-local-dev",
        acceptedAt: reward.paymentAcceptedAt || toIsoString(new Date()),
        nextPollAfterMs: 500
      };
    }

    if (reward.status === "expired") {
      return {
        claimId: reward.claimId,
        claimReservationId,
        status: "reservation_expired",
        paymentTxid: input.feePayment.txid,
        provider: input.feePayment.provider || "engine-miner-server",
        acceptedAt: toIsoString(new Date()),
        nextPollAfterMs: 500
      };
    }

    const round = this.activeRound && this.activeRound.roundId === reward.roundId ? this.activeRound : null;
    if (!round) {
      throw new Error(`Claim reservation ${claimReservationId} is no longer active.`);
    }

    if (reward.paymentDeadlineAt && isExpired(reward.paymentDeadlineAt)) {
      this.expireReservation(round, reward, "timed_out");
      await this.reconcileActiveRoundState();
      return {
        claimId: reward.claimId,
        claimReservationId,
        status: "reservation_expired",
        paymentTxid: input.feePayment.txid,
        provider: input.feePayment.provider || "engine-miner-server",
        acceptedAt: toIsoString(new Date()),
        nextPollAfterMs: 500
      };
    }

    const validation = await this.validateClaimPayment(miner, input);
    if (!validation.accepted) {
      this.expireReservation(round, reward, "payment_rejected");
      await this.reconcileActiveRoundState();
      return {
        claimId: reward.claimId,
        claimReservationId,
        status: "payment_rejected",
        paymentTxid: input.feePayment.txid,
        provider: validation.provider,
        acceptedAt: toIsoString(new Date()),
        nextPollAfterMs: 500
      };
    }

    const acceptedAt = toIsoString(new Date());
    reward.status = "claimable";
    reward.paymentTxid = input.feePayment.txid;
    reward.paymentAcceptedAt = acceptedAt;
    reward.paymentProvider = validation.provider;

    const candidate = this.findCandidateByReservationId(round, claimReservationId);
    if (candidate) {
      candidate.status = "paid";
    }

    round.winnerMinerId = miner.minerId;
    round.winnerSubmissionId = candidate?.submissionId || miner.lastSubmissionId;
    round.currentReservationId = null;
    miner.totalWins += 1;
    miner.totalRewards += ROUND_REWARD_TOKENS;
    this.activeRound = null;

    return {
      claimId: reward.claimId,
      claimReservationId,
      status: "payment_accepted",
      paymentTxid: input.feePayment.txid,
      provider: validation.provider,
      acceptedAt,
      nextPollAfterMs: 500
    };
  }

  getClaimStatus(claimId: string): ClaimStatusResponse {
    const claimReceipt = this.claimReceipts.get(claimId);
    if (claimReceipt) {
      return {
        claimId,
        status: claimReceipt.status,
        lastKnownTxid: claimReceipt.lastKnownTxid
      };
    }

    const reward = this.rewards.get(claimId);
    if (!reward) {
      throw new Error(`Unknown claimId: ${claimId}`);
    }

    return {
      claimId,
      status: reward.status,
      lastKnownTxid: reward.paymentTxid || null
    };
  }

  async submitClaim(signedClaim: SignedClaim): Promise<ClaimSubmissionResponse> {
    this.assertSignedClaimIsValid(signedClaim);

    const existingSubmission = this.claimSubmissions.get(signedClaim.claimId);
    if (existingSubmission) {
      return {
        claimId: existingSubmission.claimId,
        submissionId: existingSubmission.submissionId,
        txid: existingSubmission.txid,
        status: existingSubmission.status,
        provider: existingSubmission.provider,
        acceptedAt: existingSubmission.acceptedAt
      };
    }

    const providerResult = await submitSignedClaimToProvider(this.config, signedClaim);
    const submission: ClaimSubmissionRecord = {
      claimId: signedClaim.claimId,
      submissionId: providerResult.submissionId,
      txid: providerResult.txid,
      status: "submitted",
      provider: providerResult.provider,
      acceptedAt: providerResult.acceptedAt,
      signedClaimDigestHex: signedClaim.walletSignature.digestHex
    };

    this.claimSubmissions.set(signedClaim.claimId, submission);

    const claimReceipt = this.claimReceipts.get(signedClaim.claimId);
    if (claimReceipt) {
      claimReceipt.status = "submitted";
      claimReceipt.lastKnownTxid = submission.txid;
    }

    return {
      claimId: submission.claimId,
      submissionId: submission.submissionId,
      txid: submission.txid,
      status: submission.status,
      provider: submission.provider,
      acceptedAt: submission.acceptedAt
    };
  }

  private getMiner(minerId: string): MinerRecord {
    const miner = this.miners.get(minerId);
    if (!miner) {
      throw new Error(`Unknown minerId: ${minerId}`);
    }
    return miner;
  }

  private getCandidate(round: ActiveRound, submissionId: string): CandidateRecord {
    const candidate = round.candidates.find((entry) => entry.submissionId === submissionId);
    if (!candidate) {
      throw new Error(`Unknown submissionId for round candidate: ${submissionId}`);
    }
    return candidate;
  }

  private getQueuePosition(round: ActiveRound, submissionId: string): number {
    return round.candidates.findIndex((entry) => entry.submissionId === submissionId) + 1;
  }

  private mapCandidateStatusToWinnerStatus(status: CandidateStatus): string {
    switch (status) {
      case "reservation_active":
        return "provisional_winner";
      case "paid":
        return "winner_paid";
      case "underfunded":
        return "underfunded";
      case "payment_rejected":
        return "payment_rejected";
      case "timed_out":
        return "timed_out";
      default:
        return "queued";
    }
  }

  private getRewardByReservationId(claimReservationId: string): RewardRecord | null {
    const claimId = this.rewardReservations.get(claimReservationId);
    if (!claimId) {
      return null;
    }
    return this.rewards.get(claimId) ?? null;
  }

  private findCandidateByReservationId(round: ActiveRound, claimReservationId: string): CandidateRecord | null {
    return round.candidates.find((candidate) => candidate.claimReservationId === claimReservationId) ?? null;
  }

  private buildBitcoinProviderHints(providerHints?: ClaimPaymentSubmission["providerHints"]): BitcoinProviderLookupHints | undefined {
    const preferredProviders = [providerHints?.bitcoinPrimary, providerHints?.bitcoinFallback].filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0
    );

    if (preferredProviders.length === 0) {
      return undefined;
    }

    return { preferredProviders };
  }

  private async checkFundingEligibility(
    miner: MinerRecord,
    providerHints?: ClaimPaymentSubmission["providerHints"]
  ): Promise<FundingEligibilityResult> {
    const balance = await this.bitcoinProvider.getAddressSpendableBalance({
      network: miner.network,
      address: miner.fundingAddress,
      hints: this.buildBitcoinProviderHints(providerHints)
    });

    return {
      eligible: balance.balanceSats >= this.config.requiredClaimFeeSats,
      balanceSats: balance.balanceSats,
      provider: balance.provider
    };
  }

  private async validateClaimPayment(miner: MinerRecord, input: ClaimPaymentSubmission): Promise<PaymentValidationResult> {
    const transactionLookup = await this.bitcoinProvider.getTransaction({
      network: input.network || miner.network,
      txid: input.feePayment.txid,
      hints: this.buildBitcoinProviderHints(input.providerHints)
    });

    if (transactionLookup.provider === "local-dev") {
      return {
        accepted: true,
        provider: transactionLookup.provider
      };
    }

    if (!transactionLookup.transaction) {
      return {
        accepted: false,
        provider: transactionLookup.provider
      };
    }

    if (!this.config.claimFeeTreasuryAddress) {
      throw new Error("ENGINE_MINER_CLAIM_FEE_TREASURY_ADDRESS must be configured for provider-backed payment validation.");
    }

    const hasRequiredTreasuryOutput = transactionLookup.transaction.outputs.some(
      (output) => output.addresses.includes(this.config.claimFeeTreasuryAddress as string) && output.valueSats >= this.config.requiredClaimFeeSats
    );

    return {
      accepted: hasRequiredTreasuryOutput,
      provider: transactionLookup.provider
    };
  }

  private expireReservation(round: ActiveRound, reward: RewardRecord, nextStatus: Extract<CandidateStatus, "timed_out" | "payment_rejected">): void {
    reward.status = "expired";
    round.currentReservationId = null;

    const candidate = reward.claimReservationId ? this.findCandidateByReservationId(round, reward.claimReservationId) : null;
    if (candidate) {
      candidate.status = nextStatus;
    }
  }

  private async promoteNextEligibleCandidate(round: ActiveRound): Promise<void> {
    if (round.currentReservationId || round.winnerMinerId) {
      return;
    }

    for (const candidate of round.candidates) {
      if (candidate.status !== "queued") {
        continue;
      }

      const miner = this.getMiner(candidate.minerId);
      const fundingCheck = await this.checkFundingEligibility(miner);
      candidate.fundingBalanceSats = fundingCheck.balanceSats;
      candidate.fundingProvider = fundingCheck.provider;

      if (!fundingCheck.eligible) {
        candidate.status = "underfunded";
        continue;
      }

      const claimId = createId("clm");
      const claimReservationId = createId("reservation");
      const paymentDeadlineAt = toIsoString(new Date(Date.now() + this.config.claimPaymentWindowMs));

      candidate.status = "reservation_active";
      candidate.claimId = claimId;
      candidate.claimReservationId = claimReservationId;
      candidate.paymentDeadlineAt = paymentDeadlineAt;

      const reward: RewardRecord = {
        claimId,
        claimReservationId,
        roundId: round.roundId,
        payoutAddress: miner.payoutAddress,
        rewardTokens: ROUND_REWARD_TOKENS,
        status: "payment_pending",
        paymentDeadlineAt,
        paymentTxid: null,
        expiresAt: toIsoString(new Date(Date.now() + 48 * 60 * 60 * 1000)),
        minerId: miner.minerId,
        paymentAcceptedAt: null,
        paymentProvider: fundingCheck.provider
      };

      this.rewards.set(claimId, reward);
      this.rewardReservations.set(claimReservationId, claimId);
      round.currentReservationId = claimReservationId;
      return;
    }
  }

  private async reconcileActiveRoundState(): Promise<void> {
    const round = this.activeRound;
    if (!round) {
      return;
    }

    if (round.currentReservationId) {
      const reward = this.getRewardByReservationId(round.currentReservationId);
      if (!reward || reward.status !== "payment_pending") {
        round.currentReservationId = null;
      } else if (reward.paymentDeadlineAt && isExpired(reward.paymentDeadlineAt)) {
        this.expireReservation(round, reward, "timed_out");
      }
    }

    if (!round.currentReservationId && round.winnerMinerId === null) {
      await this.promoteNextEligibleCandidate(round);
    }

    const hasQueuedCandidates = round.candidates.some((candidate) => candidate.status === "queued");
    if (round.winnerMinerId !== null || (isExpired(round.expiresAt) && !round.currentReservationId && !hasQueuedCandidates)) {
      this.activeRound = null;
    }
  }

  private assertSignedClaimIsValid(signedClaim: SignedClaim): void {
    if (signedClaim.claimId !== signedClaim.preparedClaim.claimId) {
      throw new Error("Signed claim claimId does not match the prepared claim claimId.");
    }

    if (signedClaim.claimId !== signedClaim.preparedClaim.claimReceipt.claimId) {
      throw new Error("Signed claim claimId does not match the embedded claim receipt claimId.");
    }

    const claimReceipt = this.claimReceipts.get(signedClaim.claimId);
    if (!claimReceipt) {
      throw new Error(`Unknown claimId: ${signedClaim.claimId}`);
    }

    if (claimReceipt.status === "submitted") {
      return;
    }

    if (claimReceipt.status !== "receipt_issued") {
      throw new Error(`Claim ${signedClaim.claimId} is not ready for submission.`);
    }

    if (JSON.stringify(this.toCanonicalClaimReceipt(claimReceipt)) !== JSON.stringify(this.toCanonicalClaimReceipt(signedClaim.preparedClaim.claimReceipt))) {
      throw new Error("Signed claim receipt does not match the backend-issued claim receipt.");
    }

    const preparedClaimPayload = this.toCanonicalPreparedClaimSigningPayload(signedClaim.preparedClaim);
    const walletSignatureCheck = verifyTaggedSchnorrSignature({
      tag: PREPARED_CLAIM_TAG,
      payloadJson: JSON.stringify(preparedClaimPayload),
      publicKeyHex: signedClaim.walletSignature.publicKey,
      signatureHex: signedClaim.walletSignature.signature
    });

    if (!walletSignatureCheck.verified) {
      throw new Error("Signed claim wallet signature verification failed.");
    }

    if (walletSignatureCheck.digestHex !== signedClaim.walletSignature.digestHex) {
      throw new Error("Signed claim wallet signature digest does not match the signed payload digest.");
    }

    if (walletSignatureCheck.digestHex !== signedClaim.preparedClaim.preparedClaimDigestHex) {
      throw new Error("Prepared claim digest does not match the signed wallet digest.");
    }

    if (signedClaim.walletSignature.internalPubkey !== signedClaim.preparedClaim.wallet.internalPubkey) {
      throw new Error("Signed claim internalPubkey does not match the prepared claim wallet record.");
    }

    const walletDerivedAddress = deriveWalletAddress({
      networkName: signedClaim.preparedClaim.wallet.network,
      addressType: signedClaim.preparedClaim.wallet.addressType,
      publicKeyHex: signedClaim.walletSignature.publicKey,
      internalPubkeyHex: signedClaim.preparedClaim.wallet.internalPubkey
    });

    if (walletDerivedAddress !== signedClaim.walletSignature.address) {
      throw new Error("Signed claim wallet signature address does not match the wallet address derived from the signing key.");
    }

    if (walletDerivedAddress !== claimReceipt.payoutAddress) {
      throw new Error("Signed claim payout address does not match the backend-issued claim receipt payout address.");
    }

    if (walletDerivedAddress !== signedClaim.preparedClaim.wallet.payoutAddress) {
      throw new Error("Prepared claim wallet payout address does not match the signing key address.");
    }
  }

  private toCanonicalClaimReceipt(claimReceipt: ClaimReceipt): ClaimReceipt {
    return {
      claimId: claimReceipt.claimId,
      payoutAddress: claimReceipt.payoutAddress,
      rewardTokens: claimReceipt.rewardTokens,
      roundIds: claimReceipt.roundIds,
      nonce: claimReceipt.nonce,
      issuedAt: claimReceipt.issuedAt,
      expiresAt: claimReceipt.expiresAt,
      settlementMode: claimReceipt.settlementMode,
      backendSignature: claimReceipt.backendSignature
    };
  }

  private toCanonicalPreparedClaimSigningPayload(preparedClaim: SignedClaim["preparedClaim"]): Omit<SignedClaim["preparedClaim"], "preparedClaimDigestHex"> {
    return {
      schema: preparedClaim.schema,
      claimId: preparedClaim.claimId,
      preparedAt: preparedClaim.preparedAt,
      claimReceipt: this.toCanonicalClaimReceipt(preparedClaim.claimReceipt),
      wallet: {
        network: preparedClaim.wallet.network,
        addressType: preparedClaim.wallet.addressType,
        payoutAddress: preparedClaim.wallet.payoutAddress,
        fundingAddress: preparedClaim.wallet.fundingAddress,
        derivationPath: preparedClaim.wallet.derivationPath,
        publicKey: preparedClaim.wallet.publicKey,
        internalPubkey: preparedClaim.wallet.internalPubkey,
        masterFingerprint: preparedClaim.wallet.masterFingerprint
      },
      policy: {
        policyMode: preparedClaim.policy.policyMode,
        requireBroadcastConfirmation: preparedClaim.policy.requireBroadcastConfirmation,
        maxFeeSats: preparedClaim.policy.maxFeeSats
      },
      backendVerification: {
        verified: preparedClaim.backendVerification.verified,
        algorithm: preparedClaim.backendVerification.algorithm,
        signerKeyId: preparedClaim.backendVerification.signerKeyId,
        trustedKeySource: preparedClaim.backendVerification.trustedKeySource,
        receiptPayloadHash: preparedClaim.backendVerification.receiptPayloadHash
      },
      settlement: {
        mode: preparedClaim.settlement.mode,
        engineMinerApiConfigured: preparedClaim.settlement.engineMinerApiConfigured,
        alkanesProviderConfigured: preparedClaim.settlement.alkanesProviderConfigured,
        broadcastStrategy: preparedClaim.settlement.broadcastStrategy
      }
    };
  }

  private async ensureActiveRound(): Promise<ActiveRound> {
    await this.reconcileActiveRoundState();
    if (this.activeRound) {
      return this.activeRound;
    }

    this.roundCounter += 1;
    const template = ROUND_TEMPLATES[(this.roundCounter - 1) % ROUND_TEMPLATES.length];
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + this.config.roundDurationMs);
    this.activeRound = {
      roundId: createId("rnd"),
      roundNumber: this.roundCounter,
      category: template.category,
      difficulty: Number((10 + this.roundCounter * 0.1).toFixed(2)),
      parameters: template.parameters,
      createdAt: toIsoString(createdAt),
      expiresAt: toIsoString(expiresAt),
      rewardTokens: ROUND_REWARD_TOKENS,
      submissionRules: {
        maxAttempts: 1,
        answerFormat: "json",
        puzzleLifetimeMs: this.config.roundDurationMs,
        claimPaymentWindowMs: this.config.claimPaymentWindowMs,
        requiredClaimFeeSats: this.config.requiredClaimFeeSats,
        winnerSelectionMode: "fcfs_backend_received_at",
        fundingEligibilityRequired: true
      },
      expectedAnswer: template.expectedAnswer,
      winnerMinerId: null,
      winnerSubmissionId: null,
      attemptedMinerIds: [],
      candidates: [],
      currentReservationId: null
    };
    return this.activeRound;
  }

  private toRoundDescriptor(round: ActiveRound): RoundDescriptor {
    return {
      roundId: round.roundId,
      roundNumber: round.roundNumber,
      category: round.category,
      difficulty: round.difficulty,
      parameters: round.parameters,
      createdAt: round.createdAt,
      expiresAt: round.expiresAt,
      rewardTokens: round.rewardTokens,
      submissionRules: round.submissionRules
    };
  }
}