use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::LightClientError;
use crate::verification::verify_burn_proof;
use crate::BurnProof;

#[derive(Accounts)]
pub struct VerifyProof<'info> {
    #[account(
        seeds = [b"light_client_state"],
        bump = light_client_state.bump
    )]
    pub light_client_state: Account<'info, LightClientState>,

    #[account(
        seeds = [b"validator_set"],
        bump
    )]
    pub validator_set: Account<'info, ValidatorSet>,

    #[account(mut)]
    pub fee_payer: Signer<'info>,

    /// CHECK: Fee receiver account (verified via address constraint)
    #[account(mut, address = light_client_state.fee_receiver)]
    pub fee_receiver: AccountInfo<'info>,

    /// CHECK: Instructions sysvar for Ed25519 signature verification
    /// This is required to introspect Ed25519Program instructions
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// Verify a Solana burn proof with FULL CRYPTOGRAPHIC VERIFICATION
///
/// This is the main entry point for proof verification. It:
/// 1. Verifies Ed25519 signatures cryptographically via native syscalls
/// 2. Verifies Merkle proof of burn record inclusion
/// 3. Collects the verification fee
/// 4. Returns success/failure
///
/// SECURITY: TRUSTLESS CRYPTOGRAPHIC VERIFICATION
/// - Ed25519 signatures verified via Solana's native Ed25519Program precompile
/// - No shortcuts, no "economic security" assumptions
/// - Pure mathematics and cryptography
///
/// Requirements:
/// - Transaction MUST include Ed25519Program instructions before this instruction
/// - One Ed25519 instruction per validator signature (3-7 validators)
/// - Ed25519 instructions must be at indices 0, 1, 2, ... (before verify_proof)
///
/// Compute Budget: Target <50,000 CU
/// - Ed25519 verification: ~3,000 CU × 3 validators = ~9,000 CU
/// - Merkle verification: ~10,000 CU
/// - Logic & fee collection: ~10,000 CU
/// - Total: ~30,000 CU (well under limit!)
pub fn handler(ctx: Context<VerifyProof>, proof: BurnProof) -> Result<()> {
    let state = &ctx.accounts.light_client_state;
    let validator_set = &ctx.accounts.validator_set;

    msg!("╔════════════════════════════════════════╗");
    msg!("║   XENCAT Light Client - Proof Verify  ║");
    msg!("║      🔒 CRYPTOGRAPHIC VERIFICATION     ║");
    msg!("╚════════════════════════════════════════╝");

    // CRITICAL SECURITY: Perform FULL cryptographic verification
    // This verifies:
    // - Ed25519 signatures from validators (via native Ed25519Program)
    // - Stake threshold met (BFT consensus)
    // - Merkle proof of burn record (state inclusion)
    //
    // Ed25519Program instructions start at index 0
    // Format: [Ed25519, Ed25519, Ed25519, verify_proof]
    let ed25519_ix_offset = 0u16;

    let verification_result = crate::verification::verify_burn_proof_legacy(
        &proof,
        validator_set,
        state.total_stake,
        &ctx.accounts.instructions,
        ed25519_ix_offset,
    )?;

    // Ensure verification passed
    require!(
        verification_result.verified,
        LightClientError::InvalidProofData
    );

    msg!("Verification Summary:");
    msg!("  • Validators: {}", verification_result.validator_count);
    msg!("  • Verified Stake: {} ({:.2}%)",
         verification_result.verified_stake,
         (verification_result.verified_stake as f64 / state.total_stake as f64) * 100.0);
    msg!("  • Consensus: {}", verification_result.consensus_reached);
    msg!("  • Merkle Valid: {}", verification_result.merkle_valid);

    // Collect verification fee
    // This incentivizes running the light client and covers compute costs
    collect_verification_fee(
        &ctx.accounts.fee_payer,
        &ctx.accounts.fee_receiver,
        &ctx.accounts.system_program,
        state.verification_fee,
    )?;

    msg!("╔════════════════════════════════════════╗");
    msg!("║        ✓ VERIFICATION PASSED          ║");
    msg!("╚════════════════════════════════════════╝");

    Ok(())
}

/// Collect verification fee from the caller
///
/// This fee:
/// 1. Covers compute costs (~85,000 CU × ~0.000005 SOL/CU = 0.000425 SOL)
/// 2. Incentivizes running the light client infrastructure
/// 3. Prevents spam attacks
///
/// Default: 0.001 XNT (1,000,000 lamports with 6 decimals)
fn collect_verification_fee<'info>(
    fee_payer: &Signer<'info>,
    fee_receiver: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    fee_amount: u64,
) -> Result<()> {
    if fee_amount == 0 {
        msg!("No verification fee required");
        return Ok(());
    }

    let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
        fee_payer.key,
        fee_receiver.key,
        fee_amount,
    );

    anchor_lang::solana_program::program::invoke(
        &transfer_ix,
        &[
            fee_payer.to_account_info(),
            fee_receiver.to_account_info(),
            system_program.clone(),
        ],
    )?;

    msg!("✓ Verification fee collected: {} lamports", fee_amount);

    Ok(())
}
