import Fastify from "fastify";
import { ZodError } from "zod";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import {
  ClaimPaymentSubmissionSchema,
  ClaimSubmissionRequestSchema,
  ClaimRequestSchema,
  MiningStartRequestSchema,
  MiningStopRequestSchema,
  RegistrationChallengeRequestSchema,
  RegistrationProofSchema,
  SolutionSubmissionSchema
} from "./contracts.js";
import { EngineMinerService } from "./engine-miner-service.js";

export function buildServer() {
  const config = loadConfig();
  const service = new EngineMinerService(config);
  const app = Fastify({ logger: true });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({
        error: "validation_error",
        issues: error.issues
      });
      return;
    }

    reply.status(400).send({
      error: error instanceof Error ? error.message : String(error)
    });
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "engine-miner-server"
  }));

  app.post("/v1/registration/challenge", async (request) => {
    const body = RegistrationChallengeRequestSchema.parse(request.body);
    return service.issueRegistrationChallenge(body);
  });

  app.post("/v1/registration/complete", async (request) => {
    const body = RegistrationProofSchema.parse(request.body);
    return service.completeRegistration(body);
  });

  app.post("/v1/mining/start", async (request) => {
    const body = MiningStartRequestSchema.parse(request.body);
    return service.startMining(body);
  });

  app.post("/v1/mining/stop", async (request) => {
    const body = MiningStopRequestSchema.parse(request.body);
    return service.stopMining(body.minerId);
  });

  app.get("/v1/rounds/current", async (request) => {
    const query = request.query as { minerId?: string };
    if (!query.minerId) {
      throw new Error("minerId query parameter is required.");
    }
    return service.getCurrentRound(query.minerId);
  });

  app.post("/v1/rounds/:roundId/solutions", async (request) => {
    const body = SolutionSubmissionSchema.parse(request.body);
    const params = request.params as { roundId: string };
    if (body.roundId !== params.roundId) {
      throw new Error("Body roundId must match route roundId.");
    }
    return service.submitSolution(body);
  });

  app.get("/v1/miners/:minerId/status", async (request) => {
    const params = request.params as { minerId: string };
    return service.getMinerStatus(params.minerId);
  });

  app.get("/v1/miners/:minerId/claimable-rewards", async (request) => {
    const params = request.params as { minerId: string };
    return service.listClaimableRewards(params.minerId);
  });

  app.post("/v1/claims/request", async (request) => {
    const body = ClaimRequestSchema.parse(request.body);
    return service.requestClaimReceipt(body);
  });

  app.post("/v1/claims/reservations/:claimReservationId/payment", async (request) => {
    const body = ClaimPaymentSubmissionSchema.parse(request.body);
    const params = request.params as { claimReservationId: string };
    return service.submitClaimPayment(params.claimReservationId, body);
  });

  app.post("/v1/claims/submit", async (request) => {
    const body = ClaimSubmissionRequestSchema.parse(request.body);
    return service.submitClaim(body.signedClaim);
  });

  app.get("/v1/claims/:claimId/status", async (request) => {
    const params = request.params as { claimId: string };
    return service.getClaimStatus(params.claimId);
  });

  return { app, config };
}

async function start() {
  const { app, config } = buildServer();
  await app.listen({
    host: config.host,
    port: config.port
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}