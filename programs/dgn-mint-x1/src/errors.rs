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

    #[msg("Unauthorized: caller is not the authority")]
    Unauthorized,

    #[msg("Asset not mintable by this program - this program only mints DGN (asset_id=2)")]
    AssetNotMintable,

    #[msg("Asset mismatch between verified burn and requested asset_id")]
    AssetMismatch,
}
