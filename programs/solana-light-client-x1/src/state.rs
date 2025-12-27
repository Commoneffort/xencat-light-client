use anchor_lang::prelude::*;

/// Configuration for X1 validators who attest to Solana burns
/// TRUSTLESS DESIGN: Validator-threshold governance, no admin
#[account]
#[derive(InitSpace)]
pub struct X1ValidatorSet {
    /// Version number (monotonically increasing, starts at 1)
    /// Used for replay protection - old signatures become invalid
    pub version: u64,

    /// List of trusted X1 validator public keys
    #[max_len(10)]
    pub validators: Vec<Pubkey>,

    /// How many signatures needed (e.g., 3 of 5)
    pub threshold: u8,

    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct X1ValidatorInfo {
    /// X1 validator's signing public key (Ed25519)
    pub pubkey: Pubkey,

    /// Validator identifier
    #[max_len(32)]
    pub name: String,

    /// API endpoint where users can request attestations
    #[max_len(128)]
    pub attestation_api: String,

    /// Whether this validator is currently active
    pub active: bool,
}

/// User submits this to prove burn
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BurnAttestationData {
    pub burn_nonce: u64,
    pub user: Pubkey,
    pub amount: u64,

    /// Validator set version these attestations are for
    /// Must match current version in X1ValidatorSet
    pub validator_set_version: u64,

    /// Signatures from X1 validators (minimum threshold required)
    pub attestations: Vec<ValidatorAttestation>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ValidatorAttestation {
    /// Which X1 validator signed this
    pub validator_pubkey: Pubkey,

    /// Their Ed25519 signature over the burn data
    pub signature: [u8; 64],

    /// When they verified it (unix timestamp)
    pub timestamp: i64,
}

/// Stores ONLY the verification result (minimal data)
///
/// This is the optimized approach for two-transaction flow:
/// - TX1: Full Ed25519 cryptographic verification (expensive)
/// - Store: Only the fact that verification passed (cheap!)
/// - TX2: Read verified result and mint tokens
///
/// Why this works:
/// - Proof is cryptographically verified in TX1
/// - We only need to store: "Yes, this burn was verified"
/// - TX2 just needs: user, amount, nonce
///
/// Size: 58 bytes (vs 831 bytes for full proof storage)
/// Security: Identical (full verification still occurs in TX1)
#[account]
#[derive(InitSpace)]
pub struct VerifiedBurn {
    /// Burn nonce from Solana
    pub burn_nonce: u64,

    /// User who burned tokens (verified in proof)
    pub user: Pubkey,

    /// Amount burned (verified in proof)
    pub amount: u64,

    /// When verification occurred
    pub verified_at: i64,

    /// Whether tokens have been minted (replay prevention)
    pub processed: bool,

    /// PDA bump
    pub bump: u8,
}

impl VerifiedBurn {
    /// Account size: 8 + 8 + 32 + 8 + 8 + 1 + 1 = 66 bytes (with discriminator)
    pub const LEN: usize = 8 + 8 + 32 + 8 + 8 + 1 + 1;
}

/// Light client configuration and metadata
///
/// This account stores the core configuration for the light client including
/// authority, fee settings, and references to the current validator set.
/// Kept separate from ValidatorSet for easier upgrades and smaller account size.
///
/// Security: Once immutable, only validator set updates signed by 66%+ validators can modify state
#[account]
#[derive(InitSpace)]
pub struct LightClientState {
    /// Authority that can modify fee settings (NOT validator set)
    /// In production, this should be transferred to a DAO or renounced
    pub authority: Pubkey,

    /// Account that receives verification fees
    pub fee_receiver: Pubkey,

    /// Fee charged per proof verification (in lamports)
    /// Default: 1_000_000 (0.001 XNT with 6 decimals)
    pub verification_fee: u64,

    /// Total active stake in current validator set (for 66% threshold calculation)
    pub total_stake: u64,

    /// Number of validators in current set
    pub validator_count: u16,

    /// Slot when validator set was last updated
    pub last_update_slot: u64,

    /// Counter for validator set updates (for history tracking)
    pub update_epoch: u64,

    /// Current Solana epoch for validator rotation
    pub current_epoch: u64,

    /// Last time validator config was rotated
    pub last_rotation: i64,

    /// PDA bump seed
    pub bump: u8,
}

/// Validator configuration for 3 primary + 4 fallback architecture
///
/// This implements a resilient validator system that:
/// - Uses top 3 validators by stake as primary (fastest response)
/// - Maintains 4 fallback validators (if primary unresponsive)
/// - Rotates every Solana epoch (~2 days) for security
/// - Autonomous rotation (anyone can update with valid proof)
///
/// Security Model:
/// - Initial validator set trusted at deployment
/// - Rotation requires proof validators are top 7 by stake
/// - No single point of failure (7 validator slots total)
#[account]
pub struct ValidatorConfig {
    /// Current Solana epoch number
    pub current_epoch: u64,

    /// Last update timestamp
    pub last_update: i64,

    /// Primary validators (used first for proof generation)
    /// These are the top 3 validators by stake
    pub primary_validators: [ValidatorInfo; 3],

    /// Fallback validators (used if primary unresponsive)
    /// These are validators 4-7 by stake
    pub fallback_validators: [ValidatorInfo; 4],

    /// Total tracked stake (sum of all 7 validators)
    /// Used for percentage calculations
    pub total_tracked_stake: u64,

    /// Bump seed for PDA
    pub bump: u8,
}

impl ValidatorConfig {
    /// Space required for ValidatorConfig account
    /// 8 (discriminator) + 8 (epoch) + 8 (timestamp) +
    /// (3 * 40) (primary) + (4 * 40) (fallback) + 8 (stake) + 1 (bump)
    pub const LEN: usize = 8 + 8 + 8 + (3 * 40) + (4 * 40) + 8 + 1;

    /// Get all validators (primary + fallback)
    pub fn all_validators(&self) -> Vec<ValidatorInfo> {
        let mut all = Vec::with_capacity(7);
        all.extend_from_slice(&self.primary_validators);
        all.extend_from_slice(&self.fallback_validators);
        all
    }

    /// Check if a validator is in the trusted set (primary or fallback)
    pub fn contains_validator(&self, identity: &Pubkey) -> bool {
        self.primary_validators.iter().any(|v| v.identity == *identity)
            || self.fallback_validators.iter().any(|v| v.identity == *identity)
    }

    /// Get validator info by identity
    pub fn find_validator(&self, identity: &Pubkey) -> Option<&ValidatorInfo> {
        self.primary_validators.iter()
            .chain(self.fallback_validators.iter())
            .find(|v| v.identity == *identity)
    }

    /// Calculate total stake of all tracked validators
    pub fn calculate_total_stake(&self) -> u64 {
        let primary_stake: u64 = self.primary_validators.iter().map(|v| v.stake).sum();
        let fallback_stake: u64 = self.fallback_validators.iter().map(|v| v.stake).sum();
        primary_stake.saturating_add(fallback_stake)
    }

    /// Verify minimum stake threshold is met by provided validators
    /// For 3 validators, we require at least their combined stake
    pub fn verify_stake_threshold(&self, validator_identities: &[Pubkey], total_stake: u64) -> Result<(u64, bool)> {
        let mut verified_stake: u64 = 0;

        for identity in validator_identities {
            if let Some(validator) = self.find_validator(identity) {
                verified_stake = verified_stake
                    .checked_add(validator.stake)
                    .ok_or(error!(crate::errors::LightClientError::ArithmeticOverflow))?;
            }
        }

        // For 3-validator setup: Use minimum stake threshold from config
        let threshold = (total_stake as u128 * crate::config::MIN_STAKE_BASIS_POINTS as u128 / 10000) as u64;
        Ok((verified_stake, verified_stake >= threshold))
    }
}

/// Validator set storage - optimized for space efficiency
///
/// Stores the current active validator set with their stakes.
/// This is a separate account from LightClientState to allow for:
/// 1. Larger storage (can realloc if needed)
/// 2. Cheaper reads when only validator data is needed
/// 3. Easier validator set rotation
///
/// Space optimization:
/// - Base: 8 (discriminator) + 4 (vec length) = 12 bytes
/// - Per validator: 32 (pubkey) + 8 (stake) = 40 bytes
/// - 300 validators: 12 + (300 * 40) = 12,012 bytes (~12 KB)
/// - 500 validators: 12 + (500 * 40) = 20,012 bytes (~20 KB)
///
/// Note: Solana mainnet has ~1,500 validators but we sample 20 for proofs.
/// We store top N by stake for verification lookups.
#[account]
pub struct ValidatorSet {
    /// Active validators with their stake amounts
    /// Stored in descending order by stake for efficient sampling
    pub validators: Vec<ValidatorInfo>,
}

impl ValidatorSet {
    /// Maximum supported validators (conservative estimate)
    /// 500 validators = ~20 KB, well under Solana's 10 MB account limit
    pub const MAX_VALIDATORS: usize = 500;

    /// Initial size for validator set account
    /// Sized for 150 validators (~6 KB) with room to realloc
    pub const INITIAL_SIZE: usize = 8 + 4 + (40 * 150);

    /// Maximum size for validator set account
    /// Sized for 500 validators (~20 KB)
    pub const MAX_SIZE: usize = 8 + 4 + (40 * Self::MAX_VALIDATORS);

    /// Find a validator by identity pubkey
    /// Returns None if validator not found in set
    pub fn find_validator(&self, identity: &Pubkey) -> Option<&ValidatorInfo> {
        self.validators.iter().find(|v| v.identity == *identity)
    }

    /// Calculate 66% stake threshold (rounds up for safety)
    /// This is the minimum stake required for consensus
    pub fn consensus_threshold(total_stake: u64) -> Result<u64> {
        // (total_stake * 2) / 3, but with overflow protection
        let doubled = total_stake
            .checked_mul(2)
            .ok_or(error!(crate::errors::LightClientError::ArithmeticOverflow))?;

        // Round up: (doubled + 2) / 3 ensures we never under-estimate
        let threshold = doubled
            .checked_add(2)
            .ok_or(error!(crate::errors::LightClientError::ArithmeticOverflow))?
            / 3;

        Ok(threshold)
    }

    /// Verify a list of validators holds sufficient stake for consensus
    /// Returns (verified_stake, is_sufficient)
    pub fn verify_stake_threshold(
        &self,
        validator_identities: &[Pubkey],
        total_stake: u64,
    ) -> Result<(u64, bool)> {
        let mut verified_stake: u64 = 0;

        for identity in validator_identities {
            if let Some(validator) = self.find_validator(identity) {
                verified_stake = verified_stake
                    .checked_add(validator.stake)
                    .ok_or(error!(crate::errors::LightClientError::ArithmeticOverflow))?;
            }
        }

        let threshold = Self::consensus_threshold(total_stake)?;
        Ok((verified_stake, verified_stake >= threshold))
    }
}

/// Individual validator information
///
/// Stored in a compact format to minimize space usage.
/// Only essential data for verification is stored.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct ValidatorInfo {
    /// Validator's identity pubkey (vote account or node identity)
    pub identity: Pubkey,

    /// Validator's stake amount in lamports
    /// Used for weighted sampling and threshold calculations
    pub stake: u64,
}

impl ValidatorInfo {
    /// Size of a single validator entry in bytes
    pub const SIZE: usize = 32 + 8; // pubkey + stake
}

/// Validator set update history entry
///
/// Maintains a rolling history of validator set updates to:
/// 1. Prove chain of trust from genesis
/// 2. Allow verification of historical proofs
/// 3. Debug and audit validator set transitions
///
/// We keep last 100 updates in a ring buffer for space efficiency.
#[account]
pub struct ValidatorSetHistory {
    /// Ring buffer of update records
    /// Most recent update is at index (current_index - 1) % 100
    pub updates: Vec<ValidatorSetUpdateRecord>,

