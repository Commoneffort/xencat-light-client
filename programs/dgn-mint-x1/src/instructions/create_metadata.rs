use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};
use mpl_token_metadata::{
    ID as TOKEN_METADATA_PROGRAM_ID,
    accounts::Metadata,
    instructions::CreateMetadataAccountV3CpiBuilder,
    types::DataV2,
};
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct CreateMetadata<'info> {
    /// Mint program state - has authority over DGN mint
    #[account(
        mut,
        seeds = [b"dgn_mint_state"],
        bump = mint_state.bump,
        has_one = authority @ MintError::Unauthorized,
    )]
    pub mint_state: Account<'info, MintState>,

    /// DGN token mint on X1
    #[account(
        mut,
        address = mint_state.dgn_mint
    )]
    pub dgn_mint: Account<'info, Mint>,

    /// Metadata account to be created (PDA derived from mint)
    /// CHECK: This account is created by the Metaplex program
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    /// Authority of mint_state (must sign)
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Payer for metadata account rent
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Token Metadata Program
    /// CHECK: This is the Metaplex Token Metadata program
    #[account(address = TOKEN_METADATA_PROGRAM_ID)]
    pub token_metadata_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Create token metadata using mint authority (MintState PDA)
///
/// This instruction allows the MintState authority to create metadata
/// for the DGN token using the PDA's mint authority.
///
/// Parameters:
/// - name: Token name (e.g., "Degen")
/// - symbol: Token symbol (e.g., "DGN")
/// - uri: Metadata URI (JSON file with logo, description, etc.)
pub fn handler(
    ctx: Context<CreateMetadata>,
    name: String,
    symbol: String,
    uri: String,
) -> Result<()> {
    msg!("Creating token metadata");
    msg!("  Name: {}", name);
    msg!("  Symbol: {}", symbol);
    msg!("  URI: {}", uri);

    // Create metadata using MintState PDA as mint authority
    let bump_seed = [ctx.accounts.mint_state.bump];
    let mint_state_seeds: &[&[u8]] = &[
        b"dgn_mint_state",
        &bump_seed,
    ];

    CreateMetadataAccountV3CpiBuilder::new(&ctx.accounts.token_metadata_program.to_account_info())
        .metadata(&ctx.accounts.metadata.to_account_info())
        .mint(&ctx.accounts.dgn_mint.to_account_info())
        .mint_authority(&ctx.accounts.mint_state.to_account_info())
        .payer(&ctx.accounts.payer.to_account_info())
        .update_authority(&ctx.accounts.mint_state.to_account_info(), true)
        .system_program(&ctx.accounts.system_program.to_account_info())
        .rent(Some(&ctx.accounts.rent.to_account_info()))
        .data(DataV2 {
            name,
            symbol,
            uri,
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        })
        .is_mutable(true)
        .invoke_signed(&[mint_state_seeds])?;

    msg!("✅ Token metadata created successfully");

    Ok(())
}
