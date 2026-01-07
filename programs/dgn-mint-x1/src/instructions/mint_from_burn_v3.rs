use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};
use crate::state::*;
use crate::errors::*;
use solana_light_client_x1::{self, ID as LIGHT_CLIENT_ID, VerifiedBurnV3, X1ValidatorSet, Asset};

/// Asset-aware mint instruction (V3) for DGN
///
/// This is the V3 version that enforces asset_id validation for DGN.
/// It only works with VerifiedBurnV3 PDAs created by submit_burn_attestation_v3.
///
/// Key security properties:
/// - Enforces asset_id == DGN (2)
/// - Uses asset-scoped PDA: ["verified_burn_v3", asset_id, user, nonce]
/// - Prevents XENCAT burns from minting DGN
/// - Prevents unknown asset burns from minting anything
#[derive(Accounts)]
#[instruction(burn_nonce: u64, asset_id: u8)]
pub struct MintFromBurnV3<'info> {
    /// DGN mint program state
    #[account(
        mut,
        seeds = [b"dgn_mint_state"],
        bump = mint_state.bump
    )]
    pub mint_state: Account<'info, MintState>,

    /// DGN token mint on X1
    #[account(
        mut,
        address = mint_state.dgn_mint
    )]
    pub dgn_mint: Account<'info, Mint>,

    /// Processed burn tracker V3 (asset-aware, prevents replay attacks)
    ///
    /// CRITICAL: PDA includes asset_id for namespace separation
    /// Seeds: ["processed_burn_v3", asset_id, nonce, user]
    ///
    /// This ensures:
    /// - XENCAT processed burns: PDA("processed_burn_v3", 1, nonce, user)
    /// - DGN processed burns:    PDA("processed_burn_v3", 2, nonce, user)
    /// - No collision between different assets
    #[account(
        init,
        payer = user,
        space = 8 + ProcessedBurnV3::INIT_SPACE,
        seeds = [
            b"processed_burn_v3",
            asset_id.to_le_bytes().as_ref(),
            burn_nonce.to_le_bytes().as_ref(),
            user.key().as_ref()
        ],
        bump
    )]
    pub processed_burn: Account<'info, ProcessedBurnV3>,

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
    ///
    /// SECURITY: Version checked in handler BEFORE minting to ensure
    /// fee distribution uses current validator set.
    #[account(
        owner = LIGHT_CLIENT_ID,
        constraint = validator_set.version == mint_state.validator_set_version
            @ MintError::ValidatorSetVersionMismatch
    )]
    pub validator_set: Account<'info, X1ValidatorSet>,

    /// Verified burn PDA V3 (asset-aware, from light client, created in TX1)
    ///
    /// CRITICAL: PDA includes asset_id for namespace separation
    /// Seeds: ["verified_burn_v3", asset_id, user, nonce]
    ///
    /// Security enforcement:
    /// - asset_id is validated to equal DGN (2)
    /// - XENCAT proofs (asset_id=1) cannot access this PDA
    /// - Unknown asset proofs are rejected
    #[account(
        mut,
        seeds = [
            b"verified_burn_v3",
            asset_id.to_le_bytes().as_ref(),
            user.key().as_ref(),
            burn_nonce.to_le_bytes().as_ref()
        ],
        bump = verified_burn.bump,
        seeds::program = LIGHT_CLIENT_ID,
        constraint = !verified_burn.processed @ MintError::BurnAlreadyProcessed,
        constraint = verified_burn.user == user.key() @ MintError::UserMismatch,
        constraint = verified_burn.burn_nonce == burn_nonce @ MintError::NonceMismatch,
        constraint = verified_burn.asset_id == asset_id @ MintError::AssetMismatch,
    )]
    pub verified_burn: Account<'info, VerifiedBurnV3>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Mint DGN tokens from asset-aware verified burn (V3)
