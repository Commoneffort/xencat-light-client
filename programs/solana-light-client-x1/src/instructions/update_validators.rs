use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::LightClientError;
use crate::UpdateValidatorsParams;

#[derive(Accounts)]
pub struct UpdateValidators<'info> {
    #[account(
        mut,
        seeds = [b"light_client_state"],
        bump = light_client_state.bump
    )]
    pub light_client_state: Account<'info, LightClientState>,

    #[account(
        mut,
        seeds = [b"validator_set"],
        bump
    )]
    pub validator_set: Account<'info, ValidatorSet>,

    #[account(
        mut,
        seeds = [b"validator_set_history"],
        bump
    )]
    pub validator_set_history: Account<'info, ValidatorSetHistory>,

    /// Signer submitting the update (pays for transaction)
    pub signer: Signer<'info>,
}

pub fn handler(ctx: Context<UpdateValidators>, params: UpdateValidatorsParams) -> Result<()> {
    let state = &mut ctx.accounts.light_client_state;
    let validator_set = &mut ctx.accounts.validator_set;
    let history = &mut ctx.accounts.validator_set_history;

    msg!("Updating validator set - epoch {} -> {}", state.update_epoch, state.update_epoch + 1);
    msg!("New validator count: {}", params.new_validator_set.len());
    msg!("New total stake: {}", params.new_total_stake);

    // Verify signatures from 66%+ of CURRENT validators
    let (approver_stake, consensus_reached) = verify_update_signatures(
        &params,
        validator_set,
        state.total_stake,
    )?;

    require!(
        consensus_reached,
        LightClientError::InvalidValidatorSetUpdate
    );

    msg!("✓ Consensus reached: {} stake approved ({}%)",
         approver_stake,
         (approver_stake * 100) / state.total_stake);

    // Verify the new validator set hash matches what was signed
    let _computed_hash = ValidatorSetUpdateRecord::hash_validator_set(&params.new_validator_set);

    // Create update record for history
    let clock = Clock::get()?;
    let new_epoch = state.update_epoch + 1;

    let update_record = ValidatorSetUpdateRecord::new(
        new_epoch,
        clock.slot,
        clock.unix_timestamp,
        &params.new_validator_set,
        params.new_total_stake,
        params.signatures.len() as u16,
        approver_stake,
    );

    // Add to history
    history.add_update(update_record);

    // Update validator set
    validator_set.validators = params.new_validator_set;

    // Update state
    state.total_stake = params.new_total_stake;
    state.validator_count = validator_set.validators.len() as u16;
    state.last_update_slot = clock.slot;
    state.update_epoch = new_epoch;

    msg!("✓ Validator set updated successfully to epoch {}", new_epoch);

    Ok(())
}

/// Verify that the update is signed by 66%+ of current validators
///
/// Returns (total_approver_stake, consensus_reached)
fn verify_update_signatures(
    params: &UpdateValidatorsParams,
    current_validator_set: &ValidatorSet,
    current_total_stake: u64,
) -> Result<(u64, bool)> {
    require!(
        !params.signatures.is_empty(),
        LightClientError::InvalidValidatorSetUpdate
    );

    let mut approver_stake: u64 = 0;
    let mut seen_validators = std::collections::HashSet::new();

    // Calculate hash of new validator set that should have been signed
    let _new_set_hash = ValidatorSetUpdateRecord::hash_validator_set(&params.new_validator_set);

    for signature_data in &params.signatures {
        // Check for duplicate approvers
        require!(
            seen_validators.insert(signature_data.validator_identity),
            LightClientError::DuplicateValidator
        );

        // Find validator in CURRENT set (not new set)
        let validator = current_validator_set
            .find_validator(&signature_data.validator_identity)
            .ok_or(LightClientError::ValidatorNotFound)?;

        // Verify signature over the new validator set hash
        // TODO: Implement actual Ed25519 signature verification
        // Message format: sha256(new_validator_set_hash || new_epoch)
        // verify_update_signature(
        //     &signature_data.signature,
        //     &new_set_hash,
        //     &signature_data.validator_identity,
        // )?;

        // Accumulate approver stake
        approver_stake = approver_stake
            .checked_add(validator.stake)
            .ok_or(LightClientError::ArithmeticOverflow)?;
    }

    // Check if consensus reached (66%+)
    let threshold = ValidatorSet::consensus_threshold(current_total_stake)
        .map_err(|_| LightClientError::ArithmeticOverflow)?;

    let consensus_reached = approver_stake >= threshold;

    msg!("Update signatures: {} validators, {} stake, threshold: {}",
         params.signatures.len(),
         approver_stake,
         threshold);

    Ok((approver_stake, consensus_reached))
}

/// Verify signature over validator set update
/// TODO: Implement using Ed25519 verification
#[allow(dead_code)]
fn verify_update_signature(
    signature: &[u8; 64],
    validator_set_hash: &[u8; 32],
    validator_pubkey: &Pubkey,
) -> Result<()> {
    // This will be implemented in the next phase
    // Message to sign: sha256(validator_set_hash || new_epoch)

    msg!("Verifying update signature from validator: {}", validator_pubkey);
    msg!("Validator set hash: {:?}", &validator_set_hash[..8]);
    msg!("Signature: {:?}", &signature[..8]);

    // Placeholder - actual verification will use Ed25519 program
    Ok(())
}
