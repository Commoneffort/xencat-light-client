use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};
use crate::state::*;
use crate::errors::*;
use solana_light_client_x1::{self, ID as LIGHT_CLIENT_ID, VerifiedBurn, X1ValidatorSet};

#[derive(Accounts)]
#[instruction(burn_nonce: u64)]
pub struct MintFromBurn<'info> {
    /// Mint program state (V2)
    #[account(
        mut,
        seeds = [b"mint_state_v2"],
        bump = mint_state.bump
    )]
    pub mint_state: Account<'info, MintState>,

    /// XENCAT token mint on X1
    #[account(
        mut,
        address = mint_state.xencat_mint
    )]
    pub xencat_mint: Account<'info, Mint>,

    /// Processed burn tracker (prevents replay attacks)
    #[account(
        init,
        payer = user,
        space = 8 + ProcessedBurn::INIT_SPACE,
        seeds = [
            b"processed_burn",
            burn_nonce.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub processed_burn: Account<'info, ProcessedBurn>,

    /// User's token account
    #[account(
        mut,
        constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// User must be signer AND match verified_burn.user
    #[account(mut)]
    pub user: Signer<'info>,

    /// Validator set (from light client) to get list of validators for fee distribution
    /// CHECK: Account ownership and type validated via deserializ ation
    #[account(
        owner = LIGHT_CLIENT_ID,
    )]
    pub validator_set: Account<'info, X1ValidatorSet>,

    /// Verified burn PDA V2 (from light client, created in TX1)
    #[account(
        mut,
        seeds = [
            b"verified_burn_v2",
            user.key().as_ref(),
            burn_nonce.to_le_bytes().as_ref()
        ],
        bump = verified_burn.bump,
        seeds::program = LIGHT_CLIENT_ID,
        constraint = !verified_burn.processed @ MintError::ProofAlreadyProcessed,
        constraint = verified_burn.user == user.key() @ MintError::InvalidUser,
        constraint = verified_burn.burn_nonce == burn_nonce @ MintError::NonceMismatch,
    )]
    pub verified_burn: Account<'info, VerifiedBurn>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Mint XENCAT tokens from verified burn (Transaction 2)
///
/// Flow:
/// 1. Read verified burn from VerifiedBurn PDA (created & verified in TX1)
/// 2. Validate user is authorized
/// 3. Check nonce not already processed (via PDA init)
/// 4. Mint tokens to user
/// 5. Mark burn as processed
/// 6. Charge mint fee
///
/// Security:
/// - Burn proof was cryptographically verified in TX1
/// - Only verified_burn.user can mint (enforced by constraints)
/// - PDA prevents replay (init fails if exists)
/// - Amount comes from verified proof
pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, MintFromBurn<'info>>,
    burn_nonce: u64,
) -> Result<()> {
    msg!("╔════════════════════════════════════════╗");
    msg!("║      XENCAT Mint from Verified Burn   ║");
    msg!("╚════════════════════════════════════════╝");

    let verified = &ctx.accounts.verified_burn;
    let mint_state = &ctx.accounts.mint_state;

    msg!("Burn nonce: {}", burn_nonce);
    msg!("User: {}", verified.user);
    msg!("Amount: {}", verified.amount);
    msg!("Verified at: {}", verified.verified_at);

    // ===== STEP 1: Burn Already Verified in TX1 =====
    // The proof was cryptographically verified in submit_proof (TX1)
    // We just read the verification result from VerifiedBurn PDA
    msg!("✓ Burn verified in TX1 (Ed25519 + Merkle proof)");

    // ===== STEP 2: Mint XENCAT Tokens =====
    // Mint the exact amount that was burned and verified
    let amount = verified.amount;

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.xencat_mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.mint_state.to_account_info(),
            },
            &[&[
                b"mint_state_v2",
                &[mint_state.bump]
            ]],
        ),
        amount,
    )?;

    msg!("✓ Minted {} tokens", amount);

    // ===== STEP 3: Mark verified burn as processed =====
    let verified = &mut ctx.accounts.verified_burn;
    verified.processed = true;

    // ===== STEP 4: Mark burn nonce as processed =====
    let processed = &mut ctx.accounts.processed_burn;
    processed.nonce = burn_nonce;
    processed.user = ctx.accounts.user.key();
    processed.amount = amount;
    processed.processed_at = Clock::get()?.unix_timestamp;

    msg!("✓ Burn marked as processed");

    // ===== STEP 5: Distribute Fees to Validators =====
    let validator_set = &ctx.accounts.validator_set;

    // Verify validator set version matches mint state
    require!(
        validator_set.version == ctx.accounts.mint_state.validator_set_version,
        MintError::ValidatorSetVersionMismatch
    );

    let fee_per_validator = mint_state.fee_per_validator;
    let total_fee = fee_per_validator
        .checked_mul(validator_set.validators.len() as u64)
        .ok_or(MintError::Overflow)?;

    if fee_per_validator > 0 {
        msg!("Distributing fees to {} validators", validator_set.validators.len());
        msg!("Fee per validator: {} lamports (0.01 XNT)", fee_per_validator);
        msg!("Total fee: {} lamports", total_fee);

        // Distribute fees to each validator using remaining_accounts
        for (i, validator_pubkey) in validator_set.validators.iter().enumerate() {
            let validator_account = ctx.remaining_accounts.get(i)
                .ok_or(MintError::MissingValidatorAccount)?;

            // Verify the account matches the expected validator
            require!(
                validator_account.key() == *validator_pubkey,
                MintError::InvalidValidatorAccount
            );

            require!(
                validator_account.is_writable,
                MintError::ValidatorAccountNotWritable
            );

            // Transfer XNT fee to validator
            let fee_transfer = anchor_lang::solana_program::system_instruction::transfer(
                ctx.accounts.user.key,
                validator_account.key,
                fee_per_validator,
            );

            anchor_lang::solana_program::program::invoke(
                &fee_transfer,
                &[
                    ctx.accounts.user.to_account_info(),
                    validator_account.to_account_info(),
                ],
            )?;

            msg!("✓ Transferred {} lamports to validator {}", fee_per_validator, validator_pubkey);
        }

        msg!("✓ Total fees distributed: {} lamports", total_fee);
    }

    // ===== STEP 6: Update Statistics =====
    let mint_state = &mut ctx.accounts.mint_state;
    mint_state.processed_burns_count = mint_state.processed_burns_count.saturating_add(1);
    mint_state.total_minted = mint_state.total_minted.saturating_add(amount);

    msg!("╔════════════════════════════════════════╗");
    msg!("║         ✓ MINTING SUCCESSFUL          ║");
    msg!("╚════════════════════════════════════════╝");
    msg!("Total burns processed: {}", mint_state.processed_burns_count);
    msg!("Total minted: {}", mint_state.total_minted);

    Ok(())
}
