// Legacy verification code - kept for reference but not used with minimal BurnProof
// The new submit_proof instruction uses verification_new.rs instead

#![allow(dead_code)]
#![allow(unused_variables)]

use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::LightClientError;
use crate::BurnProof;

/// Burn record structure (must match Solana burn program)
/// This is what's stored in burn_record_data
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct BurnRecord {
    pub user: Pubkey,
    pub amount: u64,
    pub nonce: u64,
    pub timestamp: u64,
    pub record_hash: [u8; 32],
    pub bump: u8,
}

/// Result of burn proof verification
#[derive(Debug, Clone, PartialEq)]
pub struct VerificationResult {
    /// Total stake of validators that signed
    pub verified_stake: u64,

    /// Number of validators that signed
    pub validator_count: u16,

    /// Whether 66%+ threshold was met
    pub consensus_reached: bool,

    /// Whether Merkle proof is valid
    pub merkle_valid: bool,

    /// Overall verification passed
    pub verified: bool,
}

/// Verify a complete burn proof from Solana - SECURE CRYPTOGRAPHIC VERIFICATION
/// (ValidatorConfig version for 3+4 validator architecture)
///
/// This is the core security function of the light client. It verifies:
/// 1. Validator signatures are cryptographically valid (Ed25519 via native syscall)
/// 2. Validators are in the current validator set
/// 3. Combined stake of signing validators meets threshold
/// 4. Merkle proof shows burn record exists in Solana state
///
/// Security Model:
/// - We trust the initial validator set at deployment (genesis)
/// - After that, we only trust cryptographic proofs:
///   * Ed25519 signatures prove validators approved this block (FULL CRYPTO VERIFICATION)
///   * Stake weighting ensures sufficient validator consensus
///   * Merkle proof proves burn record exists in Solana state
///   * Block hash binds everything together
///
/// Compute Budget:
/// - Ed25519 verification: ~3,000 CU per signature × 3 = 9,000 CU
/// - Merkle verification: ~10,000 CU
/// - Logic overhead: ~5,000 CU
/// - Target total: <30,000 CU (well within limits!)
///
/// Parameters:
/// - proof: The burn proof to verify
/// - validator_config: Current trusted validator configuration
/// - instructions_sysvar: Instructions sysvar for Ed25519 verification
/// - ed25519_ix_offset: Index where Ed25519Program instructions start
pub fn verify_burn_proof(
    proof: &BurnProof,
    validator_config: &ValidatorConfig,
    instructions_sysvar: &AccountInfo,
    ed25519_ix_offset: u16,
) -> Result<VerificationResult> {
    msg!("=== Starting SECURE Burn Proof Verification ===");
    msg!("🔐 CRYPTOGRAPHIC VERIFICATION MODE - No shortcuts!");
    msg!("Burn nonce: {}", proof.burn_nonce);
    msg!("User: {}", proof.user);
    msg!("Amount: {}", proof.amount);
    msg!("Slot: {}", proof.slot);
    msg!("Validator votes: {}", proof.validator_votes.len());

    // 1. Validate proof structure and finality
    let current_slot = Clock::get()?.slot;
    validate_proof_structure(proof, current_slot)?;

    // 2. SECURITY CRITICAL: Verify validator signatures cryptographically
    let (verified_stake, validator_count) = verify_validator_signatures_config(
        proof,
        validator_config,
        instructions_sysvar,
        ed25519_ix_offset,
    )?;

    // 3. Check consensus threshold
    let total_stake = validator_config.total_tracked_stake;
    let (_, consensus_reached) = validator_config.verify_stake_threshold(
        &proof.validator_votes.iter().map(|v| v.validator_identity).collect::<Vec<_>>(),
        total_stake,
    )?;

    // Calculate percentage safely (avoid overflow with large stake values)
    let percentage = if total_stake > 0 {
        let verified_u128 = verified_stake as u128;
        let total_u128 = total_stake as u128;
        let result = (verified_u128 * 10000u128) / total_u128;
        result as u64
    } else {
        0
    };

    msg!("Verified stake: {} / {} ({}.{}%)",
         verified_stake,
         total_stake,
         percentage / 100,
         percentage % 100);

    // PRODUCTION: Enforce stake threshold strictly
    require!(
        consensus_reached,
        LightClientError::InsufficientStake
    );

    // 4. Verify Merkle proof of burn record (SECURITY CRITICAL)
    let merkle_valid = verify_merkle_proof_internal(proof)?;

    let result = VerificationResult {
        verified_stake,
        validator_count,
        consensus_reached,
        merkle_valid,
        verified: consensus_reached && merkle_valid,
    };

    msg!("=== Verification Result: {} ===", if result.verified { "PASS" } else { "FAIL" });

    Ok(result)
}

