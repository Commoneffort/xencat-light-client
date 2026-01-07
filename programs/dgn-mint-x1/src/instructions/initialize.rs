use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + MintState::INIT_SPACE,
        seeds = [b"dgn_mint_state"],
        bump
    )]
    pub mint_state: Account<'info, MintState>,

    /// DGN mint (must already exist, validated for correctness)
    pub dgn_mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<Initialize>, light_client_program: Pubkey) -> Result<()> {
    let state = &mut ctx.accounts.mint_state;

    // Validate mint has 6 decimals
    require!(
        ctx.accounts.dgn_mint.decimals == 6,
        MintError::InvalidMintDecimals
    );

    state.authority = ctx.accounts.authority.key();
    state.dgn_mint = ctx.accounts.dgn_mint.key();
    state.fee_per_validator = 10_000_000; // 0.01 XNT per validator (9 decimals)
    state.light_client_program = light_client_program;
    state.validator_set_version = 1; // Start at version 1
    state.processed_burns_count = 0;
    state.total_minted = 0;
    state.bump = ctx.bumps.mint_state;

    msg!("DGN mint program initialized");
    msg!("Authority: {}", state.authority);
    msg!("DGN mint: {}", state.dgn_mint);
    msg!("Light client program: {}", state.light_client_program);
    msg!("Validator set version: {}", state.validator_set_version);
    msg!("Fee per validator: {} lamports (0.01 XNT)", state.fee_per_validator);

    Ok(())
}
