use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;
pub mod errors;
// pub mod verification; // Legacy - disabled, using verification_new instead
pub mod verification_new;
pub mod ed25519_utils;

use instructions::*;
pub use state::{
    X1ValidatorSet,
    X1ValidatorInfo,
    VerifiedBurn,
    BurnAttestationData,
    ValidatorAttestation,
    // Legacy state structures - keeping for reference
    LightClientState,
    ValidatorSet,
    ValidatorInfo,
    ValidatorSetHistory,
    ValidatorConfig,
};
pub use errors::LightClientError;

declare_id!("BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5");

/// Domain separator for cryptographic signature binding
/// Prevents cross-domain signature replay attacks
pub const DOMAIN_SEPARATOR: &str = "XENCAT_X1_BRIDGE_V1";

/// Production configuration constants for 5-validator bridge
pub mod config {
    /// Target number of validators for proof verification
    /// Using top 3 validators by stake provides ~9% of total Solana stake
    pub const TARGET_VALIDATOR_COUNT: usize = 3;

    /// Minimum acceptable validator count (reduced to fit transaction size limit)
    /// Transaction size limit is 1232 bytes, so we use 3 validators
    pub const MIN_VALIDATOR_COUNT: usize = 3;

    /// Maximum validator count (prevent excessive compute usage)
    /// Allows up to 20 validators for future scaling
    pub const MAX_VALIDATOR_COUNT: usize = 20;

    /// Minimum stake percentage required for consensus (in basis points)
    /// 900 = 9% of total stake
    /// This is lower than 66% BFT threshold because we're using top validators
    /// Top 3 validators typically control 9-10% of total stake
    pub const MIN_STAKE_BASIS_POINTS: u64 = 900; // 9%

    /// BFT consensus threshold (66% in basis points)
    /// 6667 = 66.67% of total stake
    /// Used when we have full validator set participation
    pub const BFT_THRESHOLD_BASIS_POINTS: u64 = 6667; // 66.67%
}

#[program]
pub mod solana_light_client_x1 {
    use super::*;

    /// Initialize X1 validator set (run once)
    pub fn initialize_validator_set(
        ctx: Context<InitializeValidatorSet>,
        threshold: u8,
    ) -> Result<()> {
        instructions::initialize_validator_set::handler(ctx, threshold)
    }

    /// Update validator set (requires threshold signatures from current validators)
    pub fn update_validator_set(
        ctx: Context<UpdateValidatorSet>,
        params: UpdateValidatorSetParams,
    ) -> Result<()> {
        instructions::update_validator_set::handler(ctx, params)
    }

    /// Submit burn with X1 validator attestations
    pub fn submit_burn_attestation(
        ctx: Context<SubmitBurnAttestation>,
        attestation: BurnAttestationData,
    ) -> Result<()> {
        instructions::submit_burn_attestation::handler(ctx, attestation)
    }

    // ========================================================================
    // LEGACY INSTRUCTIONS - Kept for reference, not used in new architecture
    // ========================================================================

    // /// Initialize the light client with genesis validator set
    // pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
    //     instructions::initialize::handler(ctx, params)
    // }

    // /// Update validator set with signed attestation from current validators
    // pub fn update_validators(
    //     ctx: Context<UpdateValidators>,
    //     params: UpdateValidatorsParams,
    // ) -> Result<()> {
    //     instructions::update_validators::handler(ctx, params)
    // }

    // /// Initialize validator configuration (3 primary + 4 fallback)
    // pub fn initialize_validator_config(
    //     ctx: Context<InitializeValidatorConfig>,
    //     initial_epoch: u64,
    //     primary_validators: [ValidatorInfo; 3],
    //     fallback_validators: [ValidatorInfo; 4],
    // ) -> Result<()> {
    //     instructions::rotate_validator_config::initialize_validator_config(
    //         ctx,
    //         initial_epoch,
    //         primary_validators,
    //         fallback_validators,
    //     )
    // }

    // /// Rotate validator configuration to new epoch
    // pub fn rotate_validator_config(
    //     ctx: Context<RotateValidatorConfig>,
    //     params: RotateValidatorConfigParams,
    // ) -> Result<()> {
    //     instructions::rotate_validator_config::handler(ctx, params)
    // }

    // /// Submit and verify burn proof (Transaction 1)
    // pub fn submit_proof(ctx: Context<SubmitProof>, proof: BurnProof) -> Result<()> {
    //     instructions::submit_proof::handler(ctx, proof)
    // }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeParams {
    pub validator_set: Vec<ValidatorInfo>,
    pub total_stake: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateValidatorsParams {
    pub new_validator_set: Vec<ValidatorInfo>,
    pub new_total_stake: u64,
    pub signatures: Vec<ValidatorSignature>,
}

/// Minimal burn proof - validator data extracted from Ed25519 instructions
///
/// This optimized structure avoids duplicating validator data that's already
/// present in Ed25519Program instructions. The verify logic extracts:
/// - Validator public keys
/// - Signatures
/// - Vote messages
/// ...directly from the Ed25519 instructions in the transaction.
///
/// Size: ~185 bytes (vs ~585 bytes with validator_votes included)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct BurnProof {
    // Burn identification
    pub burn_nonce: u64,
    pub user: Pubkey,
    pub amount: u64,

    // Block data
    pub slot: u64,
    pub block_hash: [u8; 32],
    pub state_root: [u8; 32],

    // Merkle proof (SECURITY CRITICAL)
    pub merkle_proof: Vec<[u8; 32]>,

    // Validator count (read this many Ed25519 instructions)
    pub validator_count: u8,
}

/// Legacy ValidatorVote struct (kept for backward compatibility with other instructions)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ValidatorVote {
    pub validator_identity: Pubkey,
    pub stake: u64,
    pub signature: [u8; 64],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ValidatorSignature {
    pub validator_identity: Pubkey,
    pub signature: [u8; 64],
}
