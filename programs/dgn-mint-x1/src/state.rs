use anchor_lang::prelude::*;

/// DGN mint program state
#[account]
#[derive(InitSpace)]
pub struct MintState {
    pub authority: Pubkey,
    pub dgn_mint: Pubkey,
    pub fee_per_validator: u64,        // Fee per validator (0.01 XNT = 10_000_000)
    pub light_client_program: Pubkey,  // Light client program ID for validator set
    pub validator_set_version: u64,    // Current validator set version
    pub processed_burns_count: u64,
    pub total_minted: u64,
    pub bump: u8,
}

/// Processed burn tracker V3 (asset-aware, prevents replay attacks)
///
/// This is the V3 version with asset_id field for multi-asset support.
///
/// Key differences from V2:
/// - Includes asset_id field
/// - PDA seeds include asset_id: ["processed_burn_v3", asset_id, nonce, user]
/// - Ensures different assets can have same nonce without collision
///
/// CRITICAL: Asset namespace is permanent
/// - asset_id = 1 always means XENCAT
/// - asset_id = 2 always means DGN
/// - IDs are NEVER reused or reassigned
#[account]
#[derive(InitSpace)]
pub struct ProcessedBurnV3 {
    pub asset_id: u8,
    pub nonce: u64,
    pub user: Pubkey,
    pub amount: u64,
    pub processed_at: i64,
}

impl ProcessedBurnV3 {
    pub const LEN: usize = 8 + // discriminator
        1 +  // asset_id
        8 +  // nonce
        32 + // user
        8 +  // amount
        8;   // processed_at
}