    /// Current write position in ring buffer (0-99)
    pub current_index: u8,

    /// Total number of updates recorded (can exceed 100)
    pub total_updates: u64,
}

impl ValidatorSetHistory {
    /// Number of historical updates to keep
    pub const HISTORY_SIZE: usize = 100;

    /// Account size for history storage
    /// 8 (discriminator) + 4 (vec len) + (100 * record size) + 1 (index) + 8 (total)
    pub const SIZE: usize = 8 + 4 + (Self::HISTORY_SIZE * ValidatorSetUpdateRecord::SIZE) + 1 + 8;

    /// Add a new update record to the history
    pub fn add_update(&mut self, record: ValidatorSetUpdateRecord) {
        let index = self.current_index as usize;

        if self.updates.len() < Self::HISTORY_SIZE {
            // Still filling initial buffer
            self.updates.push(record);
        } else {
            // Overwrite oldest entry
            self.updates[index] = record;
        }

        self.current_index = ((index + 1) % Self::HISTORY_SIZE) as u8;
        self.total_updates = self.total_updates.saturating_add(1);
    }

    /// Get the most recent update record
    pub fn get_latest(&self) -> Option<&ValidatorSetUpdateRecord> {
        if self.updates.is_empty() {
            return None;
        }

        let latest_index = if self.current_index == 0 {
            self.updates.len() - 1
        } else {
            (self.current_index - 1) as usize
        };

        self.updates.get(latest_index)
    }

