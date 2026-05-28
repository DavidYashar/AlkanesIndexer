import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  LocalConnectorStateSchema,
  type ClaimReceipt,
  type ClaimableReward,
  type LocalConnectorState,
  type MinerLocalStateRecord,
  type MinerStatusResponse,
  type Network,
  type RegistrationChallenge,
  type RegistrationCompleteResponse,
  type RegistrationProof,
  type SolutionResult
} from "./contracts.js";

function nowIso(): string {
  return new Date().toISOString();
}

function createDefaultState(): LocalConnectorState {
  return {
    currentMinerId: null,
    pendingRegistration: null,
    miners: {}
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class LocalStateStore {
  private cache: LocalConnectorState | null = null;

  constructor(private readonly stateDir: string) {}

  async getSnapshot(): Promise<LocalConnectorState> {
    return clone(await this.loadState());
  }

  async resolveMinerId(minerId?: string): Promise<string> {
    const state = await this.loadState();
    if (minerId) {
      return minerId;
    }

    if (state.currentMinerId) {
      return state.currentMinerId;
    }

    throw new Error("minerId is required until a miner is registered through this MCP connector.");
  }

  async getMinerRecord(minerId: string): Promise<MinerLocalStateRecord> {
    const state = await this.loadState();
    const miner = state.miners[minerId];
    if (!miner) {
      throw new Error(`Unknown local minerId: ${minerId}`);
    }

    return clone(miner);
  }

  async rememberChallenge(challenge: RegistrationChallenge): Promise<void> {
    await this.mutate((state) => {
      state.pendingRegistration = {
        registrationId: challenge.registrationId,
        requestedNetwork: challenge.network,
        expiresAt: challenge.expiresAt,
        domain: challenge.domain
      };
    });
  }

  async recordRegistration(result: RegistrationCompleteResponse, proof: RegistrationProof): Promise<MinerLocalStateRecord> {
    return this.mutate((state) => {
      const miner: MinerLocalStateRecord = {
        minerId: result.minerId,
        payoutAddress: result.payoutAddress,
        registrationStatus: result.registrationStatus,
        localState: "registered",
        currentRoundId: null,
        lastSubmissionId: null,
        claimableClaimIds: [],
        lastClaimReceiptId: null,
        lastKnownNetwork: proof.signedPayload.network,
        lastUpdatedAt: nowIso()
      };

      state.miners[result.minerId] = miner;
      state.currentMinerId = result.minerId;
      state.pendingRegistration = null;

      return clone(miner);
    });
  }

  async markMiningStarted(minerId: string): Promise<MinerLocalStateRecord> {
    return this.mutate((state) => {
      const miner = this.getOrCreateMiner(state, minerId);
      miner.localState = "active";
      miner.lastUpdatedAt = nowIso();
      state.currentMinerId = minerId;
      return clone(miner);
    });
  }

  async markMiningStopped(minerId: string): Promise<MinerLocalStateRecord> {
    return this.mutate((state) => {
      const miner = this.getOrCreateMiner(state, minerId);
      miner.localState = "idle";
      miner.currentRoundId = null;
      miner.lastUpdatedAt = nowIso();
      state.currentMinerId = minerId;
      return clone(miner);
    });
  }

  async rememberRound(minerId: string, roundId: string): Promise<MinerLocalStateRecord> {
    return this.mutate((state) => {
      const miner = this.getOrCreateMiner(state, minerId);
      miner.currentRoundId = roundId;
      if (miner.localState !== "claimable" && miner.localState !== "claim_pending") {
        miner.localState = "active";
      }
      miner.lastUpdatedAt = nowIso();
      state.currentMinerId = minerId;
      return clone(miner);
    });
  }

  async recordSolutionResult(minerId: string, result: SolutionResult): Promise<MinerLocalStateRecord> {
    return this.mutate((state) => {
      const miner = this.getOrCreateMiner(state, minerId);
      miner.currentRoundId = result.roundId;
      miner.lastSubmissionId = result.submissionId;
      miner.localState = result.claimable ? "claimable" : result.accepted ? "active" : "cooldown";
      miner.lastUpdatedAt = nowIso();
      state.currentMinerId = minerId;
      return clone(miner);
    });
  }

  async syncStatus(status: MinerStatusResponse): Promise<MinerLocalStateRecord> {
    return this.mutate((state) => {
      const miner = this.getOrCreateMiner(state, status.minerId);
      miner.registrationStatus = status.registrationStatus;
      miner.currentRoundId = status.currentRoundId;
      miner.lastSubmissionId = status.lastSubmissionId;
      miner.localState = status.claimableRewards > 0 ? "claimable" : status.miningState === "active" ? "active" : "idle";
      miner.lastUpdatedAt = nowIso();
      state.currentMinerId = status.minerId;
      return clone(miner);
    });
  }

  async recordClaimableRewards(minerId: string, rewards: ClaimableReward[]): Promise<MinerLocalStateRecord> {
    return this.mutate((state) => {
      const miner = this.getOrCreateMiner(state, minerId);
      miner.claimableClaimIds = rewards.filter((reward) => reward.status === "claimable").map((reward) => reward.claimId);
      if (miner.claimableClaimIds.length > 0) {
        miner.localState = "claimable";
      } else if (miner.localState === "claimable") {
        miner.localState = miner.currentRoundId ? "active" : "idle";
      }
      miner.lastUpdatedAt = nowIso();
      state.currentMinerId = minerId;
      return clone(miner);
    });
  }

  async recordClaimReceipt(minerId: string, receipt: ClaimReceipt): Promise<MinerLocalStateRecord> {
    return this.mutate((state) => {
      const miner = this.getOrCreateMiner(state, minerId);
      miner.lastClaimReceiptId = receipt.claimId;
      miner.claimableClaimIds = [];
      miner.localState = "claim_pending";
      miner.lastUpdatedAt = nowIso();
      state.currentMinerId = minerId;
      return clone(miner);
    });
  }

  private getOrCreateMiner(state: LocalConnectorState, minerId: string, network: Network = "mainnet"): MinerLocalStateRecord {
    const existing = state.miners[minerId];
    if (existing) {
      return existing;
    }

    const miner: MinerLocalStateRecord = {
      minerId,
      payoutAddress: "",
      registrationStatus: "unknown",
      localState: "unregistered",
      currentRoundId: null,
      lastSubmissionId: null,
      claimableClaimIds: [],
      lastClaimReceiptId: null,
      lastKnownNetwork: network,
      lastUpdatedAt: nowIso()
    };
    state.miners[minerId] = miner;
    return miner;
  }

  private async loadState(): Promise<LocalConnectorState> {
    if (this.cache) {
      return this.cache;
    }

    await mkdir(this.stateDir, { recursive: true });
    const stateFilePath = this.getStateFilePath();

    try {
      const raw = await readFile(stateFilePath, "utf8");
      this.cache = LocalConnectorStateSchema.parse(JSON.parse(raw));
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ENOENT") {
        throw error;
      }
      this.cache = createDefaultState();
      await this.persist(this.cache);
    }

    return this.cache;
  }

  private async mutate<T>(mutator: (state: LocalConnectorState) => T | Promise<T>): Promise<T> {
    const state = await this.loadState();
    const result = await mutator(state);
    await this.persist(state);
    return result;
  }

  private async persist(state: LocalConnectorState): Promise<void> {
    await mkdir(this.stateDir, { recursive: true });
    await writeFile(this.getStateFilePath(), JSON.stringify(state, null, 2), "utf8");
  }

  private getStateFilePath(): string {
    return path.join(this.stateDir, "state.json");
  }
}