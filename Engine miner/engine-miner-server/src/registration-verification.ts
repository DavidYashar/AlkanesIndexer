import type { RegistrationProof } from "./contracts.js";
import { deriveWalletAddress, REGISTRATION_TAG, verifyTaggedSchnorrSignature } from "./taproot-verification.js";

function canonicalizeRegistrationSignedPayload(input: RegistrationProof["signedPayload"]): string {
  return JSON.stringify({
    scheme: input.scheme,
    challenge: input.challenge,
    expiresAt: input.expiresAt,
    domain: input.domain,
    network: input.network,
    address: input.address,
    fundingAddress: input.fundingAddress,
    addressType: input.addressType,
    internalPubkey: input.internalPubkey,
    derivationPath: input.derivationPath
  });
}

export function verifyRegistrationProof(proof: RegistrationProof): { digestHex: string } {
  if (proof.derivationPath !== proof.signedPayload.derivationPath) {
    throw new Error("Registration proof derivationPath does not match the signed payload.");
  }

  if (proof.internalPubkey !== proof.signedPayload.internalPubkey) {
    throw new Error("Registration proof internalPubkey does not match the signed payload.");
  }

  if (proof.addressType !== proof.signedPayload.addressType) {
    throw new Error("Registration proof addressType does not match the signed payload.");
  }

  if (proof.fundingAddress !== proof.signedPayload.fundingAddress) {
    throw new Error("Registration proof fundingAddress does not match the signed payload.");
  }

  const verification = verifyTaggedSchnorrSignature({
    tag: REGISTRATION_TAG,
    payloadJson: canonicalizeRegistrationSignedPayload(proof.signedPayload),
    publicKeyHex: proof.publicKey,
    signatureHex: proof.signature
  });

  if (!verification.verified) {
    throw new Error("Registration proof signature verification failed.");
  }

  if (verification.internalPubkeyHex !== proof.internalPubkey) {
    throw new Error("Registration proof internalPubkey does not match the supplied publicKey.");
  }

  const derivedAddress = deriveWalletAddress({
    networkName: proof.signedPayload.network,
    addressType: proof.addressType,
    publicKeyHex: proof.publicKey,
    internalPubkeyHex: proof.internalPubkey
  });

  if (derivedAddress !== proof.payoutAddress) {
    throw new Error("Registration proof payoutAddress does not match the wallet address derived from the signing key.");
  }

  if (derivedAddress !== proof.signedPayload.address) {
    throw new Error("Registration signed payload address does not match the wallet address derived from the signing key.");
  }

  if (proof.fundingAddress !== proof.payoutAddress) {
    throw new Error("Registration proof fundingAddress must currently match payoutAddress.");
  }

  return {
    digestHex: verification.digestHex
  };
}