#[allow(unused_imports, dead_code, clippy::all)]
mod generated {
    include!(concat!(env!("OUT_DIR"), "/generated.rs"));
}

use alkanes_runtime::{auth::AuthenticatedResponder, runtime::AlkaneResponder, storage::StoragePointer};
use alkanes_support::{
    cellpack::Cellpack,
    id::AlkaneId,
    response::CallResponse,
};
use anyhow::{ensure, Result};
use metashrew_support::index_pointer::KeyValuePointer;
use std::sync::Arc;

use generated::EngineClaimManagerInterface;

const ENGINE_TOKEN_MINT_OPCODE: u128 = 77;

#[derive(Default)]
pub struct EngineClaimManager(());

impl EngineClaimManager {
    fn engine_token_pointer(&self) -> StoragePointer {
        StoragePointer::from_keyword("/engine_token")
    }

    fn set_engine_token(&self, engine_token: AlkaneId) {
        self.engine_token_pointer().set(Arc::new(<AlkaneId as Into<Vec<u8>>>::into(engine_token)));
    }

    fn engine_token(&self) -> Result<AlkaneId> {
        Ok(self.engine_token_pointer().get().as_ref().clone().try_into()?)
    }

    fn claim_key(claim_hash_hi: u128, claim_hash_lo: u128) -> Vec<u8> {
        let mut key = Vec::with_capacity(32);
        key.extend(&claim_hash_hi.to_le_bytes());
        key.extend(&claim_hash_lo.to_le_bytes());
        key
    }

    fn settled_claim_pointer(&self, claim_hash_hi: u128, claim_hash_lo: u128) -> StoragePointer {
        StoragePointer::from_keyword("/settled_claims").select(&Self::claim_key(claim_hash_hi, claim_hash_lo))
    }
}

impl AuthenticatedResponder for EngineClaimManager {}
impl AlkaneResponder for EngineClaimManager {}

impl EngineClaimManagerInterface for EngineClaimManager {
    fn initialize(&self, engine_token: AlkaneId, settlement_auth_units: u128) -> Result<CallResponse> {
        self.observe_initialization()?;
        let context = self.context()?;

        self.set_engine_token(engine_token);

        let mut response = CallResponse::forward(&context.incoming_alkanes);
        if settlement_auth_units > 0 {
            response.alkanes.0.push(self.deploy_self_auth_token(settlement_auth_units)?);
        }

        Ok(response)
    }

    fn settle_claim(&self, reward_units: u128, claim_hash_hi: u128, claim_hash_lo: u128) -> Result<CallResponse> {
        self.only_owner()?;

        let mut settled_pointer = self.settled_claim_pointer(claim_hash_hi, claim_hash_lo);
        ensure!(
            settled_pointer.get_value::<u8>() == 0,
            "claim hash has already been settled"
        );

        settled_pointer.set_value::<u8>(1);

        let mint_response = self.call(
            &Cellpack {
                target: self.engine_token()?,
                inputs: vec![ENGINE_TOKEN_MINT_OPCODE, reward_units],
            },
            &Default::default(),
            self.fuel(),
        )?;

        let mut response = CallResponse::default();
        response.alkanes.0.extend(mint_response.alkanes.0);
        response.data = mint_response.data;
        Ok(response)
    }

    fn get_engine_token(&self) -> Result<CallResponse> {
        let context = self.context()?;
        let mut response = CallResponse::forward(&context.incoming_alkanes);
        response.data = Vec::<u8>::from(self.engine_token()?);
        Ok(response)
    }

    fn get_token_mint_opcode(&self) -> Result<CallResponse> {
        let context = self.context()?;
        let mut response = CallResponse::forward(&context.incoming_alkanes);
        response.data = ENGINE_TOKEN_MINT_OPCODE.to_le_bytes().to_vec();
        Ok(response)
    }

    fn get_claim_status(&self, claim_hash_hi: u128, claim_hash_lo: u128) -> Result<CallResponse> {
        let context = self.context()?;
        let mut response = CallResponse::forward(&context.incoming_alkanes);
        let status = self.settled_claim_pointer(claim_hash_hi, claim_hash_lo).get_value::<u8>() as u128;
        response.data = status.to_le_bytes().to_vec();
        Ok(response)
    }

    fn get_auth_token_block(&self) -> Result<CallResponse> {
        let context = self.context()?;
        let mut response = CallResponse::forward(&context.incoming_alkanes);
        response.data = self.auth_token()?.block.to_le_bytes().to_vec();
        Ok(response)
    }

    fn get_auth_token_tx(&self) -> Result<CallResponse> {
        let context = self.context()?;
        let mut response = CallResponse::forward(&context.incoming_alkanes);
        response.data = self.auth_token()?.tx.to_le_bytes().to_vec();
        Ok(response)
    }
}