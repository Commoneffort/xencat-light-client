use anchor_lang::prelude::*;

#[error_code]
pub enum LightClientError {
    #[msg("Invalid validator signature - Ed25519 verification failed")]
    InvalidValidatorSignature,

    #[msg("Insufficient stake for consensus (need 66%+)")]
    InsufficientStake,

    #[msg("Invalid Merkle proof - root mismatch")]
    InvalidMerkleProof,

    #[msg("Validator not found in current set")]
    ValidatorNotFound,

    #[msg("Duplicate validator in proof")]
    DuplicateValidator,

    #[msg("Invalid validator set update - consensus not reached")]
    InvalidValidatorSetUpdate,

    #[msg("Arithmetic overflow in calculation")]
    ArithmeticOverflow,

    #[msg("Invalid validator set hash")]
    InvalidValidatorSetHash,

    #[msg("Update epoch mismatch")]
    UpdateEpochMismatch,

    #[msg("Block hash mismatch")]
    BlockHashMismatch,

    #[msg("Invalid signature format")]
    InvalidSignatureFormat,

    #[msg("Empty validator votes")]
    EmptyValidatorVotes,

    #[msg("Too many validators in proof")]
    TooManyValidators,

    #[msg("Insufficient validators in proof (minimum 5 required)")]
    InsufficientValidators,

    #[msg("Invalid proof data")]
    InvalidProofData,

    #[msg("Burn record data mismatch - user/amount/nonce don't match")]
    BurnRecordMismatch,

    #[msg("Invalid burn record hash")]
    InvalidBurnRecordHash,

    #[msg("Insufficient finality - block not finalized yet")]
    InsufficientFinality,

    #[msg("Invalid slot - must be less than current slot")]
    InvalidSlot,

    #[msg("Burn record deserialization failed")]
    BurnRecordDeserializationFailed,

    #[msg("Invalid Ed25519 instruction format or data")]
    InvalidEd25519Instruction,

    #[msg("Invalid vote message - doesn't match expected hash(block_hash || slot)")]
    InvalidVoteMessage,

    #[msg("Invalid message size - expected 32 bytes for vote message")]
    InvalidMessageSize,

    #[msg("Stake calculation overflow")]
    StakeOverflow,

    #[msg("Unknown validator - not in current validator set")]
    UnknownValidator,

    #[msg("Ed25519 instruction count mismatch")]
    Ed25519CountMismatch,

    #[msg("Not enough attestations to meet threshold")]
    InsufficientAttestations,

    #[msg("Invalid validator pubkey or configuration")]
    InvalidValidator,

    #[msg("Validator set version mismatch - attestations are for wrong version")]
    InvalidValidatorSetVersion,

    #[msg("Insufficient signatures for validator update")]
    InsufficientSignatures,

    #[msg("Validator not in current validator set")]
    ValidatorNotInSet,

    #[msg("Invalid threshold - must be > 0 and <= validator count")]
    InvalidThreshold,

    #[msg("Invalid asset ID - unknown or unsupported asset")]
    InvalidAsset,

    #[msg("Invalid attestation data - parameters don't match attestation fields")]
    InvalidAttestation,
}
