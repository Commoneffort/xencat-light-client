use anchor_lang::prelude::*;
use crate::state::X1ValidatorSet;
use std::str::FromStr;

#[derive(Accounts)]
pub struct InitializeValidatorSet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + X1ValidatorSet::INIT_SPACE,
        seeds = [b"x1_validator_set_v2"],
        bump
    )]
    pub validator_set: Account<'info, X1ValidatorSet>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeValidatorSet>,
    threshold: u8,
) -> Result<()> {
    msg!("🔧 Initializing X1 Validator Set V2 (Trustless)");

    let validator_set = &mut ctx.accounts.validator_set;

    // X1 Mainnet Validators - Pure pubkeys (no metadata)
    validator_set.validators = vec![
        Pubkey::from_str("9oa7NAscCZ1kCQFZJng9gfwvDzrEvyWgx4F244PHmHPH")
            .map_err(|_| error!(crate::errors::LightClientError::InvalidValidator))?,
        Pubkey::from_str("8byEUEZ2sMfP6RPX9VD8JCvCQK3F5FG2LytcR9TkVWag")
            .map_err(|_| error!(crate::errors::LightClientError::InvalidValidator))?,
        Pubkey::from_str("5NfpgFCwrYzcgJkda9bRJvccycLUo3dvVQsVAK2W43Um")
            .map_err(|_| error!(crate::errors::LightClientError::InvalidValidator))?,
        Pubkey::from_str("GdbXi56fCSQ1joCvGjqm7JKvqvwgtKh6xeusUqZbB3rH")
            .map_err(|_| error!(crate::errors::LightClientError::InvalidValidator))?,
        Pubkey::from_str("FmuuFgRh8NP8UD7QHg86f7vu7qpsmr1wE7hB59oojDpj")
            .map_err(|_| error!(crate::errors::LightClientError::InvalidValidator))?,
    ];

    validator_set.version = 1; // Start at version 1
    validator_set.threshold = threshold; // 3 of 5 (Byzantine fault tolerant)
    validator_set.bump = ctx.bumps.validator_set;

    msg!("✅ Validator set initialized");
    msg!("   Version: {}", validator_set.version);
    msg!("   Validators: {}", validator_set.validators.len());
    msg!("   Threshold: {}", threshold);

    Ok(())
}