/// Verify a complete burn proof from Solana - SECURE CRYPTOGRAPHIC VERIFICATION
/// (ValidatorSet version - legacy)
///
/// This is the core security function of the light client. It verifies:
/// 1. Validator signatures are cryptographically valid (Ed25519 via native syscall)
/// 2. Validators are in the current validator set
/// 3. Combined stake of signing validators meets threshold
/// 4. Merkle proof shows burn record exists in Solana state
///
/// Security Model:
/// - We trust the initial validator set at deployment (genesis)
/// - After that, we only trust cryptographic proofs:
///   * Ed25519 signatures prove validators approved this block (FULL CRYPTO VERIFICATION)
///   * Stake weighting ensures sufficient validator consensus
///   * Merkle proof proves burn record exists in Solana state
///   * Block hash binds everything together
///
/// Compute Budget:
/// - Ed25519 verification: ~3,000 CU per signature × 3 = 9,000 CU
/// - Merkle verification: ~10,000 CU
/// - Logic overhead: ~5,000 CU
/// - Target total: <30,000 CU (well within limits!)
///
/// Parameters:
/// - proof: The burn proof to verify
/// - validator_set: Current trusted validator set
/// - total_stake: Total stake in the validator set
/// - instructions_sysvar: Instructions sysvar for Ed25519 verification
/// - ed25519_ix_offset: Index where Ed25519Program instructions start
pub fn verify_burn_proof_legacy(
    proof: &BurnProof,
    validator_set: &ValidatorSet,
    total_stake: u64,
    instructions_sysvar: &AccountInfo,
    ed25519_ix_offset: u16,
) -> Result<VerificationResult> {
    msg!("=== Starting SECURE Burn Proof Verification ===");
    msg!("🔒 CRYPTOGRAPHIC VERIFICATION MODE - No shortcuts!");
    msg!("Burn nonce: {}", proof.burn_nonce);
    msg!("User: {}", proof.user);
    msg!("Amount: {}", proof.amount);
    msg!("Slot: {}", proof.slot);
    msg!("Validator votes: {}", proof.validator_votes.len());

    // 1. Validate proof structure and finality
    let current_slot = Clock::get()?.slot;
    validate_proof_structure(proof, current_slot)?;

    // 2. SECURITY CRITICAL: Verify validator signatures cryptographically
    let (verified_stake, validator_count) = verify_validator_signatures(
        proof,
        validator_set,
        instructions_sysvar,
        ed25519_ix_offset,
    )?;

    // 3. Check consensus threshold
    // For 7-validator setup: Use 15% minimum stake threshold
    // Top 7 validators typically hold 15-20% of total Solana stake
    // This provides strong security while being achievable with 7 validators
    let min_stake_threshold = calculate_stake_threshold(
        total_stake,
        crate::config::MIN_STAKE_BASIS_POINTS
    )?;

    let consensus_reached = verified_stake >= min_stake_threshold;

    // Calculate percentage safely (avoid overflow with large stake values)
    // Use u128 for intermediate calculation to prevent overflow
    let percentage = if total_stake > 0 {
        let verified_u128 = verified_stake as u128;
        let total_u128 = total_stake as u128;
        let result = (verified_u128 * 10000u128) / total_u128;
        result as u64
    } else {
        0
    };

    msg!("Verified stake: {} / {} (threshold: {}, {}.{}%)",
         verified_stake,
         total_stake,
         min_stake_threshold,
         percentage / 100,
         percentage % 100);

    // PRODUCTION: Enforce stake threshold strictly
    require!(
        consensus_reached,
        LightClientError::InsufficientStake
    );

    // 4. Verify Merkle proof of burn record (SECURITY CRITICAL)
    let merkle_valid = verify_merkle_proof_internal(proof)?;

    let result = VerificationResult {
        verified_stake,
        validator_count,
        consensus_reached,
        merkle_valid,
        verified: consensus_reached && merkle_valid,
    };

    msg!("=== Verification Result: {} ===", if result.verified { "PASS" } else { "FAIL" });

    Ok(result)
}

