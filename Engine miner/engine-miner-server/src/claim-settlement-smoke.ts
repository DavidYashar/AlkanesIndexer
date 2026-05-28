import { createHash, randomBytes } from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { canonicalizeUnsignedClaimReceipt, getClaimReceiptSignerInfo } from "./claim-receipt-signing.js";
import { loadConfig, type EngineMinerServerConfig } from "./config.js";
import type { ClaimReceipt, RoundDescriptor, SignedClaim } from "./contracts.js";
import { EngineMinerService } from "./engine-miner-service.js";
import { PREPARED_CLAIM_TAG, REGISTRATION_TAG, deriveWalletAddress, taggedHash, toXOnly } from "./taproot-verification.js";

bitcoin.initEccLib(ecc);

interface LocalWallet {
  privateKey: Buffer;
  publicKeyHex: string;
  internalPubkeyHex: string;
  payoutAddress: string;
  fundingAddress: string;
  derivationPath: string;
  masterFingerprint: string;
  addressType: "p2tr";
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createRandomPrivateKey(): Buffer {
  while (true) {
    const candidate = randomBytes(32);
    if (ecc.isPrivate(candidate)) {
      return candidate;
    }
  }
}

function createLocalWallet(network: EngineMinerServerConfig["defaultNetwork"]): LocalWallet {
  const privateKey = createRandomPrivateKey();
  const publicKey = ecc.pointFromScalar(privateKey, true);
  if (!publicKey) {
    throw new Error("Failed to derive a public key from the generated private key.");
  }

  const publicKeyBuffer = Buffer.from(publicKey);
  const internalPubkeyBuffer = Buffer.from(toXOnly(publicKeyBuffer));
  const publicKeyHex = publicKeyBuffer.toString("hex");
  const internalPubkeyHex = internalPubkeyBuffer.toString("hex");
  const payoutAddress = deriveWalletAddress({
    networkName: network,
    addressType: "p2tr",
    publicKeyHex,
    internalPubkeyHex
  });

  return {
    privateKey,
    publicKeyHex,
    internalPubkeyHex,
    payoutAddress,
    fundingAddress: payoutAddress,
    derivationPath: "m/86'/1'/0'/0/0",
    masterFingerprint: Buffer.from(bitcoin.crypto.hash160(publicKeyBuffer).subarray(0, 4)).toString("hex"),
    addressType: "p2tr"
  };
}

function canonicalizeRegistrationPayload(payload: {
  challenge: string;
  expiresAt: string;
  domain: string;
  network: EngineMinerServerConfig["defaultNetwork"];
  address: string;
  fundingAddress: string;
  addressType: "p2tr";
  internalPubkey: string;
  derivationPath: string;
}): string {
  return JSON.stringify({
    scheme: "engine-miner-registration-v1",
    challenge: payload.challenge,
    expiresAt: payload.expiresAt,
    domain: payload.domain,
    network: payload.network,
    address: payload.address,
    fundingAddress: payload.fundingAddress,
    addressType: payload.addressType,
    internalPubkey: payload.internalPubkey,
    derivationPath: payload.derivationPath
  });
}

function signTaggedPayload(tag: string, payloadJson: string, privateKey: Buffer): { digestHex: string; signatureHex: string } {
  const digest = Buffer.from(taggedHash(tag, Buffer.from(payloadJson, "utf8")));
  const signature = Buffer.from(ecc.signSchnorr(digest, privateKey));
  return {
    digestHex: digest.toString("hex"),
    signatureHex: signature.toString("hex")
  };
}

function isPrime(value: number): boolean {
  if (value < 2) {
    return false;
  }

  for (let divisor = 2; divisor * divisor <= value; divisor += 1) {
    if (value % divisor === 0) {
      return false;
    }
  }

  return true;
}

function solveRound(round: RoundDescriptor): Record<string, unknown> {
  const prompt = round.parameters.prompt;
  if (typeof prompt !== "string") {
    throw new Error(`Round ${round.roundId} is missing a string prompt.`);
  }

  const symbolicEquation = prompt.match(/Solve for x:\s*(\d+)x\s*-\s*(\d+)\s*=\s*(\d+)/i);
  if (symbolicEquation) {
    const coefficient = Number.parseInt(symbolicEquation[1], 10);
    const subtrahend = Number.parseInt(symbolicEquation[2], 10);
    const result = Number.parseInt(symbolicEquation[3], 10);
    return { x: (result + subtrahend) / coefficient };
  }

  const primeConstraint = prompt.match(
    /Find the smallest prime p such that\s*(\d+)\s*<=\s*p\s*<=\s*(\d+)\s*and\s*p mod\s*(\d+)\s*=\s*(\d+)/i
  );
  if (primeConstraint) {
    const start = Number.parseInt(primeConstraint[1], 10);
    const end = Number.parseInt(primeConstraint[2], 10);
    const modulus = Number.parseInt(primeConstraint[3], 10);
    const remainder = Number.parseInt(primeConstraint[4], 10);

    for (let candidate = start; candidate <= end; candidate += 1) {
      if (candidate % modulus === remainder && isPrime(candidate)) {
        return { p: candidate };
      }
    }

    throw new Error(`No prime satisfied the prompt: ${prompt}`);
  }

  const sequencePrompt = prompt.match(/Sequence:\s*([0-9,\s]+)\.\s*Return the next term as\s*(\w+)/i);
  if (sequencePrompt) {
    const values = sequencePrompt[1]
      .split(",")
      .map((value) => Number.parseInt(value.trim(), 10));
    if (values.length < 3 || values.some((value) => Number.isNaN(value))) {
      throw new Error(`Unexpected sequence prompt: ${prompt}`);
    }

    const differences = values.slice(1).map((value, index) => value - values[index]);
    const secondDifferences = differences.slice(1).map((value, index) => value - differences[index]);
    if (secondDifferences.length === 0 || !secondDifferences.every((value) => value === secondDifferences[0])) {
      throw new Error(`Sequence prompt is not a constant-second-difference series: ${prompt}`);
    }

    const nextDifference = differences[differences.length - 1] + secondDifferences[0];
    return { [sequencePrompt[2]]: values[values.length - 1] + nextDifference };
  }

  throw new Error(`Unsupported round prompt: ${prompt}`);
}

function buildSignedClaim(
  config: EngineMinerServerConfig,
  claimReceipt: ClaimReceipt,
  wallet: LocalWallet
): SignedClaim {
  const { backendSignature: _backendSignature, ...unsignedClaimReceipt } = claimReceipt;
  const receiptPayloadHash = sha256Hex(canonicalizeUnsignedClaimReceipt(unsignedClaimReceipt));
  const signerInfo = getClaimReceiptSignerInfo();
  const preparedAt = new Date().toISOString();

  const preparedClaimWithoutDigest = {
    schema: "engine-miner-prepared-claim-v1" as const,
    claimId: claimReceipt.claimId,
    preparedAt,
    claimReceipt,
    wallet: {
      network: config.defaultNetwork,
      addressType: wallet.addressType,
      payoutAddress: wallet.payoutAddress,
      fundingAddress: wallet.fundingAddress,
      derivationPath: wallet.derivationPath,
      publicKey: wallet.publicKeyHex,
      internalPubkey: wallet.internalPubkeyHex,
      masterFingerprint: wallet.masterFingerprint
    },
    policy: {
      policyMode: "claim_only",
      requireBroadcastConfirmation: false,
      maxFeeSats: 5000
    },
    backendVerification: {
      verified: true,
      algorithm: "sha256",
      signerKeyId: signerInfo.keyId,
      trustedKeySource: "engine-miner-server",
      receiptPayloadHash
    },
    settlement: {
      mode: "claim",
      engineMinerApiConfigured: true,
      alkanesProviderConfigured: Boolean(config.settlementBuilder),
      broadcastStrategy: config.settlementBuilder ? "backend-settlement-builder" : "claim-submission-relay"
    }
  };

  const payloadJson = JSON.stringify(preparedClaimWithoutDigest);
  const signature = signTaggedPayload(PREPARED_CLAIM_TAG, payloadJson, wallet.privateKey);
  const preparedClaim = {
    ...preparedClaimWithoutDigest,
    preparedClaimDigestHex: signature.digestHex
  };

  return {
    schema: "engine-miner-signed-claim-v1",
    claimId: claimReceipt.claimId,
    signedAt: new Date().toISOString(),
    preparedClaim,
    walletSignature: {
      tag: PREPARED_CLAIM_TAG,
      payloadJson,
      digestHex: signature.digestHex,
      signatureAlgorithm: "bip340-schnorr",
      signatureEncoding: "hex",
      address: wallet.payoutAddress,
      publicKey: wallet.publicKeyHex,
      internalPubkey: wallet.internalPubkeyHex,
      derivationPath: wallet.derivationPath,
      signature: signature.signatureHex
    }
  };
}

async function main(): Promise<void> {
  const config: EngineMinerServerConfig = {
    ...loadConfig(),
    bitcoinProviderPrimary: "local-dev",
    bitcoinProviderFallback: null
  };

  if (!config.settlementBuilder) {
    throw new Error("ENGINE_MINER settlement builder is not configured in the current environment.");
  }

  const service = new EngineMinerService(config);
  const wallet = createLocalWallet(config.defaultNetwork);
  const challenge = service.issueRegistrationChallenge({
    agentId: "claim-settlement-smoke-agent",
    agentProfile: {
      name: "claim-settlement-smoke",
      runtime: "tsx",
      version: "1.0.0"
    },
    requestedNetwork: config.defaultNetwork
  });

  const registrationPayload = {
    challenge: challenge.challenge,
    expiresAt: challenge.expiresAt,
    domain: challenge.domain,
    network: challenge.network,
    address: wallet.payoutAddress,
    fundingAddress: wallet.fundingAddress,
    addressType: wallet.addressType,
    internalPubkey: wallet.internalPubkeyHex,
    derivationPath: wallet.derivationPath
  };
  const registrationPayloadJson = canonicalizeRegistrationPayload(registrationPayload);
  const registrationSignature = signTaggedPayload(REGISTRATION_TAG, registrationPayloadJson, wallet.privateKey);

  const registration = service.completeRegistration({
    registrationId: challenge.registrationId,
    payoutAddress: wallet.payoutAddress,
    fundingAddress: wallet.fundingAddress,
    addressType: wallet.addressType,
    publicKey: wallet.publicKeyHex,
    internalPubkey: wallet.internalPubkeyHex,
    derivationPath: wallet.derivationPath,
    signedPayload: {
      scheme: "engine-miner-registration-v1",
      ...registrationPayload
    },
    signature: registrationSignature.signatureHex
  });

  await service.startMining({
    minerId: registration.minerId,
    strategy: {
      categories: [],
      maxParallelRounds: 1
    }
  });

  const round = await service.getCurrentRound(registration.minerId);
  const solution = await service.submitSolution({
    roundId: round.roundId,
    minerId: registration.minerId,
    answer: solveRound(round),
    submittedAtClient: new Date().toISOString()
  });

  if (!solution.accepted || !solution.claimReservationId) {
    throw new Error(`Expected a provisional winner reservation, received: ${JSON.stringify(solution)}`);
  }

  const payment = await service.submitClaimPayment(solution.claimReservationId, {
    minerId: registration.minerId,
    network: config.defaultNetwork,
    feePayment: {
      fundingAddress: wallet.fundingAddress,
      addressType: wallet.addressType,
      txid: sha256Hex(`claim-payment-${Date.now()}`)
    },
    providerHints: {
      bitcoinPrimary: "local-dev"
    }
  });

  if (payment.status !== "payment_accepted") {
    throw new Error(`Expected payment_accepted, received: ${JSON.stringify(payment)}`);
  }

  const rewards = await service.listClaimableRewards(registration.minerId);
  const claimableReward = rewards.rewards.find((reward) => reward.claimId === payment.claimId);
  if (!claimableReward || claimableReward.status !== "claimable") {
    throw new Error(`Expected claimable reward after fee payment, received: ${JSON.stringify(rewards)}`);
  }

  const claimReceipt = await service.requestClaimReceipt({
    minerId: registration.minerId,
    claimIds: [payment.claimId]
  });
  const signedClaim = buildSignedClaim(config, claimReceipt, wallet);
  const submission = await service.submitClaim(signedClaim);
  const status = service.getClaimStatus(claimReceipt.claimId);

  console.log(
    JSON.stringify(
      {
        network: config.defaultNetwork,
        paymentProvider: payment.provider,
        rewardClaimId: payment.claimId,
        claimReceiptId: claimReceipt.claimId,
        submissionId: submission.submissionId,
        provider: submission.provider,
        txid: submission.txid,
        claimStatus: status.status,
        lastKnownTxid: status.lastKnownTxid,
        payoutAddress: wallet.payoutAddress
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});