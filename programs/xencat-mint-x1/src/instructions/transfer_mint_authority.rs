use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, SetAuthority, Token};
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct TransferMintAuthority<'info> {
    /// Legacy mint state (V1 - used for PDA signing only)
    /// CHECK: Only used as PDA signer, not deserialized
    #[account(
        mut,
        seeds = [b"mint_state"],
        bump
    )]
    pub legacy_mint_state: AccountInfo<'info>,

    /// New mint state (V2)
    #[account(
        seeds = [b"mint_state_v2"],
        bump = new_mint_state.bump
    )]
    pub new_mint_state: Account<'info, MintState>,

    /// XENCAT mint (authority will be transferred)
    #[account(
        mut,
        seeds = [b"xencat_mint"],
        bump,
        constraint = xencat_mint.mint_authority.contains(&legacy_mint_state.key()) @ MintError::InvalidMintAuthority
    )]
    pub xencat_mint: Account<'info, Mint>,

    /// Authority (must be authorized to execute migration)
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<TransferMintAuthority>) -> Result<()> {
    msg!("╔════════════════════════════════════════╗");
    msg!("║   TRANSFERRING MINT AUTHORITY (V1→V2)  ║");
    msg!("╚════════════════════════════════════════╝");

    msg!("Old authority: {}", ctx.accounts.legacy_mint_state.key());
    msg!("New authority: {}", ctx.accounts.new_mint_state.key());

    // Transfer mint authority from legacy_mint_state to new_mint_state_v2
    let legacy_bump = ctx.bumps.legacy_mint_state;

    token::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            SetAuthority {
                current_authority: ctx.accounts.legacy_mint_state.to_account_info(),
                account_or_mint: ctx.accounts.xencat_mint.to_account_info(),
            },
            &[&[
                b"mint_state",
                &[legacy_bump]
            ]],
        ),
        anchor_spl::token::spl_token::instruction::AuthorityType::MintTokens,
        Some(ctx.accounts.new_mint_state.key()),
    )?;

    msg!("✅ Authority transferred successfully");
    msg!("✅ Legacy mint_state can no longer mint");
    msg!("   Only mint_state_v2 can mint tokens now");

    msg!("╔════════════════════════════════════════╗");
    msg!("║         MIGRATION COMPLETE             ║");
    msg!("╚════════════════════════════════════════╝");

    Ok(())
}