///
/// Flow:
/// 1. Validate asset_id == DGN (2)
/// 2. Validate validator set version (BEFORE minting)
/// 3. Read verified burn from VerifiedBurnV3 PDA (created & verified in TX1)
/// 4. Validate user is authorized
/// 5. Check nonce not already processed (via PDA init)
/// 6. Mint tokens to user
/// 7. Mark burn as processed
/// 8. Distribute fees to validators
/// 9. Emit MintedFromBurnV3 event
///
/// Security:
/// - Burn proof was cryptographically verified in TX1 (submit_burn_attestation_v3)
/// - Asset is cryptographically bound in signature (hash includes asset_id)
/// - Only verified_burn.user can mint (enforced by constraints)
/// - PDA prevents replay (init fails if exists)
/// - Amount comes from verified proof
/// - Asset_id is enforced to be DGN (2)
/// - Validator set version checked BEFORE minting (prevents using stale validator list)
pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, MintFromBurnV3<'info>>,
    burn_nonce: u64,
    asset_id: u8,
) -> Result<()> {
    msg!("╔═══════════════════════════════════════════════╗");
    msg!("║   DGN Mint from Asset-Aware Verified Burn    ║");
    msg!("║                    (V3)                       ║");
    msg!("╚═══════════════════════════════════════════════╝");

    // ===== STEP 1: CRITICAL ASSET VALIDATION =====
    // This is the primary security enforcement point that prevents:
    // - XENCAT burns from minting DGN
    // - Unknown asset burns from minting DGN
    // - Cross-asset exploitation
    //
    // ASSET NAMESPACE IS PERMANENT:
    // - asset_id = 1 MUST ALWAYS mean XENCAT
    // - asset_id = 2 MUST ALWAYS mean DGN
    // - IDs are NEVER reused or reassigned
    // - Once deployed, these mappings are immutable
    //
    // This program must ONLY mint DGN (asset_id = 2)
    const ASSET_DGN: u8 = 2;

    // NOTE: XENCAT (asset_id=1) uses a separate mint program.
    // This program must NEVER mint non-DGN assets.

    require!(
        asset_id == ASSET_DGN,
        MintError::AssetNotMintable
    );

    // Validate asset_id is recognized (additional safety check)
    let asset = Asset::from_u8(asset_id)?;
    require!(
        asset == Asset::DGN,
        MintError::AssetNotMintable
    );

    msg!("✓ Asset validated: DGN (asset_id={})", asset_id);

    let verified = &ctx.accounts.verified_burn;
    let mint_state = &ctx.accounts.mint_state;

    msg!("Asset: DGN (asset_id={})", asset_id);
    msg!("Burn nonce: {}", burn_nonce);
    msg!("User: {}", verified.user);
    msg!("Amount: {}", verified.amount);
    msg!("Verified at: {}", verified.verified_at);

    // ===== STEP 2: Burn Already Verified in TX1 =====
    // The proof was cryptographically verified in submit_burn_attestation_v3 (TX1)
    // Signature included asset_id: hash(DOMAIN || asset_id || version || nonce || amount || user)
    // We just read the verification result from VerifiedBurnV3 PDA
    msg!("✓ Burn verified in TX1 (asset-aware Ed25519 attestations)");

    // ===== STEP 3: Validator Set Version Already Checked in Constraints =====
    // The validator_set account has a constraint that validates:
    //   validator_set.version == mint_state.validator_set_version
    // This check happens BEFORE we reach this handler, ensuring we use the
    // current validator set for fee distribution.
    msg!("✓ Validator set version matches (validated in constraints)");

    // ===== STEP 4: Mint DGN Tokens =====
    // Mint the exact amount that was burned and verified
    let amount = verified.amount;

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.dgn_mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.mint_state.to_account_info(),
            },
            &[&[
                b"dgn_mint_state",
                &[mint_state.bump]
            ]],
        ),
        amount,
    )?;

    msg!("✓ Minted {} tokens", amount);

    // ===== STEP 5: Mark verified burn as processed =====
    let verified = &mut ctx.accounts.verified_burn;
    verified.processed = true;

    // ===== STEP 6: Mark burn nonce as processed (asset-aware) =====
    let processed = &mut ctx.accounts.processed_burn;
    processed.asset_id = asset_id;
    processed.nonce = burn_nonce;
    processed.user = ctx.accounts.user.key();
    processed.amount = amount;
    processed.processed_at = Clock::get()?.unix_timestamp;

    msg!("✓ Burn marked as processed (asset_id={})", asset_id);

    // ===== STEP 7: Distribute Fees to Validators =====
    let validator_set = &ctx.accounts.validator_set;

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

    // ===== STEP 8: Update Statistics =====
    let mint_state = &mut ctx.accounts.mint_state;
    mint_state.processed_burns_count = mint_state.processed_burns_count.saturating_add(1);
    mint_state.total_minted = mint_state.total_minted.saturating_add(amount);

    // ===== STEP 9: Emit Event =====
    emit!(MintedFromBurnV3 {
        asset_id,
        nonce: burn_nonce,
        user: ctx.accounts.user.key(),
        amount,
    });

    msg!("╔═══════════════════════════════════════════════╗");
    msg!("║         ✓ MINTING SUCCESSFUL (V3)             ║");
    msg!("║             Asset: DGN (asset_id=2)           ║");
    msg!("╚═══════════════════════════════════════════════╗");
    msg!("Total burns processed: {}", mint_state.processed_burns_count);
    msg!("Total minted: {}", mint_state.total_minted);

    Ok(())
}

/// Event emitted when tokens are minted from an asset-aware burn (V3)
#[event]
pub struct MintedFromBurnV3 {
    pub asset_id: u8,
    pub nonce: u64,
    pub user: Pubkey,
    pub amount: u64,
}
