use anchor_lang::prelude::*;

#[error_code]
pub enum MintError {
    #[msg("Burn nonce already processed (replay attack)")]
    BurnAlreadyProcessed,

    #[msg("Invalid burn proof")]
    InvalidBurnProof,

    #[msg("Amount mismatch")]
    AmountMismatch,

    #[msg("User mismatch")]
    UserMismatch,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("Proof already processed (replay attack)")]
    ProofAlreadyProcessed,

    #[msg("Invalid user - proof belongs to different user")]
    InvalidUser,

    #[msg("Nonce mismatch between proof and request")]
    NonceMismatch,

    #[msg("Arithmetic overflow in fee calculation")]
    Overflow,

    #[msg("Missing validator account in remaining_accounts")]
    MissingValidatorAccount,

    #[msg("Invalid validator account - does not match validator set")]
    InvalidValidatorAccount,

    #[msg("Validator account must be writable to receive fees")]
    ValidatorAccountNotWritable,

    #[msg("Validator set version mismatch - mint state expects different version")]
    ValidatorSetVersionMismatch,

    #[msg("Invalid mint decimals - must be 6")]
    InvalidMintDecimals,

    #[msg("Authority has already been migrated to V2")]
    AlreadyMigrated,

    #[msg("Invalid mint authority - does not match expected PDA")]
    InvalidMintAuthority,
}
