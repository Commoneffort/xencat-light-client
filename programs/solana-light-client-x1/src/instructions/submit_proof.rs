use anchor_lang::prelude::*;
use crate::state::{VerifiedBurn, ValidatorConfig, LightClientState};
use crate::{BurnProof, verification_new};

#[derive(Accounts)]
#[instruction(proof: BurnProof)]
pub struct SubmitProof<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// Verified burn PDA (stores minimal verification result)
    #[account(
        init,
        payer = user,
        space = 8 + VerifiedBurn::INIT_SPACE,
        seeds = [
            b"verified_burn",
            user.key().as_ref(),
            proof.burn_nonce.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub verified_burn: Account<'info, VerifiedBurn>,

    /// Validator configuration
    #[account(
        seeds = [b"validator_config"],
        bump = validator_config.bump
    )]
    pub validator_config: Account<'info, ValidatorConfig>,

    /// Light client state
    #[account(
        seeds = [b"light_client_state"],
        bump = light_client_state.bump
    )]
    pub light_client_state: Account<'info, LightClientState>,

    /// Instructions sysvar (for Ed25519 verification)
    /// CHECK: This is the instructions sysvar
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// Submit and verify burn proof (Transaction 1)
///
/// This instruction:
/// 1. Performs full Ed25519 cryptographic verification
/// 2. Verifies validator signatures, stake thresholds, Merkle proofs
/// 3. Stores ONLY the verification result (minimal data)
///
/// Security: Full verification occurs here
/// Storage: Minimal (only 58 bytes)
/// Next step: TX2 reads verified result and mints tokens
pub fn handler(ctx: Context<SubmitProof>, proof: BurnProof) -> Result<()> {
    msg!("🔐 Submitting proof for burn nonce {}", proof.burn_nonce);

    // SECURITY CRITICAL: Full cryptographic verification
    // - Ed25519 signatures already verified by Ed25519Program
    // - Extract validator identities from Ed25519 instructions
    // - Validator set membership check
    // - Stake threshold verification (>66%)
    // - Merkle proof of burn record
    verification_new::verify_burn_proof_minimal(
        &proof,
        &ctx.accounts.validator_config,
        &ctx.accounts.instructions,
        0, // ed25519_ix_offset
    )?;

    msg!("✅ Proof verified! Storing verification result...");

    // Store ONLY verification result (minimal data)
    let verified_burn_key = ctx.accounts.verified_burn.key();
    let verified = &mut ctx.accounts.verified_burn;
    verified.burn_nonce = proof.burn_nonce;
    verified.user = ctx.accounts.user.key();
    verified.amount = proof.amount;  // Verified amount from proof
    verified.verified_at = Clock::get()?.unix_timestamp;
    verified.processed = false;  // Not yet minted
    verified.bump = ctx.bumps.verified_burn;

    msg!("✅ Verification result stored in PDA: {}", verified_burn_key);
    msg!("   Nonce: {}", verified.burn_nonce);
    msg!("   User: {}", verified.user);
    msg!("   Amount: {}", verified.amount);
    msg!("   Size: {} bytes (vs 831 bytes for full proof)", VerifiedBurn::LEN);

    Ok(())
}
