import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";

bitcoin.initEccLib(ecc);

const backendBaseUrl = process.env.ENGINE_MINER_BACKEND_BASE_URL || "http://127.0.0.1:3031";
const projectDir = path.resolve(import.meta.dirname, "..");
const stateDir = path.join(os.tmpdir(), "engine-miner-mcp-smoke");

fs.rmSync(stateDir, { recursive: true, force: true });

function parseToolPayload(result) {
  const textContent = result.content.find((item) => item.type === "text");
  if (!textContent) {
    throw new Error("MCP tool result did not include text content.");
  }

  return JSON.parse(textContent.text);
}

const REGISTRATION_TAG = "EngineMinerRegistrationChallenge/v1";
const TEST_PRIVATE_KEY = Buffer.from("11".repeat(32), "hex");

function sha256(buffer) {
  return Buffer.from(bitcoin.crypto.sha256(Buffer.from(buffer)));
}

function taggedHash(tag, message) {
  const tagHash = sha256(Buffer.from(tag, "utf8"));
  return sha256(Buffer.concat([tagHash, tagHash, Buffer.from(message)]));
}

function buildRealRegistrationProof(challenge) {
  const publicKey = Buffer.from(ecc.pointFromScalar(TEST_PRIVATE_KEY, true));
  const internalPubkey = Buffer.from(publicKey.subarray(1, 33));
  const derivationPath = "m/86'/0'/0'/0/0";
  const payoutAddress = bitcoin.payments.p2tr({
    internalPubkey,
    network: bitcoin.networks.bitcoin
  }).address;

  if (!payoutAddress) {
    throw new Error("Failed to derive the smoke-test Taproot payout address.");
  }

  const signedPayload = {
    scheme: "engine-miner-registration-v1",
    challenge: challenge.challenge,
    expiresAt: challenge.expiresAt,
    domain: challenge.domain,
    network: challenge.network,
    address: payoutAddress,
    internalPubkey: internalPubkey.toString("hex"),
    derivationPath
  };
  const digest = taggedHash(REGISTRATION_TAG, Buffer.from(JSON.stringify(signedPayload), "utf8"));

  return {
    registrationId: challenge.registrationId,
    payoutAddress,
    publicKey: publicKey.toString("hex"),
    internalPubkey: internalPubkey.toString("hex"),
    derivationPath,
    signedPayload,
    signature: Buffer.from(ecc.signSchnorr(digest, TEST_PRIVATE_KEY)).toString("hex")
  };
}

function solveRound(round) {
  if (round.category === "symbolic-equations") {
    return { x: 6 };
  }

  if (round.category === "number-theory") {
    return { p: 47 };
  }

  if (round.category === "sequence-pattern") {
    return { n6: 38 };
  }

  throw new Error(`Unsupported smoke-test round category: ${round.category}`);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  cwd: projectDir,
  env: {
    ...process.env,
    ENGINE_MINER_BACKEND_BASE_URL: backendBaseUrl,
    ENGINE_MINER_MCP_STATE_DIR: stateDir
  }
});

const client = new Client(
  {
    name: "engine-miner-mcp-smoke",
    version: "0.1.0"
  },
  {
    capabilities: {}
  }
);

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const challengePayload = parseToolPayload(
    await client.callTool({
      name: "engine_miner_get_registration_challenge",
      arguments: {
        agentId: "mcp-smoke-agent",
        agentName: "Engine miner MCP Smoke",
        agentRuntime: "github-copilot/gpt-5.4",
        agentVersion: "0.1.0",
        requestedNetwork: "mainnet"
      }
    })
  );
  const registrationPayload = parseToolPayload(
    await client.callTool({
      name: "engine_miner_submit_registration",
      arguments: {
        proof: buildRealRegistrationProof(challengePayload.challenge)
      }
    })
  );
  const minerId = registrationPayload.registration.minerId;

  const startPayload = parseToolPayload(
    await client.callTool({
      name: "engine_miner_start_mining",
      arguments: {
        minerId,
        categories: ["symbolic-equations"],
        maxParallelRounds: 1
      }
    })
  );
  const roundPayload = parseToolPayload(
    await client.callTool({
      name: "engine_miner_get_current_round",
      arguments: {
        minerId
      }
    })
  );
  const solutionPayload = parseToolPayload(
    await client.callTool({
      name: "engine_miner_submit_solution",
      arguments: {
        minerId,
        roundId: roundPayload.round.roundId,
        answer: solveRound(roundPayload.round),
        submittedAtClient: new Date().toISOString()
      }
    })
  );
  const statusPayload = parseToolPayload(
    await client.callTool({
      name: "engine_miner_get_mining_status",
      arguments: {
        minerId
      }
    })
  );
  const rewardsPayload = parseToolPayload(
    await client.callTool({
      name: "engine_miner_list_claimable_rewards",
      arguments: {
        minerId
      }
    })
  );

  if (!Array.isArray(rewardsPayload.rewards) || rewardsPayload.rewards.length === 0) {
    throw new Error("Smoke test expected at least one claimable reward after a winning solution.");
  }

  const claimReceiptPayload = parseToolPayload(
    await client.callTool({
      name: "engine_miner_request_claim_receipt",
      arguments: {
        minerId,
        claimIds: [rewardsPayload.rewards[0].claimId]
      }
    })
  );
  const claimStatusPayload = parseToolPayload(
    await client.callTool({
      name: "engine_miner_get_claim_status",
      arguments: {
        claimId: claimReceiptPayload.claimReceipt.claimId
      }
    })
  );

  console.log(
    JSON.stringify(
      {
        backendBaseUrl,
        toolCount: tools.tools.length,
        toolNames: tools.tools.map((tool) => tool.name),
        challenge: challengePayload.challenge,
        registration: registrationPayload.registration,
        startMining: startPayload.mining,
        round: roundPayload.round,
        solution: solutionPayload.solution,
        status: statusPayload.status,
        rewards: rewardsPayload.rewards,
        claimReceipt: claimReceiptPayload.claimReceipt,
        claimStatus: claimStatusPayload.claimStatus,
        localStateDir: stateDir
      },
      null,
      2
    )
  );
} finally {
  await client.close();
}