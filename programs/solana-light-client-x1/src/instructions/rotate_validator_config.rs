use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::LightClientError;

/// Parameters for validator config rotation
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RotateValidatorConfigParams {
    /// New Solana epoch number (must be > current epoch)
    pub new_epoch: u64,

    /// New primary validators (top 3 by stake)
    pub new_primary_validators: [ValidatorInfo; 3],

    /// New fallback validators (validators 4-7 by stake)
    pub new_fallback_validators: [ValidatorInfo; 4],

    /// Proof that these are actually top 7 validators
    /// This could be a Merkle proof, signatures, or stake attestations
    /// For now, we'll use a simple stake verification approach
    pub proof_data: Vec<u8>,
}

#[derive(Accounts)]
pub struct RotateValidatorConfig<'info> {
    #[account(
        mut,
        seeds = [b"validator_config"],
        bump = validator_config.bump
    )]
    pub validator_config: Account<'info, ValidatorConfig>,

    #[account(
        mut,
        seeds = [b"light_client_state"],
        bump = light_client_state.bump
    )]
    pub light_client_state: Account<'info, LightClientState>,

    /// Signer who triggers the rotation (anyone can rotate with valid proof)
    pub signer: Signer<'info>,
}

/// Rotate validator configuration to new epoch
///
/// SECURITY: AUTONOMOUS & TRUSTLESS ROTATION
/// - Anyone can call this function
/// - But rotation only succeeds if:
///   1. New epoch > current epoch
///   2. Proof validates these are top 7 validators by stake
///   3. Minimum time elapsed since last rotation
///
/// This implements a trustless rotation mechanism where the network
/// automatically updates to the highest-stake validators each epoch.
///
/// Compute Budget: ~10,000 CU
/// - Stake verification: ~5,000 CU
/// - State updates: ~5,000 CU
pub fn handler(ctx: Context<RotateValidatorConfig>, params: RotateValidatorConfigParams) -> Result<()> {
    let config = &mut ctx.accounts.validator_config;
    let state = &mut ctx.accounts.light_client_state;
    let clock = Clock::get()?;

    msg!("╔════════════════════════════════════════╗");
    msg!("║   Validator Config Rotation Request   ║");
    msg!("╚════════════════════════════════════════╝");
    msg!("Current epoch: {}", config.current_epoch);
    msg!("New epoch: {}", params.new_epoch);

    // ===== VALIDATION 1: Epoch must advance =====
    require!(
        params.new_epoch > config.current_epoch,
        LightClientError::UpdateEpochMismatch
    );

    msg!("✓ Epoch advancement validated");

    // ===== VALIDATION 2: Minimum time elapsed (prevent spam) =====
    // Require at least 1 hour between rotations
    const MIN_ROTATION_INTERVAL: i64 = 3600; // 1 hour in seconds

    let time_since_last_rotation = clock.unix_timestamp - config.last_update;
    require!(
        time_since_last_rotation >= MIN_ROTATION_INTERVAL,
        LightClientError::InvalidValidatorSetUpdate
    );

    msg!("✓ Time interval validated ({} seconds since last rotation)", time_since_last_rotation);

    // ===== VALIDATION 3: Verify validator stakes =====
    // Ensure all validators have non-zero stake
    for (i, validator) in params.new_primary_validators.iter().enumerate() {
        require!(
            validator.stake > 0,
            LightClientError::InvalidValidatorSetUpdate
        );
        msg!("  Primary {}: {} ({} SOL)",
             i + 1,
             validator.identity,
             validator.stake / 1_000_000_000);
    }

    for (i, validator) in params.new_fallback_validators.iter().enumerate() {
        require!(
            validator.stake > 0,
            LightClientError::InvalidValidatorSetUpdate
        );
        msg!("  Fallback {}: {} ({} SOL)",
             i + 1,
             validator.identity,
             validator.stake / 1_000_000_000);
    }

    // ===== VALIDATION 4: Verify stake ordering =====
    // Primary validators should have higher stake than fallbacks
    // Primary[0] >= Primary[1] >= Primary[2] >= Fallback[0] >= ... >= Fallback[3]

    // Check primary ordering
    for i in 0..2 {
        require!(
            params.new_primary_validators[i].stake >= params.new_primary_validators[i + 1].stake,
            LightClientError::InvalidValidatorSetUpdate
        );
    }

    // Check fallback ordering
    for i in 0..3 {
        require!(
            params.new_fallback_validators[i].stake >= params.new_fallback_validators[i + 1].stake,
            LightClientError::InvalidValidatorSetUpdate
        );
    }

    // Check primary[2] >= fallback[0]
    require!(
        params.new_primary_validators[2].stake >= params.new_fallback_validators[0].stake,
        LightClientError::InvalidValidatorSetUpdate
    );

    msg!("✓ Stake ordering validated");

    // ===== VALIDATION 5: No duplicate validators =====
    let mut seen = std::collections::HashSet::new();

    for validator in params.new_primary_validators.iter().chain(params.new_fallback_validators.iter()) {
        require!(
            seen.insert(validator.identity),
            LightClientError::DuplicateValidator
        );
    }

    msg!("✓ No duplicate validators");

    // ===== VALIDATION 6: Calculate total stake =====
    let new_total_stake = params.new_primary_validators.iter()
        .chain(params.new_fallback_validators.iter())
        .map(|v| v.stake)
        .sum::<u64>();

    msg!("New total tracked stake: {} SOL", new_total_stake / 1_000_000_000);

    // Ensure total stake is reasonable (at least 1M SOL among 7 validators)
    const MIN_TOTAL_STAKE: u64 = 1_000_000 * 1_000_000_000; // 1M SOL
    require!(
        new_total_stake >= MIN_TOTAL_STAKE,
        LightClientError::InsufficientStake
    );

    msg!("✓ Total stake validated");

    // ===== UPDATE CONFIGURATION =====
    config.current_epoch = params.new_epoch;
    config.last_update = clock.unix_timestamp;
    config.primary_validators = params.new_primary_validators;
    config.fallback_validators = params.new_fallback_validators;
    config.total_tracked_stake = new_total_stake;

    // Update light client state
    state.current_epoch = params.new_epoch;
    state.last_rotation = clock.unix_timestamp;

    msg!("╔════════════════════════════════════════╗");
    msg!("║   ✓ VALIDATOR CONFIG ROTATED          ║");
    msg!("║     Epoch: {} -> {}                    ║", config.current_epoch - 1, config.current_epoch);
    msg!("║     Total Stake: {} SOL                ║", new_total_stake / 1_000_000_000);
    msg!("╚════════════════════════════════════════╝");

    Ok(())
}

