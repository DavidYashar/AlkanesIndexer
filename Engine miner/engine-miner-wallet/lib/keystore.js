import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const KEYSTORE_FILE = "keystore.json";
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const PBKDF2_ITERATIONS = 210000;
const PBKDF2_KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 32;

function normalizeString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

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

function resolvePassphrase(options = {}) {
  const explicit = normalizeString(options.passphrase);
  if (explicit) {
    return explicit;
  }
  return normalizeString(process.env.ENGINE_MINER_WALLET_PASSPHRASE);
}

function runWindowsPowerShell(script) {
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8" }
  ).trim();
}

function protectWithWindowsDpapi(secretValue) {
  const encoded = Buffer.from(secretValue, "utf8").toString("base64");
  const script = [
    `$plain = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`,
    "$secure = ConvertTo-SecureString $plain -AsPlainText -Force",
    "ConvertFrom-SecureString $secure"
  ].join("; ");
  return runWindowsPowerShell(script);
}

function unprotectWithWindowsDpapi(ciphertext) {
  const encoded = Buffer.from(ciphertext, "utf8").toString("base64");
  const script = [
    `$cipher = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`,
    "$secure = ConvertTo-SecureString $cipher",
    "$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)",
    "try { [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }"
  ].join("; ");
  return runWindowsPowerShell(script);
}

function encryptWithPassphrase(secretValue, passphrase) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, "sha256");
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(secretValue, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    provider: "encrypted-file",
    algorithm: ENCRYPTION_ALGORITHM,
    iterations: PBKDF2_ITERATIONS,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function decryptWithPassphrase(record, passphrase) {
  if (!passphrase) {
    throw new Error(
      "Wallet keystore requires a passphrase. Set ENGINE_MINER_WALLET_PASSPHRASE or pass --passphrase to the admin command."
    );
  }

  const salt = Buffer.from(record.salt, "base64");
  const iv = Buffer.from(record.iv, "base64");
  const authTag = Buffer.from(record.authTag, "base64");
  const ciphertext = Buffer.from(record.ciphertext, "base64");
  const iterations = Number.isInteger(record.iterations) ? record.iterations : PBKDF2_ITERATIONS;
  const key = crypto.pbkdf2Sync(passphrase, salt, iterations, PBKDF2_KEY_LENGTH, "sha256");
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

function readKeystoreRecord(options = {}) {
  const filePath = getKeystorePath(options);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return readJsonFile(filePath);
}

export function resolveWalletDataDir(options = {}) {
  const explicitStateDir = normalizeString(options.stateDir);
  if (explicitStateDir) {
    return path.resolve(explicitStateDir);
  }

  const envStateDir = normalizeString(process.env.ENGINE_MINER_WALLET_STATE_DIR);
  if (envStateDir) {
    return path.resolve(envStateDir);
  }

  return path.join(os.homedir(), ".engine-miner-wallet");
}

export function getKeystorePath(options = {}) {
  return path.join(resolveWalletDataDir(options), KEYSTORE_FILE);
}

export function storeMnemonic(mnemonic, options = {}) {
  const normalizedMnemonic = normalizeString(mnemonic);
  if (!normalizedMnemonic) {
    throw new Error("Mnemonic is required before it can be stored.");
  }

  const dataDir = ensureDataDir(resolveWalletDataDir(options));
  const filePath = path.join(dataDir, KEYSTORE_FILE);
  if (fs.existsSync(filePath) && options.overwrite !== true) {
    throw new Error("Wallet keystore already exists. Re-run with force to replace it.");
  }

  const passphrase = resolvePassphrase(options);
  let record;
  if (process.platform === "win32" && !passphrase) {
    record = {
      version: 1,
      provider: "windows-dpapi-securestring",
      ciphertext: protectWithWindowsDpapi(normalizedMnemonic)
    };
  } else {
    record = {
      version: 1,
      ...encryptWithPassphrase(normalizedMnemonic, passphrase)
    };
  }

  writeJsonFile(filePath, record);
  return {
    provider: record.provider,
    filePath
  };
}

export function loadMnemonic(options = {}) {
  const record = readKeystoreRecord(options);
  if (!record) {
    throw new Error("Wallet keystore not found. Initialize the wallet first.");
  }

  if (record.provider === "windows-dpapi-securestring") {
    return unprotectWithWindowsDpapi(record.ciphertext);
  }

  if (record.provider === "encrypted-file") {
    return decryptWithPassphrase(record, resolvePassphrase(options));
  }

  throw new Error(`Unsupported keystore provider: ${record.provider}`);
}

export function getKeystoreStatus(options = {}) {
  const filePath = getKeystorePath(options);
  if (!fs.existsSync(filePath)) {
    return {
      initialized: false,
      provider: null,
      accessible: false,
      filePath,
      accessError: null
    };
  }

  const record = readJsonFile(filePath);
  try {
    loadMnemonic(options);
    return {
      initialized: true,
      provider: record.provider || null,
      accessible: true,
      filePath,
      accessError: null
    };
  } catch (error) {
    return {
      initialized: true,
      provider: record.provider || null,
      accessible: false,
      filePath,
      accessError: error instanceof Error ? error.message : String(error)
    };
  }
}