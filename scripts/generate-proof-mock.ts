/**
 * Generate a mock proof for nonce 41 using deployed validator set
 * This works because dev-mode skips signature verification
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';

const BURN_NONCE = 41;
const BURN_PROGRAM = new PublicKey('2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp');
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const X1_RPC = 'https://rpc.testnet.x1.xyz';
const LIGHT_CLIENT = new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5');

async function generateMockProof() {
    console.log('\n🔧 Generating Mock Proof for Nonce 41\n');
    console.log('This uses the deployed validator set from X1 testnet');
    console.log('Works with dev-mode (signature verification bypassed)\n');

    const solanaConn = new Connection(SOLANA_RPC, 'finalized');
    const x1Conn = new Connection(X1_RPC, 'confirmed');

    // 1. Fetch burn record
    console.log('1️⃣  Fetching burn record...\n');

    const [burnRecordPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('burn_record'),
            Buffer.from(new BigUint64Array([BigInt(BURN_NONCE)]).buffer)
        ],
        BURN_PROGRAM
    );

    const burnRecord = await solanaConn.getAccountInfo(burnRecordPda);
    if (!burnRecord) {
        throw new Error('Burn record not found');
    }

    const data = burnRecord.data;
    const burnUser = new PublicKey(data.slice(8, 40));
    const burnAmount = data.readBigUInt64LE(40);
    const burnSlot = BigInt(384943799); // From the burn transaction

    console.log('   Burn User:', burnUser.toBase58());
    console.log('   Amount:', (Number(burnAmount) / 1_000_000).toFixed(6), 'XENCAT');
    console.log('   Slot:', burnSlot.toString());
    console.log();

    // 2. Fetch validators from X1
    console.log('2️⃣  Fetching validator set from X1...\n');

    const lightClientIdl = require('../target/idl/solana_light_client_x1.json');
    const provider = new anchor.AnchorProvider(
        x1Conn,
        new anchor.Wallet(anchor.web3.Keypair.generate()),
        { commitment: 'confirmed' }
    );

    const lightClientProgram = new anchor.Program(lightClientIdl, LIGHT_CLIENT, provider);

    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('validator_set')],
        LIGHT_CLIENT
    );

    const validatorSet: any = await lightClientProgram.account.validatorSet.fetch(validatorSetPda);

    console.log('   Validators in set:', validatorSet.validators.length);
    console.log();

    // 3. Create mock proof with first 7 validators
    console.log('3️⃣  Creating mock proof with 7 validators...\n');

    const selectedValidators = validatorSet.validators.slice(0, 7);

    const mockProof = {
        burnNonce: BURN_NONCE,
        user: burnUser.toBase58(),
        amount: Number(burnAmount),
        burnRecordData: Array.from(data),
        slot: Number(burnSlot),
        blockHash: new Array(32).fill(0), // Mock blockhash
        validatorVotes: selectedValidators.map((v: any) => ({
            validatorIdentity: v.identity.toBase58(),
            stake: Number(v.stake),
            signature: new Array(64).fill(0), // Mock signature - dev-mode will skip verification
        })),
        merkleProof: [], // Empty Merkle proof for now
        stateRoot: new Array(32).fill(0), // Mock state root
    };

    console.log('   Generated proof with', mockProof.validatorVotes.length, 'validators');
    console.log('   Total stake:', selectedValidators.reduce((sum: any, v: any) => sum + Number(v.stake), 0) / 1e9, 'SOL');
    console.log();

    console.log('✅ Mock proof created!');
    console.log();
    console.log('⚠️  Note: This proof has mock signatures and will only work');
    console.log('   if the light client was deployed with dev-mode enabled.');
    console.log();

    // Save proof to file
    const fs = require('fs');
    fs.writeFileSync(
        'mock-proof-nonce-41.json',
        JSON.stringify(mockProof, null, 2)
    );

    console.log('💾 Saved proof to mock-proof-nonce-41.json\n');

    return mockProof;
}

generateMockProof().catch(console.error);
