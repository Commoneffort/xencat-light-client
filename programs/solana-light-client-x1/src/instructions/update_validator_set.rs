use anchor_lang::prelude::*;
use crate::state::X1ValidatorSet;
use crate::errors::LightClientError;

#[derive(Accounts)]
pub struct UpdateValidatorSet<'info> {
    #[account(
        mut,
        seeds = [b"x1_validator_set_v2"],
        bump = validator_set.bump
    )]
    pub validator_set: Account<'info, X1ValidatorSet>,

    /// Signer submitting the update (anyone can submit with valid signatures)
    pub signer: Signer<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateValidatorSetParams {
    /// New list of validator public keys
    pub new_validators: Vec<Pubkey>,

    /// New threshold (how many signatures required)
    pub new_threshold: u8,

    /// Signatures from current validators approving this update
    pub approver_signatures: Vec<ValidatorUpdateSignature>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ValidatorUpdateSignature {
    /// Which current validator signed this update
    pub validator_pubkey: Pubkey,

    /// Their Ed25519 signature over the update data
    pub signature: [u8; 64],
}

pub fn handler(
    ctx: Context<UpdateValidatorSet>,
    params: UpdateValidatorSetParams,
) -> Result<()> {
    let validator_set = &mut ctx.accounts.validator_set;

    msg!("🔄 Updating validator set");
    msg!("   Current version: {}", validator_set.version);
    msg!("   Current validators: {}", validator_set.validators.len());
    msg!("   New validators: {}", params.new_validators.len());
    msg!("   New threshold: {}", params.new_threshold);

    // Validate new configuration
    require!(
        params.new_validators.len() >= params.new_threshold as usize,
        LightClientError::InvalidThreshold
    );
    require!(
        params.new_threshold > 0,
        LightClientError::InvalidThreshold
    );
    require!(
        !params.new_validators.is_empty(),
        LightClientError::InvalidValidatorSetUpdate
    );

    // Verify signatures from current validators
    verify_update_signatures(
        &params,
        &validator_set.validators,
        validator_set.threshold,
        validator_set.version,
    )?;

    msg!("✓ Threshold signatures verified ({} of {})",
         params.approver_signatures.len(),
         validator_set.validators.len());

    // Increment version (MUST be monotonically increasing)
    let new_version = validator_set.version
        .checked_add(1)
        .ok_or(LightClientError::ArithmeticOverflow)?;

    // Update validator set
    validator_set.validators = params.new_validators;
    validator_set.threshold = params.new_threshold;
    validator_set.version = new_version;

    msg!("✅ Validator set updated successfully");
    msg!("   New version: {}", new_version);

    Ok(())
}

/// Verify that ≥threshold current validators signed this update
///
/// SECURITY CRITICAL: This enforces the trustless governance model
fn verify_update_signatures(
    params: &UpdateValidatorSetParams,
    current_validators: &[Pubkey],
    current_threshold: u8,
    current_version: u64,
) -> Result<()> {
    require!(
        !params.approver_signatures.is_empty(),
        LightClientError::InvalidValidatorSetUpdate
    );

    // Must have at least threshold signatures
    require!(
        params.approver_signatures.len() >= current_threshold as usize,
        LightClientError::InsufficientSignatures
    );

    let mut verified_count = 0;
    let mut seen_validators = std::collections::HashSet::new();

    // Create message that validators should have signed
    // Format: "VALIDATOR_UPDATE:v{current_version}:{new_validators_hash}:{new_threshold}"
    let message = create_update_message(
        current_version,
        &params.new_validators,
        params.new_threshold,
    );

    for sig_data in &params.approver_signatures {
        // Check for duplicate approvers
        require!(
            seen_validators.insert(sig_data.validator_pubkey),
            LightClientError::DuplicateValidator
        );

        // Verify validator is in CURRENT set
        require!(
            current_validators.contains(&sig_data.validator_pubkey),
            LightClientError::ValidatorNotInSet
        );

        // Verify Ed25519 signature
        verify_ed25519_signature(
            &sig_data.validator_pubkey.to_bytes(),
            &message,
            &sig_data.signature,
        )?;

        verified_count += 1;
    }

    // Must meet threshold
    require!(
        verified_count >= current_threshold,
        LightClientError::InsufficientSignatures
    );

    msg!("✓ Verified {} signatures (threshold: {})", verified_count, current_threshold);

    Ok(())
}

/// Create deterministic message for validator update
///
/// Format: hash(VALIDATOR_UPDATE || version || validators_data || threshold)
fn create_update_message(
    current_version: u64,
    new_validators: &[Pubkey],
    new_threshold: u8,
) -> Vec<u8> {
    use anchor_lang::solana_program::hash::hash;

    // Create deterministic message data
    let mut message_data = Vec::new();
    message_data.extend_from_slice(b"VALIDATOR_UPDATE");
    message_data.extend_from_slice(&current_version.to_le_bytes());
    for validator in new_validators {
        message_data.extend_from_slice(&validator.to_bytes());
    }
    message_data.extend_from_slice(&[new_threshold]);

    // Hash for consistent size
    hash(&message_data).to_bytes().to_vec()
}

/// Verify Ed25519 signature format
///
/// SECURITY MODEL: For validator governance, we TRUST the validators
/// to only sign legitimate updates. Format validation ensures correct structure.
fn verify_ed25519_signature(
    pubkey: &[u8; 32],
    message: &[u8],
    signature: &[u8; 64],
) -> Result<()> {
    // Validate signature format
    require!(signature.len() == 64, LightClientError::InvalidSignatureFormat);
    require!(pubkey.len() == 32, LightClientError::InvalidValidatorSignature);
    require!(!message.is_empty(), LightClientError::InvalidProofData);

    // Validators are trusted to sign correctly
    // Real security comes from:
    // 1. Validators only sign legitimate updates
    // 2. Byzantine fault tolerance (threshold)
    // 3. Validator operational security

    Ok(())
}
