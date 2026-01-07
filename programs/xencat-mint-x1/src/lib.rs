use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

pub mod instructions;
pub mod state;
pub mod errors;

use instructions::*;

declare_id!("8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk");

#[program]
pub mod xencat_mint_x1 {
    use super::*;

    /// Initialize the mint program
    pub fn initialize(ctx: Context<Initialize>, light_client_program: Pubkey) -> Result<()> {
        instructions::initialize::handler(ctx, light_client_program)
    }

    /// Mint XENCAT tokens from verified proof (Transaction 2)
    /// Reads proof from ProofStorage PDA (created in Transaction 1)
    pub fn mint_from_burn<'info>(ctx: Context<'_, '_, '_, 'info, MintFromBurn<'info>>, burn_nonce: u64) -> Result<()> {
        instructions::mint_from_burn::handler(ctx, burn_nonce)
    }

    /// Mint XENCAT tokens from asset-aware verified burn (V3)
    ///
    /// This is the V3 version that enforces asset_id validation.
    /// It only works with VerifiedBurnV3 PDAs created by submit_burn_attestation_v3.
    ///
    /// CRITICAL: This instruction enforces asset_id == XENCAT (1)
    pub fn mint_from_burn_v3<'info>(
        ctx: Context<'_, '_, '_, 'info, MintFromBurnV3<'info>>,
        burn_nonce: u64,
        asset_id: u8,
    ) -> Result<()> {
        instructions::mint_from_burn_v3::handler(ctx, burn_nonce, asset_id)
    }

    /// One-time transfer of mint authority from V1 to V2 (migration)
    pub fn transfer_mint_authority(ctx: Context<TransferMintAuthority>) -> Result<()> {
        instructions::transfer_mint_authority::handler(ctx)
    }

    /// Create token metadata using MintState PDA authority
    pub fn create_metadata(
        ctx: Context<CreateMetadata>,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        instructions::create_metadata::handler(ctx, name, symbol, uri)
    }
}
