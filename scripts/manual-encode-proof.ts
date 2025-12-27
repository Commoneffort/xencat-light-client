/**
 * Manual Borsh Encoding for BurnProof
 * Bypasses Anchor SDK IDL issue
 */

import { PublicKey } from '@solana/web3.js';
import { BurnProof } from '../sdk/proof-generator/src/types';

/**
 * Manually encode BurnProof to borsh format
 * Matches the Rust BurnProof structure exactly
 */
export function encodeBurnProof(proof: any): Buffer {
    const buffers: Buffer[] = [];

    // 1. burn_nonce: u64 (8 bytes)
    const nonceBuffer = Buffer.alloc(8);
    nonceBuffer.writeBigUInt64LE(BigInt(proof.burnNonce));
    buffers.push(nonceBuffer);

    // 2. user: Pubkey (32 bytes)
    const userPubkey = typeof proof.user === 'string'
        ? new PublicKey(proof.user)
        : proof.user;
    buffers.push(Buffer.from(userPubkey.toBytes()));

    // 3. amount: u64 (8 bytes)
    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64LE(BigInt(proof.amount));
    buffers.push(amountBuffer);

    // 4. burn_record_data: Vec<u8> (4 bytes length + data)
    const burnDataBuffer = Buffer.from(proof.burnRecordData);
    const burnDataLenBuffer = Buffer.alloc(4);
    burnDataLenBuffer.writeUInt32LE(burnDataBuffer.length);
    buffers.push(burnDataLenBuffer);
    buffers.push(burnDataBuffer);

    // 5. slot: u64 (8 bytes)
    const slotBuffer = Buffer.alloc(8);
    slotBuffer.writeBigUInt64LE(BigInt(proof.slot));
    buffers.push(slotBuffer);

    // 6. block_hash: [u8; 32] (32 bytes)
    buffers.push(Buffer.from(proof.blockHash));

    // 7. validator_votes: Vec<ValidatorVote> (4 bytes length + votes)
    const votesLenBuffer = Buffer.alloc(4);
    votesLenBuffer.writeUInt32LE(proof.validatorVotes.length);
    buffers.push(votesLenBuffer);

    for (const vote of proof.validatorVotes) {
        // validator_identity: Pubkey (32 bytes)
        const validatorPubkey = typeof vote.validatorIdentity === 'string'
            ? new PublicKey(vote.validatorIdentity)
            : vote.validatorIdentity;
        buffers.push(Buffer.from(validatorPubkey.toBytes()));

        // stake: u64 (8 bytes)
        const stakeBuffer = Buffer.alloc(8);
        stakeBuffer.writeBigUInt64LE(BigInt(vote.stake));
        buffers.push(stakeBuffer);

        // signature: [u8; 64] (64 bytes)
        buffers.push(Buffer.from(vote.signature));
    }

    // 8. merkle_proof: Vec<[u8; 32]> (4 bytes length + hashes)
    const merkleProofLenBuffer = Buffer.alloc(4);
    merkleProofLenBuffer.writeUInt32LE(proof.merkleProof.length);
    buffers.push(merkleProofLenBuffer);

    for (const hash of proof.merkleProof) {
        buffers.push(Buffer.from(hash));
    }

    // 9. state_root: [u8; 32] (32 bytes)
    buffers.push(Buffer.from(proof.stateRoot));

    return Buffer.concat(buffers);
}