    /// Get update record at a specific epoch
    pub fn get_by_epoch(&self, epoch: u64) -> Option<&ValidatorSetUpdateRecord> {
        self.updates.iter().find(|r| r.update_epoch == epoch)
    }
}

/// Record of a single validator set update
///
/// Stores metadata about when and how the validator set was updated.
/// This creates an immutable audit trail of all validator transitions.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ValidatorSetUpdateRecord {
    /// Epoch number for this update (monotonically increasing)
    pub update_epoch: u64,

    /// Slot when update was applied
    pub slot: u64,

    /// Unix timestamp when update occurred
    pub timestamp: i64,

    /// Hash of the new validator set for verification
    /// sha256(sorted_validator_identities || sorted_stakes)
    pub validator_set_hash: [u8; 32],

    /// Total stake in new validator set
    pub total_stake: u64,

    /// Number of validators in new set
    pub validator_count: u16,

    /// Number of signatures that approved this update
    pub approver_count: u16,

    /// Total stake of approvers (should be ≥66% of previous set)
    pub approver_stake: u64,
}

impl ValidatorSetUpdateRecord {
    /// Size of a single update record in bytes
    pub const SIZE: usize = 8 +  // update_epoch
                            8 +  // slot
                            8 +  // timestamp
                            32 + // validator_set_hash
                            8 +  // total_stake
                            2 +  // validator_count
                            2 +  // approver_count
                            8;   // approver_stake