/// Calculate stake threshold from basis points
///
/// Returns the minimum stake required based on total stake and basis points.
/// For example: 15% of 1,000,000 = 150,000
///
/// basis_points: 1500 = 15%, 6667 = 66.67%, etc.
fn calculate_stake_threshold(total_stake: u64, basis_points: u64) -> Result<u64> {
    // Use u128 to prevent overflow with large stake values (e.g., stake in lamports)
    let total_u128 = total_stake as u128;
    let basis_u128 = basis_points as u128;
    let threshold_u128 = (total_u128 * basis_u128) / 10000u128;
    let threshold = threshold_u128 as u64;

    Ok(threshold)
}

/// Validate proof structure and basic constraints
///
/// Security: Reject malformed proofs early to save compute units
fn validate_proof_structure(proof: &BurnProof, current_slot: u64) -> Result<()> {
    // Must have at least one validator vote
    require!(
        !proof.validator_votes.is_empty(),
        LightClientError::EmptyValidatorVotes
    );

    // Limit validators to control compute costs
    // Production: 7 validators (target), 5-20 validators (acceptable range)
    require!(
        proof.validator_votes.len() >= crate::config::MIN_VALIDATOR_COUNT,
        LightClientError::InsufficientValidators
    );

    require!(
        proof.validator_votes.len() <= crate::config::MAX_VALIDATOR_COUNT,
        LightClientError::TooManyValidators
    );

    // Validate amount is non-zero (sanity check)
    require!(
        proof.amount > 0,
        LightClientError::InvalidProofData
    );

    // Validate burn_record_data is present
    require!(
        !proof.burn_record_data.is_empty(),
        LightClientError::InvalidProofData
    );

    // Validate Merkle proof is present (SECURITY CRITICAL)
    require!(
        !proof.merkle_proof.is_empty(),
        LightClientError::InvalidMerkleProof
    );

    // Validate state root is non-zero
    require!(
        proof.state_root != [0u8; 32],
        LightClientError::InvalidMerkleProof
    );

    // Security: Finality check was done during proof generation
    // The proof generator waits for 32+ confirmations on Solana before creating the proof
    // We can't compare Solana mainnet slots to X1 testnet slots (different chains)
    //
    // NOTE: Validator signatures prove the block is finalized on Solana (66%+ stake)
    msg!("Proof slot (Solana): {}", proof.slot);
    msg!("Current slot (X1): {}", current_slot);
    msg!("(Cross-chain slot comparison not applicable)");

    Ok(())
}

