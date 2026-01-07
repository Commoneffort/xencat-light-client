use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Token, TokenAccount, Mint};
use anchor_lang::solana_program::keccak;

declare_id!("2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp");

#[program]
pub mod xencat_burn {
    use super::*;

    /// Initialize the global burn state (call once)
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.global_state;
        state.nonce_counter = 0;
        state.total_burns = 0;
        state.total_amount_burned = 0;
        state.bump = ctx.bumps.global_state;

        msg!("Global burn state initialized");
        Ok(())
    }

    /// Burns XENCAT tokens from user's account
    /// This function is immutable and will work autonomously
    pub fn burn_xencat(ctx: Context<BurnXencat>, amount: u64) -> Result<()> {
        // Validate amount
        require!(amount > 0, ErrorCode::InvalidAmount);

        // Get current timestamp
        let clock = Clock::get()?;
        let timestamp = clock.unix_timestamp as u64;

        // Increment nonce counter
        let state = &mut ctx.accounts.global_state;
        let nonce = state.nonce_counter;
        state.nonce_counter = state.nonce_counter.checked_add(1)
            .ok_or(ErrorCode::NonceOverflow)?;
        state.total_burns = state.total_burns.checked_add(1)
            .ok_or(ErrorCode::CounterOverflow)?;
        state.total_amount_burned = state.total_amount_burned.checked_add(amount)
            .ok_or(ErrorCode::AmountOverflow)?;

        // Create hash of (user, amount, nonce) for relayer verification
        let user_bytes = ctx.accounts.user.key().to_bytes();
        let amount_bytes = amount.to_le_bytes();
        let nonce_bytes = nonce.to_le_bytes();

        let mut hash_data = Vec::new();
        hash_data.extend_from_slice(&user_bytes);
        hash_data.extend_from_slice(&amount_bytes);
        hash_data.extend_from_slice(&nonce_bytes);

        let record_hash = keccak::hash(&hash_data).to_bytes();

        // Store burn record in PDA
        let burn_record = &mut ctx.accounts.burn_record;
        burn_record.user = ctx.accounts.user.key();
        burn_record.amount = amount;
        burn_record.nonce = nonce;
        burn_record.timestamp = timestamp;
        burn_record.record_hash = record_hash;
        burn_record.bump = ctx.bumps.burn_record;

        // Perform the burn through token program
        let cpi_accounts = Burn {
            mint: ctx.accounts.xencat_mint.to_account_info(),
            from: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        token::burn(cpi_ctx, amount)?;

        // Emit burn event for relayer
        emit!(Burned {
            user: ctx.accounts.user.key(),
            amount,
            nonce,
            timestamp,
        });

        msg!("Burned {} tokens from {} (nonce: {}, hash: {:?})",
             amount,
             ctx.accounts.user.key(),
             nonce,
             record_hash);

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Global state PDA for tracking nonces
    #[account(
        init,
        payer = authority,
        space = 8 + GlobalState::INIT_SPACE,
        seeds = [b"global_state"],
        bump
    )]
    pub global_state: Account<'info, GlobalState>,

    /// Authority initializing the program (pays for PDA)
    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BurnXencat<'info> {
    /// User burning tokens
    #[account(mut)]
    pub user: Signer<'info>,

    /// Global state for nonce tracking
    #[account(
        mut,
        seeds = [b"global_state"],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,

    /// Burn record PDA (stores hash for relayer verification)
    #[account(
        init,
        payer = user,
        space = 8 + BurnRecord::INIT_SPACE,
        seeds = [b"burn_record", global_state.nonce_counter.to_le_bytes().as_ref()],
        bump
    )]
    pub burn_record: Account<'info, BurnRecord>,

    /// Token mint to burn from
    /// For mainnet: 7UN8WkBumTUCofVPXCPjNWQ6msQhzrg9tFQRP48Nmw5V (XENCAT)
    /// For devnet: Pass any test token mint
    #[account(mut)]
    pub xencat_mint: Account<'info, Mint>,

    /// User's token account
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ ErrorCode::InvalidOwner,
        constraint = user_token_account.mint == xencat_mint.key() @ ErrorCode::InvalidMint,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Token program
    pub token_program: Program<'info, Token>,

    pub system_program: Program<'info, System>,
}

/// Global state tracking burn nonces
#[account]
#[derive(InitSpace)]
pub struct GlobalState {
    pub nonce_counter: u64,
    pub total_burns: u64,
    pub total_amount_burned: u64,
    pub bump: u8,
}

/// Individual burn record with hash for relayer verification
#[account]
#[derive(InitSpace)]
pub struct BurnRecord {
    pub user: Pubkey,
    pub amount: u64,
    pub nonce: u64,
    pub timestamp: u64,
    pub record_hash: [u8; 32],  // keccak256(user || amount || nonce)
    pub bump: u8,
}

/// Event emitted when tokens are burned (for relayer)
#[event]
pub struct Burned {
    pub user: Pubkey,
    pub amount: u64,
    pub nonce: u64,
    pub timestamp: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid amount: must be greater than 0")]
    InvalidAmount,
    #[msg("Invalid owner: token account must be owned by user")]
    InvalidOwner,
    #[msg("Invalid mint: token account mint doesn't match provided mint")]
    InvalidMint,
    #[msg("Nonce counter overflow")]
    NonceOverflow,
    #[msg("Burn counter overflow")]
    CounterOverflow,
    #[msg("Amount overflow")]
    AmountOverflow,
}
