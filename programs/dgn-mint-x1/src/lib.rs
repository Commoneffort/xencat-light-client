use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;
pub mod errors;

use instructions::*;

declare_id!("4YPipW8txxY3N7gHdj4NLhu8YxybHgarx5dJQCdCnQHs");

#[program]
pub mod dgn_mint_x1 {
    use super::*;

    /// Initialize the DGN mint program
    pub fn initialize(ctx: Context<Initialize>, light_client_program: Pubkey) -> Result<()> {
        instructions::initialize::handler(ctx, light_client_program)
    }

    /// Mint DGN tokens from asset-aware verified burn (V3)
    ///
    /// This instruction enforces asset_id validation.
    /// It only works with VerifiedBurnV3 PDAs created by submit_burn_attestation_v3.
    ///
    /// CRITICAL: This instruction enforces asset_id == DGN (2)
    pub fn mint_from_burn_v3<'info>(
        ctx: Context<'_, '_, '_, 'info, MintFromBurnV3<'info>>,
        burn_nonce: u64,
        asset_id: u8,
    ) -> Result<()> {
        instructions::mint_from_burn_v3::handler(ctx, burn_nonce, asset_id)
    }

    /// Create token metadata for DGN token
    ///
    /// This instruction creates Metaplex metadata for the DGN token.
    /// Only the mint_state authority can call this instruction.
    pub fn create_metadata(
        ctx: Context<CreateMetadata>,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        instructions::create_metadata::handler(ctx, name, symbol, uri)
    }
}