    /// Create a new update record from validator set data
    pub fn new(
        update_epoch: u64,
        slot: u64,
        timestamp: i64,
        validators: &[ValidatorInfo],
        total_stake: u64,
        approver_count: u16,
        approver_stake: u64,
    ) -> Self {
        let validator_set_hash = Self::hash_validator_set(validators);

        Self {
            update_epoch,
            slot,
            timestamp,
            validator_set_hash,
            total_stake,
            validator_count: validators.len() as u16,
            approver_count,
            approver_stake,
        }
    }

    /// Create deterministic hash of validator set
    /// Used to verify update signatures and track history
    pub fn hash_validator_set(validators: &[ValidatorInfo]) -> [u8; 32] {
        use anchor_lang::solana_program::hash::hash;

        // Create sorted copy to ensure deterministic hash
        let mut sorted_validators = validators.to_vec();
        sorted_validators.sort_by_key(|v| v.identity);

        let mut hash_data = Vec::new();
        for validator in sorted_validators {
            hash_data.extend_from_slice(&validator.identity.to_bytes());
            hash_data.extend_from_slice(&validator.stake.to_le_bytes());
        }

        hash(&hash_data).to_bytes()
    }

    /// Verify this update was approved by sufficient stake
    /// Returns true if approver_stake >= 66% of previous total stake
    pub fn verify_consensus(&self, previous_total_stake: u64) -> Result<bool> {
        let threshold = ValidatorSet::consensus_threshold(previous_total_stake)?;
        Ok(self.approver_stake >= threshold)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_consensus_threshold() {
        // Test exact 66% calculation
        assert_eq!(ValidatorSet::consensus_threshold(300).unwrap(), 200);
        assert_eq!(ValidatorSet::consensus_threshold(1000).unwrap(), 667);
        assert_eq!(ValidatorSet::consensus_threshold(100).unwrap(), 67);

        // Test rounding up
        assert_eq!(ValidatorSet::consensus_threshold(10).unwrap(), 7);
    }

    #[test]
    fn test_validator_set_hash_deterministic() {
        let validators = vec![
            ValidatorInfo {
                identity: Pubkey::new_unique(),
                stake: 1000,
            },
            ValidatorInfo {
                identity: Pubkey::new_unique(),
                stake: 2000,
            },
        ];

        let hash1 = ValidatorSetUpdateRecord::hash_validator_set(&validators);
        let hash2 = ValidatorSetUpdateRecord::hash_validator_set(&validators);

        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_history_ring_buffer() {
        let mut history = ValidatorSetHistory {
            updates: Vec::new(),
            current_index: 0,
            total_updates: 0,
        };

        // Add first update
        let record = ValidatorSetUpdateRecord {
            update_epoch: 1,
            slot: 100,
            timestamp: 1234567890,
            validator_set_hash: [0u8; 32],
            total_stake: 1000,
            validator_count: 10,
            approver_count: 7,
            approver_stake: 700,
        };

        history.add_update(record.clone());
        assert_eq!(history.total_updates, 1);
        assert_eq!(history.get_latest().unwrap().update_epoch, 1);
    }
}
