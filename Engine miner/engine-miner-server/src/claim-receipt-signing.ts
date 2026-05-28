import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import type { ClaimReceipt } from "./contracts.js";

const DEFAULT_DEV_CLAIM_SIGNER_KEY_ID = "engine-miner-dev-v1";
const DEFAULT_DEV_CLAIM_SIGNER_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIIXHPKApqXqcQQIcOuzR0zBZ5LHkiIdT7uH4oaWWx7ZP
-----END PRIVATE KEY-----
`;

function normalizePemEnv(value: string | undefined): string | null {
  if (!value || !value.trim()) {
    return null;
  }

  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function resolveSignerConfig(): { keyId: string; privateKeyPem: string; publicKeyPem: string } {
  const privateKeyPem = normalizePemEnv(process.env.ENGINE_MINER_CLAIM_SIGNING_PRIVATE_KEY_PEM) ||
    DEFAULT_DEV_CLAIM_SIGNER_PRIVATE_KEY_PEM;
  const keyId = process.env.ENGINE_MINER_CLAIM_SIGNING_KEY_ID || DEFAULT_DEV_CLAIM_SIGNER_KEY_ID;
  const publicKeyPem =
    normalizePemEnv(process.env.ENGINE_MINER_CLAIM_SIGNING_PUBLIC_KEY_PEM) ||
    createPublicKey(createPrivateKey(privateKeyPem)).export({ type: "spki", format: "pem" }).toString();

  return {
    keyId,
    privateKeyPem,
    publicKeyPem
  };
}

export function canonicalizeUnsignedClaimReceipt(receipt: Omit<ClaimReceipt, "backendSignature">): string {
  return JSON.stringify({
    claimId: receipt.claimId,
    payoutAddress: receipt.payoutAddress,
    rewardTokens: receipt.rewardTokens,
    roundIds: receipt.roundIds,
    nonce: receipt.nonce,
    issuedAt: receipt.issuedAt,
    expiresAt: receipt.expiresAt,
    settlementMode: receipt.settlementMode
  });
}

export function signClaimReceipt(receipt: Omit<ClaimReceipt, "backendSignature">): ClaimReceipt {
  const signer = resolveSignerConfig();
  const payload = canonicalizeUnsignedClaimReceipt(receipt);
  const signature = sign(null, Buffer.from(payload, "utf8"), createPrivateKey(signer.privateKeyPem)).toString("base64");

  return {
    ...receipt,
    backendSignature: `ed25519:${signer.keyId}:${signature}`
  };
}

export function getClaimReceiptSignerInfo(): { keyId: string; publicKeyPem: string } {
  const signer = resolveSignerConfig();
  return {
    keyId: signer.keyId,
    publicKeyPem: signer.publicKeyPem
  };
}