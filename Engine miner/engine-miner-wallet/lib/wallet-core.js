import fs from "node:fs";
import path from "node:path";
import { getKeystoreStatus, loadMnemonic, resolveWalletDataDir, storeMnemonic } from "./keystore.js";
import { deriveTaprootDescriptor, generateMnemonic, signRegistrationChallenge, validateMnemonic } from "./taproot.js";

const METADATA_FILE = "wallet-meta.json";

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDataDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function resolveNumericOption(value, fallback) {
  return Number.isInteger(value) ? value : fallback;
}

export function getWalletMetadataPath(options = {}) {
  return path.join(resolveWalletDataDir(options), METADATA_FILE);
}

export function readWalletMetadata(options = {}) {
  const filePath = getWalletMetadataPath(options);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return readJsonFile(filePath);
}

export function initializeWallet(options = {}) {
  const dataDir = ensureDataDir(resolveWalletDataDir(options));
  const metadataPath = path.join(dataDir, METADATA_FILE);
  if (fs.existsSync(metadataPath) && options.force !== true) {
    throw new Error("Wallet metadata already exists. Re-run with force to replace it.");
  }

  const providedMnemonic = typeof options.mnemonic === "string" ? options.mnemonic.trim() : "";
  const mnemonic = providedMnemonic || generateMnemonic(options.wordCount === 12 ? 12 : 24);
  if (!validateMnemonic(mnemonic)) {
    throw new Error("Cannot initialize wallet because the mnemonic is invalid.");
  }

  const network = typeof options.network === "string" && options.network.trim() ? options.network.trim() : "mainnet";
  const account = resolveNumericOption(options.account, 0);
  const change = resolveNumericOption(options.change, 0);
  const index = resolveNumericOption(options.index, 0);
  const storedKeystore = storeMnemonic(mnemonic, {
    stateDir: dataDir,
    passphrase: options.passphrase,
    overwrite: options.force === true
  });
  const payout = deriveTaprootDescriptor({
    mnemonic,
    network,
    account,
    change,
    index
  });
  const now = new Date().toISOString();
  const metadata = {
    version: 1,
    createdAt: now,
    updatedAt: now,
    network: payout.network,
    account: payout.account,
    change: payout.change,
    index: payout.index,
    derivationPath: payout.derivationPath,
    payoutAddress: payout.address,
    addressFormat: payout.addressFormat,
    publicKey: payout.publicKey,
    internalPubkey: payout.internalPubkey,
    outputScript: payout.outputScript,
    masterFingerprint: payout.masterFingerprint,
    keystoreProvider: storedKeystore.provider,
    mnemonicWords: mnemonic.split(/\s+/).length
  };

  writeJsonFile(metadataPath, metadata);

  return {
    storageDir: dataDir,
    createdNewMnemonic: !providedMnemonic,
    mnemonic,
    ...metadata
  };
}

export function getWalletStatus(options = {}) {
  const storageDir = resolveWalletDataDir(options);
  const metadata = readWalletMetadata(options);
  const keystore = getKeystoreStatus(options);
  let derivedDescriptor = null;
  let accessError = keystore.accessError;

  if (metadata && keystore.initialized && keystore.accessible) {
    try {
      const mnemonic = loadMnemonic(options);
      derivedDescriptor = deriveTaprootDescriptor({
        mnemonic,
        network: metadata.network,
        account: metadata.account,
        change: metadata.change,
        index: metadata.index
      });
    } catch (error) {
      accessError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    initialized: Boolean(metadata && keystore.initialized),
    storageDir,
    metadataPresent: Boolean(metadata),
    keystorePresent: keystore.initialized,
    keystoreProvider: metadata?.keystoreProvider ?? keystore.provider,
    keystoreAccessible: Boolean(derivedDescriptor),
    accessError: accessError || null,
    network: metadata?.network ?? null,
    derivationPath: metadata?.derivationPath ?? null,
    payoutAddress: derivedDescriptor?.address ?? metadata?.payoutAddress ?? null,
    addressFormat: metadata?.addressFormat ?? null,
    addressMatchesStoredMetadata: derivedDescriptor ? derivedDescriptor.address === metadata?.payoutAddress : null,
    masterFingerprint: metadata?.masterFingerprint ?? null,
    mnemonicWords: metadata?.mnemonicWords ?? null
  };
}

export function getPayoutAddress(options = {}) {
  const metadata = readWalletMetadata(options);
  if (!metadata) {
    throw new Error("Wallet is not initialized. Run `node ./admin.js init` in the plugin folder first.");
  }

  const mnemonic = loadMnemonic(options);
  const descriptor = deriveTaprootDescriptor({
    mnemonic,
    network: metadata.network,
    account: metadata.account,
    change: metadata.change,
    index: metadata.index
  });

  if (metadata.payoutAddress && metadata.payoutAddress !== descriptor.address) {
    throw new Error("Stored wallet metadata does not match the derived Taproot payout address.");
  }

  return {
    storageDir: resolveWalletDataDir(options),
    ...descriptor
  };
}

export function signWalletRegistrationChallenge(options = {}) {
  const metadata = readWalletMetadata(options);
  if (!metadata) {
    throw new Error("Wallet is not initialized. Run `node ./admin.js init` in the plugin folder first.");
  }

  const mnemonic = loadMnemonic(options);
  const signatureRecord = signRegistrationChallenge({
    mnemonic,
    network: metadata.network,
    account: metadata.account,
    change: metadata.change,
    index: metadata.index,
    challenge: options.challenge,
    expiresAt: options.expiresAt,
    domain: options.domain
  });

  if (metadata.payoutAddress && metadata.payoutAddress !== signatureRecord.address) {
    throw new Error("Stored wallet metadata does not match the signing address derived from the mnemonic.");
  }

  return {
    storageDir: resolveWalletDataDir(options),
    ...signatureRecord
  };
}