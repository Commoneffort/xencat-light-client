import 'dotenv/config';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    getAccount
} from '@solana/spl-token';
import { generateBurnProof } from '../sdk/proof-generator/src/index';
import bs58 from 'bs58';

// Test mint only with existing burn (nonce 4)
const CONFIG = {
    SOLANA_RPC: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
    BURN_PROGRAM_MAINNET: new PublicKey('2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp'),
    X1_RPC: process.env.X1_RPC || 'https://rpc.testnet.x1.xyz',
    LIGHT_CLIENT_X1: new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5'),
    MINT_PROGRAM_X1: new PublicKey('8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk'),
    XENCAT_MINT_X1: new PublicKey('DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb'),
    TEST_NONCE: 4, // Use existing burn
};

describe('Mint Only Test', () => {
    let userKeypair: Keypair;
    let x1Connection: Connection;
    let solanaConnection: Connection;

    before(async () => {
        const privateKeyEnv = process.env.USER_PRIVATE_KEY;
        if (!privateKeyEnv) {
            throw new Error('USER_PRIVATE_KEY required');
        }

        try {
            const privateKeyArray = JSON.parse(privateKeyEnv);
            userKeypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
        } catch {
            userKeypair = Keypair.fromSecretKey(bs58.decode(privateKeyEnv));
        }

        x1Connection = new Connection(CONFIG.X1_RPC, { commitment: 'confirmed' });
        solanaConnection = new Connection(CONFIG.SOLANA_RPC, { commitment: 'finalized' });

        console.log(`User: ${userKeypair.publicKey.toBase58()}`);
    });

    it('Generate and mint with existing burn', async function() {
        this.timeout(120000);

        console.log(`\n🔄 Generating proof for nonce ${CONFIG.TEST_NONCE}...`);

        const proof = await generateBurnProof({
            solanaRpc: CONFIG.SOLANA_RPC,
            burnNonce: new anchor.BN(CONFIG.TEST_NONCE),
            burnProgramId: CONFIG.BURN_PROGRAM_MAINNET.toBase58(),
            userAddress: userKeypair.publicKey.toBase58(),
            onProgress: (msg) => console.log(`   ${msg}`)
        });

        console.log('\n📊 Proof structure:');
        console.log(`  burnNonce: ${proof.burnNonce} (type: ${typeof proof.burnNonce})`);
        console.log(`  amount: ${proof.amount} (type: ${typeof proof.amount})`);
        console.log(`  slot: ${proof.slot} (type: ${typeof proof.slot})`);
        console.log(`  burnRecordData length: ${proof.burnRecordData.length}`);
        console.log(`  blockHash length: ${proof.blockHash.length}`);
        console.log(`  validatorVotes: ${proof.validatorVotes.length}`);
        console.log(`  validator[0] stake: ${proof.validatorVotes[0].stake} (type: ${typeof proof.validatorVotes[0].stake})`);
        console.log(`  validator[0] signature length: ${proof.validatorVotes[0].signature.length}`);
        console.log(`  merkleProof: ${proof.merkleProof.length} nodes`);
        console.log(`  merkleProof[0] length: ${proof.merkleProof[0]?.length}`);
        console.log(`  stateRoot length: ${proof.stateRoot.length}`);

        console.log('\n✅ Proof generated successfully!');
    });
});
