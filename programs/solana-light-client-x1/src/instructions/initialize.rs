use anchor_lang::prelude::*;
use crate::state::*;
use crate::InitializeParams;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + LightClientState::INIT_SPACE,
        seeds = [b"light_client_state"],
        bump
    )]
    pub light_client_state: Account<'info, LightClientState>,

    #[account(
        init,
        payer = authority,
        space = ValidatorSet::INITIAL_SIZE,
        seeds = [b"validator_set"],
        bump
    )]
    pub validator_set: Account<'info, ValidatorSet>,

    #[account(
        init,
        payer = authority,
        space = ValidatorSetHistory::SIZE,
        seeds = [b"validator_set_history"],
        bump
    )]
    pub validator_set_history: Account<'info, ValidatorSetHistory>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
    let state = &mut ctx.accounts.light_client_state;
    let validator_set = &mut ctx.accounts.validator_set;
    let history = &mut ctx.accounts.validator_set_history;

    // Initialize light client state
    state.authority = ctx.accounts.authority.key();
    state.fee_receiver = ctx.accounts.authority.key();
    state.verification_fee = 1_000_000; // 0.001 XNT (6 decimals)
    state.total_stake = params.total_stake;
    state.validator_count = params.validator_set.len() as u16;
    state.last_update_slot = Clock::get()?.slot;
    state.update_epoch = 0; // Genesis
    state.bump = ctx.bumps.light_client_state;

    // Initialize validator set
    validator_set.validators = params.validator_set.clone();

    // Initialize history with genesis record
    history.updates = Vec::new();
    history.current_index = 0;
    history.total_updates = 0;

    let clock = Clock::get()?;
    let genesis_record = ValidatorSetUpdateRecord::new(
        0, // Genesis epoch
        clock.slot,
        clock.unix_timestamp,
        &params.validator_set,
        params.total_stake,
        0, // No approvers for genesis
        0, // No approver stake for genesis
    );

    history.add_update(genesis_record);

    msg!("Light client initialized with {} validators, total stake: {}",
         params.validator_set.len(),
         params.total_stake);

    Ok(())
}