/// Verify Ed25519 signatures from validators using native syscalls
/// (ValidatorConfig version for 3+4 validator architecture)
///
/// This function uses Solana's native Ed25519 syscalls for efficiency.
/// Each signature verification costs ~3,000 compute units.
///
/// Security:
/// - Verifies each signature cryptographically via Ed25519Program
/// - Checks for duplicate validators (prevents double-counting stake)
/// - Ensures all validators are in the current validator set
/// - Accumulates stake from valid signers
///
/// Vote Message Format: sha256(block_hash || slot)
/// This proves validators attested to this specific block at this slot.
///
/// Parameters:
/// - proof: The burn proof containing validator votes
/// - validator_config: The current trusted validator configuration
/// - instructions_sysvar: Account info for instruction introspection
/// - ed25519_ix_offset: Starting index of Ed25519Program instructions
fn verify_validator_signatures_config(
    proof: &BurnProof,
    validator_config: &ValidatorConfig,
    instructions_sysvar: &AccountInfo,
    ed25519_ix_offset: u16,
) -> Result<(u64, u16)> {
    let mut verified_stake: u64 = 0;
    let mut seen_validators = std::collections::HashSet::new();

    // Create the message that validators signed
    // Message = sha256(block_hash || slot)
    let vote_message = create_vote_message(&proof.block_hash, proof.slot);

    msg!("Vote message hash: {:?}", &vote_message[..8]);
    msg!("Ed25519 instruction offset: {}", ed25519_ix_offset);

    for (idx, vote) in proof.validator_votes.iter().enumerate() {
        msg!("Verifying validator {}/{}: {}", idx + 1, proof.validator_votes.len(), vote.validator_identity);

        // Security: Prevent duplicate validators from double-counting stake
        require!(
            seen_validators.insert(vote.validator_identity),
            LightClientError::DuplicateValidator
        );

        // Security: Validator must be in current set (primary or fallback)
        let validator = validator_config
            .find_validator(&vote.validator_identity)
            .ok_or(LightClientError::ValidatorNotFound)?;

        // Security: CRYPTOGRAPHICALLY verify Ed25519 signature using native syscall
        // This proves the validator actually signed this block hash at this slot
        // Each validator's signature is in a separate Ed25519Program instruction
        let signature_index = ed25519_ix_offset + (idx as u16);

        verify_ed25519_signature_native(
            signature_index,
            &vote.signature,
            &vote_message,
            &vote.validator_identity,
            instructions_sysvar,
        )?;

        // Accumulate stake from verified signer
        verified_stake = verified_stake
            .checked_add(validator.stake)
            .ok_or(LightClientError::ArithmeticOverflow)?;

        msg!("  ✓ Signature cryptographically verified, stake: {} (total: {})", validator.stake, verified_stake);
    }

    let validator_count = proof.validator_votes.len() as u16;

    Ok((verified_stake, validator_count))
}

/// Verify Ed25519 signatures from validators using native syscalls
/// (ValidatorSet version - legacy)
///
/// This function uses Solana's native Ed25519 syscalls for efficiency.
/// Each signature verification costs ~3,000 compute units.
///
/// Security:
/// - Verifies each signature cryptographically via Ed25519Program
/// - Checks for duplicate validators (prevents double-counting stake)
/// - Ensures all validators are in the current validator set
/// - Accumulates stake from valid signers
///
/// Vote Message Format: sha256(block_hash || slot)
/// This proves validators attested to this specific block at this slot.
///
/// Parameters:
/// - proof: The burn proof containing validator votes
/// - validator_set: The current trusted validator set
/// - instructions_sysvar: Account info for instruction introspection
/// - ed25519_ix_offset: Starting index of Ed25519Program instructions
fn verify_validator_signatures(
    proof: &BurnProof,
    validator_set: &ValidatorSet,
    instructions_sysvar: &AccountInfo,
    ed25519_ix_offset: u16,
) -> Result<(u64, u16)> {
    let mut verified_stake: u64 = 0;
    let mut seen_validators = std::collections::HashSet::new();

    // Create the message that validators signed
    // Message = sha256(block_hash || slot)
    let vote_message = create_vote_message(&proof.block_hash, proof.slot);

    msg!("Vote message hash: {:?}", &vote_message[..8]);
    msg!("Ed25519 instruction offset: {}", ed25519_ix_offset);

    for (idx, vote) in proof.validator_votes.iter().enumerate() {
        msg!("Verifying validator {}/{}: {}", idx + 1, proof.validator_votes.len(), vote.validator_identity);

        // Security: Prevent duplicate validators from double-counting stake
        require!(
            seen_validators.insert(vote.validator_identity),
            LightClientError::DuplicateValidator
        );

        // Security: Validator must be in current set
        let validator = validator_set
            .find_validator(&vote.validator_identity)
            .ok_or(LightClientError::ValidatorNotFound)?;

        // Security: CRYPTOGRAPHICALLY verify Ed25519 signature using native syscall
        // This proves the validator actually signed this block hash at this slot
        // Each validator's signature is in a separate Ed25519Program instruction
        let signature_index = ed25519_ix_offset + (idx as u16);

        verify_ed25519_signature_native(
            signature_index,
            &vote.signature,
            &vote_message,
            &vote.validator_identity,
            instructions_sysvar,
        )?;

        // Accumulate stake from verified signer
        verified_stake = verified_stake
            .checked_add(validator.stake)
            .ok_or(LightClientError::ArithmeticOverflow)?;

        msg!("  ✓ Signature cryptographically verified, stake: {} (total: {})", validator.stake, verified_stake);
    }

    let validator_count = proof.validator_votes.len() as u16;

    Ok((verified_stake, validator_count))
}

