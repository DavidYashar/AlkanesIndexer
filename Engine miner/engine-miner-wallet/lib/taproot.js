import { BIP32Factory } from "bip32";
import * as bip39 from "bip39";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";

bitcoin.initEccLib(ecc);

const bip32 = BIP32Factory(ecc);
const DEFAULT_ACCOUNT = 0;
const DEFAULT_CHANGE = 0;
const DEFAULT_INDEX = 0;
const REGISTRATION_TAG = "EngineMinerRegistrationChallenge/v1";

const NETWORKS = {
  mainnet: bitcoin.networks.bitcoin,
  signet: bitcoin.networks.testnet,
  regtest: bitcoin.networks.regtest
};

const COIN_TYPES = {
  mainnet: 0,
  signet: 1,
  regtest: 1
};

function normalizeNetwork(networkName = "mainnet") {
  const normalized = typeof networkName === "string" ? networkName.trim().toLowerCase() : "mainnet";
  if (!NETWORKS[normalized]) {
    throw new Error(`Unsupported Bitcoin network: ${networkName}`);
  }
  return normalized;
}

function toNumber(value, fallback) {
  return Number.isInteger(value) ? value : fallback;
}

function toXOnly(publicKey) {
  if (!publicKey) {
    throw new Error("Public key is required for Taproot derivation.");
  }

  if (publicKey.length === 32) {
    return Buffer.from(publicKey);
  }

  if (publicKey.length === 33) {
    return Buffer.from(publicKey.subarray(1, 33));
  }

  throw new Error(`Unexpected public key length for Taproot derivation: ${publicKey.length}`);
}

function sha256(buffer) {
  return Buffer.from(bitcoin.crypto.sha256(Buffer.from(buffer)));
}

function taggedHash(tag, message) {
  const tagHash = sha256(Buffer.from(tag, "utf8"));
  return sha256(Buffer.concat([tagHash, tagHash, Buffer.from(message)]));
}

function normalizeIsoTimestamp(value) {
  const timestamp = typeof value === "string" ? value.trim() : "";
  if (!timestamp) {
    throw new Error("expiresAt is required.");
  }

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid expiresAt timestamp: ${value}`);
  }

  return parsed.toISOString();
}

function assertChallengeNotExpired(expiresAt) {
  const expiryMs = new Date(expiresAt).getTime();
  if (Date.now() > expiryMs) {
    throw new Error("Registration challenge is expired.");
  }
}

function buildRegistrationPayload(descriptor, options = {}) {
  const challenge = typeof options.challenge === "string" ? options.challenge.trim() : "";
  if (!challenge) {
    throw new Error("challenge is required.");
  }

  const expiresAt = normalizeIsoTimestamp(options.expiresAt);
  assertChallengeNotExpired(expiresAt);

  return {
    scheme: "engine-miner-registration-v1",
    challenge,
    expiresAt,
    ...(typeof options.domain === "string" && options.domain.trim()
      ? { domain: options.domain.trim() }
      : {}),
    network: descriptor.network,
    address: descriptor.address,
    internalPubkey: descriptor.internalPubkey,
    derivationPath: descriptor.derivationPath
  };
}

function serializeRegistrationPayload(payload) {
  return JSON.stringify(payload);
}

function deriveTaprootKeyRecord(options = {}) {
  const mnemonic = typeof options.mnemonic === "string" ? options.mnemonic.trim() : "";
  if (!validateMnemonic(mnemonic)) {
    throw new Error("Invalid BIP39 mnemonic.");
  }

  const networkName = normalizeNetwork(options.network);
  const network = NETWORKS[networkName];
  const account = toNumber(options.account, DEFAULT_ACCOUNT);
  const change = toNumber(options.change, DEFAULT_CHANGE);
  const index = toNumber(options.index, DEFAULT_INDEX);
  const derivationPath = deriveBip86Path({ network: networkName, account, change, index });
  const seed = bip39.mnemonicToSeedSync(mnemonic, options.mnemonicPassphrase || "");
  const root = bip32.fromSeed(seed, network);
  const child = root.derivePath(derivationPath);
  if (!child.privateKey) {
    throw new Error("Derived Taproot child key does not include a private key.");
  }

  const internalPubkey = toXOnly(child.publicKey);
  const payment = bitcoin.payments.p2tr({
    internalPubkey,
    network
  });

  if (!payment.address) {
    throw new Error("Failed to derive Taproot payout address.");
  }

  return {
    network: networkName,
    account,
    change,
    index,
    derivationPath,
    address: payment.address,
    addressFormat: "bip86-p2tr",
    publicKey: Buffer.from(child.publicKey).toString("hex"),
    internalPubkey: internalPubkey.toString("hex"),
    outputScript: payment.output ? Buffer.from(payment.output).toString("hex") : null,
    masterFingerprint: Buffer.from(root.fingerprint).toString("hex"),
    privateKey: Buffer.from(child.privateKey),
    xOnlyPublicKey: Buffer.from(internalPubkey)
  };
}

export function validateMnemonic(mnemonic) {
  return bip39.validateMnemonic(mnemonic);
}

export function generateMnemonic(wordCount = 24) {
  const strength = wordCount === 12 ? 128 : 256;
  return bip39.generateMnemonic(strength);
}

export function deriveBip86Path(options = {}) {
  const network = normalizeNetwork(options.network);
  const account = toNumber(options.account, DEFAULT_ACCOUNT);
  const change = toNumber(options.change, DEFAULT_CHANGE);
  const index = toNumber(options.index, DEFAULT_INDEX);
  const coinType = COIN_TYPES[network];
  return `m/86'/${coinType}'/${account}'/${change}/${index}`;
}

export function deriveTaprootDescriptor(options = {}) {
  const keyRecord = deriveTaprootKeyRecord(options);
  return {
    network: keyRecord.network,
    account: keyRecord.account,
    change: keyRecord.change,
    index: keyRecord.index,
    derivationPath: keyRecord.derivationPath,
    address: keyRecord.address,
    addressFormat: keyRecord.addressFormat,
    publicKey: keyRecord.publicKey,
    internalPubkey: keyRecord.internalPubkey,
    outputScript: keyRecord.outputScript,
    masterFingerprint: keyRecord.masterFingerprint
  };
}

export function signRegistrationChallenge(options = {}) {
  const keyRecord = deriveTaprootKeyRecord(options);
  const payload = buildRegistrationPayload(keyRecord, options);
  const serializedPayload = serializeRegistrationPayload(payload);
  const digest = taggedHash(REGISTRATION_TAG, Buffer.from(serializedPayload, "utf8"));
  const signature = Buffer.from(ecc.signSchnorr(digest, keyRecord.privateKey));
  const verified = ecc.verifySchnorr(digest, keyRecord.xOnlyPublicKey, signature);

  if (!verified) {
    throw new Error("Failed to verify the generated registration signature.");
  }

  return {
    scheme: payload.scheme,
    signatureAlgorithm: "bip340-schnorr-tagged-sha256",
    signatureEncoding: "hex",
    tag: REGISTRATION_TAG,
    signedPayload: payload,
    payloadJson: serializedPayload,
    digestHex: Buffer.from(digest).toString("hex"),
    address: keyRecord.address,
    publicKey: keyRecord.publicKey,
    internalPubkey: keyRecord.internalPubkey,
    derivationPath: keyRecord.derivationPath,
    signature: signature.toString("hex")
  };
}