#[allow(unused_imports, dead_code, clippy::all)]
mod generated {
    include!(concat!(env!("OUT_DIR"), "/generated.rs"));
}

use alkanes_runtime::{runtime::AlkaneResponder, storage::StoragePointer};
use alkanes_std_factory_support::MintableToken;
use alkanes_support::{context::Context, id::AlkaneId, parcel::AlkaneTransfer, response::CallResponse};
use anyhow::{anyhow, ensure, Result};
use metashrew_support::index_pointer::KeyValuePointer;
use std::sync::Arc;

use generated::EngineTokenInterface;

#[derive(Default)]
pub struct EngineToken(());

impl EngineToken {
    fn claim_manager_pointer(&self) -> StoragePointer {
        StoragePointer::from_keyword("/claim_manager")
    }

    fn set_claim_manager(&self, claim_manager: AlkaneId) {
        self.claim_manager_pointer().set(Arc::new(<AlkaneId as Into<Vec<u8>>>::into(claim_manager)));
    }

    fn claim_manager(&self) -> Result<AlkaneId> {
        Ok(self.claim_manager_pointer().get().as_ref().clone().try_into()?)
    }

    fn cap_pointer(&self) -> StoragePointer {
        StoragePointer::from_keyword("/cap")
    }

    fn set_cap(&self, cap: u128) {
        self.cap_pointer().set_value::<u128>(cap);
    }

    fn cap(&self) -> u128 {
        self.cap_pointer().get_value::<u128>()
    }

    fn ensure_claim_manager_caller(&self, context: &Context) -> Result<()> {
        let claim_manager = self.claim_manager()?;
        ensure!(
            context.caller == claim_manager,
            "mint is only allowed from the configured claim manager"
        );
        Ok(())
    }

    fn ensure_can_mint(&self, amount: u128) -> Result<()> {
        let next_total = self
            .total_supply()
            .checked_add(amount)
            .ok_or_else(|| anyhow!("mint would overflow total supply"))?;
        ensure!(next_total <= self.cap(), "mint would exceed token cap");
        Ok(())
    }
}

impl MintableToken for EngineToken {}
impl AlkaneResponder for EngineToken {}

impl EngineTokenInterface for EngineToken {
    fn initialize(
        &self,
        claim_manager: AlkaneId,
        cap: u128,
        premine_units: u128,
        name: String,
        symbol: String,
    ) -> Result<CallResponse> {
        self.observe_initialization()?;
        let context = self.context()?;

        ensure!(premine_units <= cap, "premine cannot exceed cap");

        self.set_claim_manager(claim_manager);
        self.set_cap(cap);
        <Self as MintableToken>::set_name_and_symbol_str(self, name, symbol);

        let mut response = CallResponse::forward(&context.incoming_alkanes);
        if premine_units > 0 {
            self.increase_total_supply(premine_units)?;
            response.alkanes.0.push(AlkaneTransfer {
                id: context.myself,
                value: premine_units,
            });
        }

        Ok(response)
    }

    fn mint(&self, token_units: u128) -> Result<CallResponse> {
        let context = self.context()?;
        self.ensure_claim_manager_caller(&context)?;
        self.ensure_can_mint(token_units)?;

        let transfer = <Self as MintableToken>::mint(self, &context, token_units)?;
        let mut response = CallResponse::forward(&context.incoming_alkanes);
        response.alkanes.0.push(transfer);
        Ok(response)
    }

    fn burn(&self) -> Result<CallResponse> {
        let context = self.context()?;
        if context.incoming_alkanes.0.len() != 1 {
            return Err(anyhow!("input must be 1 alkane"));
        }
        if context.myself != context.incoming_alkanes.0[0].id {
            return Err(anyhow!("input must be engine token"));
        }

        self.decrease_total_supply(context.incoming_alkanes.0[0].value)?;
        Ok(CallResponse::default())
    }

    fn get_name(&self) -> Result<CallResponse> {
        let context = self.context()?;
        let mut response = CallResponse::forward(&context.incoming_alkanes);
        response.data = self.name().into_bytes();
        Ok(response)
    }

    fn get_symbol(&self) -> Result<CallResponse> {
        let context = self.context()?;
        let mut response = CallResponse::forward(&context.incoming_alkanes);
        response.data = self.symbol().into_bytes();
        Ok(response)
    }

    fn get_total_supply(&self) -> Result<CallResponse> {
        let context = self.context()?;
        let mut response = CallResponse::forward(&context.incoming_alkanes);
        response.data = self.total_supply().to_le_bytes().to_vec();
        Ok(response)
    }

    fn get_cap(&self) -> Result<CallResponse> {
        let context = self.context()?;
        let mut response = CallResponse::forward(&context.incoming_alkanes);
        response.data = self.cap().to_le_bytes().to_vec();
        Ok(response)
    }

    fn get_claim_manager(&self) -> Result<CallResponse> {
        let context = self.context()?;
        let mut response = CallResponse::forward(&context.incoming_alkanes);
        response.data = Vec::<u8>::from(self.claim_manager()?);
        Ok(response)
    }

    fn get_data(&self) -> Result<CallResponse> {
        let context = self.context()?;
        let mut response = CallResponse::forward(&context.incoming_alkanes);
        response.data = self.data();
        Ok(response)
    }
}