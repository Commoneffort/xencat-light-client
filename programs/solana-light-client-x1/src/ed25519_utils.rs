use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::{load_instruction_at_checked, ID as IX_SYSVAR_ID};
use anchor_lang::solana_program::ed25519_program;
use crate::errors::LightClientError;

/// Extract validator data from Ed25519 instruction
///
/// Ed25519 instruction data format:
/// [0-1]:   num_signatures (u16, little-endian)
/// [2-3]:   signature_offset (u16, little-endian)
/// [4-5]:   signature_instruction_index (u16, little-endian)
/// [6-7]:   public_key_offset (u16, little-endian)
/// [8-9]:   public_key_instruction_index (u16, little-endian)
/// [10-11]: message_data_offset (u16, little-endian)
/// [12-13]: message_data_size (u16, little-endian)
/// [14-15]: message_instruction_index (u16, little-endian)
/// [16...]: data (signatures, public keys, message)
///
/// Returns: (public_key, signature, message)
pub fn extract_ed25519_data(ix_data: &[u8]) -> Result<(Pubkey, [u8; 64], [u8; 32])> {
    require!(
        ix_data.len() >= 16,
        LightClientError::InvalidEd25519Instruction
    );

    // Read offsets (little-endian u16)
    let sig_offset = u16::from_le_bytes([ix_data[2], ix_data[3]]) as usize;
    let pubkey_offset = u16::from_le_bytes([ix_data[6], ix_data[7]]) as usize;
    let msg_offset = u16::from_le_bytes([ix_data[10], ix_data[11]]) as usize;
    let msg_size = u16::from_le_bytes([ix_data[12], ix_data[13]]) as usize;

    // Validate we have enough data
    require!(
        ix_data.len() >= sig_offset + 64,
        LightClientError::InvalidEd25519Instruction
    );
    require!(
        ix_data.len() >= pubkey_offset + 32,
        LightClientError::InvalidEd25519Instruction
    );
    require!(
        ix_data.len() >= msg_offset + msg_size,
        LightClientError::InvalidEd25519Instruction
    );

    // Extract signature (64 bytes)
    let mut signature = [0u8; 64];
    signature.copy_from_slice(&ix_data[sig_offset..sig_offset + 64]);

    // Extract public key (32 bytes)
    let mut pubkey_bytes = [0u8; 32];
    pubkey_bytes.copy_from_slice(&ix_data[pubkey_offset..pubkey_offset + 32]);
    let pubkey = Pubkey::new_from_array(pubkey_bytes);

    // Extract message (must be 32 bytes for vote message)
    require!(
        msg_size == 32,
        LightClientError::InvalidMessageSize
    );
    let mut message = [0u8; 32];
    message.copy_from_slice(&ix_data[msg_offset..msg_offset + 32]);

    Ok((pubkey, signature, message))
}

/// Load and parse Ed25519 instruction at given index
///
/// Returns: (validator_pubkey, signature, vote_message)
pub fn load_ed25519_instruction(
    ix_index: usize,
    instructions_sysvar: &AccountInfo,
) -> Result<(Pubkey, [u8; 64], [u8; 32])> {
    // Load instruction at index
    let ed25519_ix = load_instruction_at_checked(ix_index, instructions_sysvar)?;

    // Verify it's Ed25519Program
    require!(
        ed25519_ix.program_id == ed25519_program::ID,
        LightClientError::InvalidEd25519Instruction
    );

    // Extract validator data from instruction
    extract_ed25519_data(&ed25519_ix.data)
}

/// Create vote message hash from block hash and slot
///
/// Vote message format: keccak256(block_hash || slot)
/// This proves validators attested to this specific block at this slot
pub fn create_vote_message(block_hash: &[u8; 32], slot: u64) -> [u8; 32] {
    use anchor_lang::solana_program::keccak;

    let mut data = Vec::with_capacity(40);
    data.extend_from_slice(block_hash);
    data.extend_from_slice(&slot.to_le_bytes());

    keccak::hash(&data).to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_vote_message() {
        let block_hash = [1u8; 32];
        let slot = 12345u64;
        let message = create_vote_message(&block_hash, slot);

        // Vote message should be 32 bytes
        assert_eq!(message.len(), 32);

        // Same inputs should produce same output
        let message2 = create_vote_message(&block_hash, slot);
        assert_eq!(message, message2);

        // Different slot should produce different output
        let message3 = create_vote_message(&block_hash, slot + 1);
        assert_ne!(message, message3);
    }
}
