use anchor_lang::prelude::*;

/// Mint program state (V2)
#[account]
#[derive(InitSpace)]
pub struct MintState {
    pub authority: Pubkey,
    pub xencat_mint: Pubkey,
    pub fee_per_validator: u64,        // Fee per validator (0.01 XNT = 10_000_000)
    pub light_client_program: Pubkey,  // Light client program ID for validator set
    pub validator_set_version: u64,    // Current validator set version
    pub processed_burns_count: u64,
    pub total_minted: u64,
    pub bump: u8,
}

/// Legacy mint program state (V1 - read-only for migration)
#[account]
pub struct LegacyMintState {
    pub authority: Pubkey,
    pub xencat_mint: Pubkey,
    pub fee_receiver: Pubkey,
    pub mint_fee: u64,
    pub processed_burns_count: u64,
    pub total_minted: u64,
    pub bump: u8,
    pub migrated: bool,  // One-time flag to prevent re-migration
}

/// Processed burn tracker (prevents replay attacks)
#[account]
#[derive(InitSpace)]
pub struct ProcessedBurn {
    pub nonce: u64,
    pub user: Pubkey,
    pub amount: u64,
    pub processed_at: i64,
}

impl ProcessedBurn {
    pub const LEN: usize = 8 + // discriminator
        8 +  // nonce
        32 + // user
        8 +  // amount
        8;   // processed_at
}

/// Fee vault for individual validators (non-custodial)
#[account]
#[derive(InitSpace)]
pub struct FeeVault {
    pub validator: Pubkey,      // Validator pubkey
    pub balance: u64,            // Current withdrawable balance
    pub total_collected: u64,    // Total fees collected (audit trail)
    pub bump: u8,
}