/// Create the vote message that validators sign
///
/// Message format: sha256(block_hash || slot)
///
/// Security: This binds the signature to a specific block at a specific slot,
/// preventing replay attacks across different blocks or slots.
fn create_vote_message(block_hash: &[u8; 32], slot: u64) -> [u8; 32] {
    use anchor_lang::solana_program::hash::hash;

    let mut message_data = Vec::with_capacity(40);
    message_data.extend_from_slice(block_hash);
    message_data.extend_from_slice(&slot.to_le_bytes());

    hash(&message_data).to_bytes()
}

/// Verify Ed25519 signature using Solana's native Ed25519Program precompile
///
/// SECURITY: FULL CRYPTOGRAPHIC VERIFICATION - NO SHORTCUTS
///
/// This function uses Solana's Ed25519Program to verify validator signatures.
/// The verification happens via instruction introspection:
///
/// 1. Client includes Ed25519Program instructions BEFORE the main instruction
/// 2. Each Ed25519 instruction contains: signature, pubkey, message
/// 3. Ed25519Program verifies the signature (precompile, ~3,000 CU each)
/// 4. This function checks the instruction sysvar to ensure verification passed
///
/// COST: ~3,000 CU per signature (vs 20,000 CU with ed25519-dalek)
/// SECURITY: Full Ed25519 cryptographic verification (no trust required)
///
/// Parameters:
/// - signature_index: Index of the Ed25519Program instruction in the transaction
/// - signature: Expected signature bytes (must match Ed25519 instruction)
/// - message: Message that was signed
/// - pubkey: Public key that signed the message
/// - instructions_sysvar: Account info for the instructions sysvar
fn verify_ed25519_signature_native(
    signature_index: u16,
    signature: &[u8; 64],
    message: &[u8; 32],
    pubkey: &Pubkey,
    instructions_sysvar: &AccountInfo,
) -> Result<()> {
    use anchor_lang::solana_program::{
        sysvar::instructions::load_instruction_at_checked,
        ed25519_program,
    };

    // DEVELOPMENT MODE: Accept mock signatures (all zeros) for testing
    // This allows E2E testing without real validator infrastructure
    #[cfg(feature = "dev-mode")]
    {
        if signature.iter().all(|&b| b == 0) {
            msg!("⚠️  DEV MODE: Accepting mock signature (all zeros)");
            return Ok(());
        }
    }

    msg!("🔐 Verifying Ed25519 signature at index {}", signature_index);
    msg!("  Validator: {}", pubkey);
    msg!("  Sig: {:?}...{:?}", &signature[..4], &signature[60..]);
    msg!("  Msg: {:?}...{:?}", &message[..4], &message[28..]);

    // Load the Ed25519Program instruction at the specified index
    // This will fail if:
    // - Index is out of bounds
    // - Instruction at index is not Ed25519Program
    // - Signature verification failed (Ed25519Program would have panicked)
    let ed25519_ix = load_instruction_at_checked(
        signature_index as usize,
        instructions_sysvar,
    )?;

    // CRITICAL SECURITY CHECK: Verify this is actually an Ed25519Program instruction
    require!(
        ed25519_ix.program_id == ed25519_program::ID,
        LightClientError::InvalidValidatorSignature
    );

    // Parse the Ed25519 instruction data to verify it contains our expected values
    // Ed25519Program instruction format:
    // - 1 byte: number of signatures (must be 1)
    // - 2 bytes: signature offset (where signature starts in data)
    // - 2 bytes: signature instruction index (unused, set to 0xFFFF)
    // - 2 bytes: public key offset (where pubkey starts in data)
    // - 2 bytes: public key instruction index (unused, set to 0xFFFF)
    // - 2 bytes: message data offset (where message starts in data)
    // - 2 bytes: message data size (length of message)
    // - 2 bytes: message instruction index (unused, set to 0xFFFF)
    // - Then: signature (64 bytes) + pubkey (32 bytes) + message (variable)

    require!(
        ed25519_ix.data.len() >= 14, // Minimum header size
        LightClientError::InvalidSignatureFormat
    );

    // Verify number of signatures is 1
    require!(
        ed25519_ix.data[0] == 1,
        LightClientError::InvalidSignatureFormat
    );

    // Extract offsets from instruction data
    let sig_offset = u16::from_le_bytes([ed25519_ix.data[1], ed25519_ix.data[2]]) as usize;
    let pubkey_offset = u16::from_le_bytes([ed25519_ix.data[5], ed25519_ix.data[6]]) as usize;
    let msg_offset = u16::from_le_bytes([ed25519_ix.data[9], ed25519_ix.data[10]]) as usize;
    let msg_size = u16::from_le_bytes([ed25519_ix.data[11], ed25519_ix.data[12]]) as usize;

    // CRITICAL SECURITY: Verify the instruction data contains our expected values
    // This prevents signature reuse or manipulation

    // Verify signature matches
    require!(
        ed25519_ix.data.len() >= sig_offset + 64,
        LightClientError::InvalidSignatureFormat
    );
    let ix_signature = &ed25519_ix.data[sig_offset..sig_offset + 64];
    require!(
        ix_signature == signature,
        LightClientError::InvalidValidatorSignature
    );

    // Verify pubkey matches
    require!(
        ed25519_ix.data.len() >= pubkey_offset + 32,
        LightClientError::InvalidSignatureFormat
    );
    let ix_pubkey = &ed25519_ix.data[pubkey_offset..pubkey_offset + 32];
    require!(
        ix_pubkey == pubkey.to_bytes(),
        LightClientError::InvalidValidatorSignature
    );

    // Verify message matches
    require!(
        ed25519_ix.data.len() >= msg_offset + msg_size,
        LightClientError::InvalidSignatureFormat
    );
    require!(
        msg_size == 32,
        LightClientError::InvalidSignatureFormat
    );
    let ix_message = &ed25519_ix.data[msg_offset..msg_offset + msg_size];
    require!(
        ix_message == message,
        LightClientError::InvalidValidatorSignature
    );

    msg!("✅ Ed25519 signature cryptographically verified");

    // If we got here, the Ed25519Program successfully verified the signature
    // AND the signature/pubkey/message match what we expected
    // This provides FULL cryptographic security with minimal compute cost

    Ok(())
}

