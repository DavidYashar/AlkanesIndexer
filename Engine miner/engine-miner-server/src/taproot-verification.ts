import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";

bitcoin.initEccLib(ecc);

const NETWORKS = {
  mainnet: bitcoin.networks.bitcoin,
  signet: bitcoin.networks.testnet,
  regtest: bitcoin.networks.regtest
} as const;

const ADDRESS_TYPES = {
  p2tr: "p2tr",
  p2wpkh: "p2wpkh"
} as const;

export type SupportedAddressType = keyof typeof ADDRESS_TYPES;

export const REGISTRATION_TAG = "EngineMinerRegistrationChallenge/v1";
export const PREPARED_CLAIM_TAG = "EngineMinerPreparedClaim/v1";

function sha256(buffer: Buffer): Buffer {
  return Buffer.from(bitcoin.crypto.sha256(buffer));
}

export function taggedHash(tag: string, message: Buffer): Buffer {
  const tagHash = sha256(Buffer.from(tag, "utf8"));
  return sha256(Buffer.concat([tagHash, tagHash, message]));
}

export function toXOnly(publicKey: Buffer): Buffer {
  if (publicKey.length === 32) {
    return Buffer.from(publicKey);
  }

  if (publicKey.length === 33) {
    return Buffer.from(publicKey.subarray(1, 33));
  }

  throw new Error(`Unexpected public key length: ${publicKey.length}`);
}

export function getBitcoinNetwork(networkName: "mainnet" | "signet" | "regtest") {
  return NETWORKS[networkName];
}

export function normalizeAddressType(addressType: string): SupportedAddressType {
  if (addressType === "p2tr" || addressType === "p2wpkh") {
    return addressType;
  }

  throw new Error(`Unsupported wallet address type: ${addressType}`);
}

export function deriveTaprootAddressFromInternalPubkey(networkName: "mainnet" | "signet" | "regtest", internalPubkeyHex: string): string {
  const payment = bitcoin.payments.p2tr({
    internalPubkey: Buffer.from(internalPubkeyHex, "hex"),
    network: getBitcoinNetwork(networkName)
  });

  if (!payment.address) {
    throw new Error("Failed to derive Taproot address from internal pubkey.");
  }

  return payment.address;
}

export function deriveNativeSegwitAddressFromPublicKey(networkName: "mainnet" | "signet" | "regtest", publicKeyHex: string): string {
  const payment = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(publicKeyHex, "hex"),
    network: getBitcoinNetwork(networkName)
  });

  if (!payment.address) {
    throw new Error("Failed to derive Native SegWit address from public key.");
  }

  return payment.address;
}

export function deriveWalletAddress(options: {
  networkName: "mainnet" | "signet" | "regtest";
  addressType: string;
  publicKeyHex: string;
  internalPubkeyHex: string;
}): string {
  const addressType = normalizeAddressType(options.addressType);

  if (addressType === "p2tr") {
    return deriveTaprootAddressFromInternalPubkey(options.networkName, options.internalPubkeyHex);
  }

  return deriveNativeSegwitAddressFromPublicKey(options.networkName, options.publicKeyHex);
}

export function verifyTaggedSchnorrSignature(options: {
  tag: string;
  payloadJson: string;
  publicKeyHex: string;
  signatureHex: string;
}): { digestHex: string; verified: boolean; internalPubkeyHex: string } {
  const publicKey = Buffer.from(options.publicKeyHex, "hex");
  const internalPubkey = toXOnly(publicKey);
  const digest = taggedHash(options.tag, Buffer.from(options.payloadJson, "utf8"));
  const verified = ecc.verifySchnorr(digest, internalPubkey, Buffer.from(options.signatureHex, "hex"));

  return {
    digestHex: Buffer.from(digest).toString("hex"),
    verified,
    internalPubkeyHex: internalPubkey.toString("hex")
  };
}