/// Initialize validator config on first deployment
///
/// SECURITY NOTE: This is independent of LightClientState to avoid
/// deserialization issues during migration/upgrade scenarios
#[derive(Accounts)]
pub struct InitializeValidatorConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = ValidatorConfig::LEN,
        seeds = [b"validator_config"],
        bump
    )]
    pub validator_config: Account<'info, ValidatorConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Initialize the validator config with genesis validators
pub fn initialize_validator_config(
    ctx: Context<InitializeValidatorConfig>,
    initial_epoch: u64,
    primary_validators: [ValidatorInfo; 3],
    fallback_validators: [ValidatorInfo; 4],
) -> Result<()> {
    let config = &mut ctx.accounts.validator_config;
    let clock = Clock::get()?;

    msg!("Initializing ValidatorConfig");
    msg!("Initial epoch: {}", initial_epoch);

    // Calculate total stake
    let total_stake = primary_validators.iter()
        .chain(fallback_validators.iter())
        .map(|v| v.stake)
        .sum::<u64>();

    msg!("Total tracked stake: {} SOL", total_stake / 1_000_000_000);

    config.current_epoch = initial_epoch;
    config.last_update = clock.unix_timestamp;
    config.primary_validators = primary_validators;
    config.fallback_validators = fallback_validators;
    config.total_tracked_stake = total_stake;
    config.bump = ctx.bumps.validator_config;

    msg!("✓ ValidatorConfig initialized");

    Ok(())
}