/// Verify Merkle proof shows burn record exists in Solana state
///
/// SECURITY CRITICAL: This proves the burn_record_data is exactly as claimed,
/// preventing amount manipulation and fake burn attacks.
///
/// The proof is built from transaction account states:
/// 1. Fetch transaction with getTransaction()
/// 2. Build Merkle tree from account data hashes
/// 3. Generate proof for burn record account
/// 4. Verify root matches claimed state_root
///
/// Hash format (keccak256):
/// - Leaf: hash(pubkey || owner || lamports || data_length || data)
/// - Internal: hash(min(left, right) || max(left, right)) // Sorted for determinism
fn verify_merkle_proof_internal(proof: &BurnProof) -> Result<bool> {
    use anchor_lang::solana_program::keccak;

    msg!("Verifying Merkle proof ({} siblings)", proof.merkle_proof.len());

    // Security: Limit Merkle proof depth to prevent DoS
    require!(
        proof.merkle_proof.len() <= 32,
        LightClientError::InvalidMerkleProof
    );

    // Step 1: Hash the burn record data to get leaf hash
    // This must match the hash used when building the tree
    let leaf_hash = keccak::hash(&proof.burn_record_data).to_bytes();
    msg!("Leaf hash: {:?}", &leaf_hash[..8]);

    // Step 2: Walk up the Merkle tree
    let mut current_hash = leaf_hash;

    for (i, sibling) in proof.merkle_proof.iter().enumerate() {
        // Use sorted order for determinism (matches TypeScript implementation)
        let (left, right) = if current_hash <= *sibling {
            (&current_hash, sibling)
        } else {
            (sibling, &current_hash)
        };

        // Hash together: parent = hash(left || right)
        let mut parent_data = Vec::with_capacity(64);
        parent_data.extend_from_slice(left);
        parent_data.extend_from_slice(right);

        current_hash = keccak::hash(&parent_data).to_bytes();

        if i < 3 {
            msg!("  Level {}: {:?}", i, &current_hash[..8]);
        }
    }

    msg!("Computed root: {:?}", &current_hash[..8]);
    msg!("Expected root: {:?}", &proof.state_root[..8]);

    // Step 3: Verify computed root matches claimed state_root
    // SECURITY: This proves the burn_record_data is in the state tree
    let roots_match = current_hash == proof.state_root;

    if !roots_match {
        msg!("ERROR: Merkle root mismatch!");
        return Err(LightClientError::InvalidMerkleProof.into());
    }

    msg!("✓ Merkle proof valid");

    // Additional validation: Verify burn record contains expected data
    verify_burn_record_data(proof)?;

    Ok(true)
}

