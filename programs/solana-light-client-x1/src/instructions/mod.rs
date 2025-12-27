pub mod initialize;
pub mod initialize_validator_set;
pub mod update_validator_set;
pub mod submit_burn_attestation;
// Legacy modules - keeping for reference
// pub mod verify_proof;
// pub mod update_validators;
// pub mod rotate_validator_config;
// pub mod submit_proof;

pub use initialize::*;
pub use initialize_validator_set::*;
pub use update_validator_set::*;
pub use submit_burn_attestation::*;