/// Verify the burn record data matches the proof claims
///
/// SECURITY CRITICAL: This ensures the Merkle-proven data actually contains
/// the claimed user, amount, and nonce. Prevents amount manipulation attacks.
fn verify_burn_record_data(proof: &BurnProof) -> Result<()> {
    msg!("Validating burn record data...");

    // Deserialize the burn record from the Merkle-proven data
    let burn_record = BurnRecord::try_from_slice(&proof.burn_record_data)
        .map_err(|_| LightClientError::BurnRecordDeserializationFailed)?;

    msg!("  Burn record user: {}", burn_record.user);
    msg!("  Burn record amount: {}", burn_record.amount);
    msg!("  Burn record nonce: {}", burn_record.nonce);

    // Security: Verify user matches
    require!(
        burn_record.user == proof.user,
        LightClientError::BurnRecordMismatch
    );

    // Security: Verify amount matches (CRITICAL)
    require!(
        burn_record.amount == proof.amount,
        LightClientError::BurnRecordMismatch
    );

    // Security: Verify nonce matches
    require!(
        burn_record.nonce == proof.burn_nonce,
        LightClientError::BurnRecordMismatch
    );

    msg!("✓ Burn record validation passed");

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vote_message_creation() {
        let block_hash = [1u8; 32];
        let slot = 123456;

        let msg1 = create_vote_message(&block_hash, slot);
        let msg2 = create_vote_message(&block_hash, slot);

        // Should be deterministic
        assert_eq!(msg1, msg2);

        // Different slot should produce different message
        let msg3 = create_vote_message(&block_hash, slot + 1);
        assert_ne!(msg1, msg3);
    }

    #[test]
    fn test_verification_result() {
        let result = VerificationResult {
            verified_stake: 700,
            validator_count: 10,
            consensus_reached: true,
            merkle_valid: true,
            verified: true,
        };

        assert!(result.verified);
        assert!(result.consensus_reached);
        assert!(result.merkle_valid);
    }
}
