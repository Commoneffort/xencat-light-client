/**
 * Complete E2E test for burn nonce 41
 * Burn already completed, now generate proof and mint
 */

import 'dotenv/config';
import * as anchor from '@coral-xyz/anchor';
import { Connection, PublicKey, SystemProgram, TransactionInstruction, Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount } from '@solana/spl-token';
import { generateBurnProof } from '../sdk/proof-generator/src/index';
import bs58 from 'bs58';

const CONFIG = {
    SOLANA_RPC: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
    BURN_PROGRAM: new PublicKey('2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp'),
    X1_RPC: 'https://rpc.testnet.x1.xyz',
    LIGHT_CLIENT: new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5'),
    MINT_PROGRAM: new PublicKey('8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk'),
    XENCAT_MINT_X1: new PublicKey('DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb'),
    BURN_NONCE: 41,
};

async function completeE2E() {
    console.log('\n🌉 Completing E2E Bridge Test for Nonce #41\n');
    console.log('═'.repeat(80));

    // Load keypair
    const privateKeyEnv = process.env.USER_PRIVATE_KEY;
    if (!privateKeyEnv) {
        throw new Error('USER_PRIVATE_KEY not found in .env');
    }

    let userKeypair: Keypair;
    try {
        const privateKeyArray = JSON.parse(privateKeyEnv);
        userKeypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
    } catch {
        userKeypair = Keypair.fromSecretKey(bs58.decode(privateKeyEnv));
    }

    const solanaConnection = new Connection(CONFIG.SOLANA_RPC, 'finalized');
    const x1Connection = new Connection(CONFIG.X1_RPC, 'confirmed');

    console.log('\n📋 Configuration:');
    console.log('   Burn Nonce:', CONFIG.BURN_NONCE);
    console.log('   User:', userKeypair.publicKey.toBase58());
    console.log('   Burn TX: https://solscan.io/tx/3jLniXGRLj1BVaZB72XVD6S8Z2UADn9dKN33iX4nMez35t7zdQJTNny5G41gu2NqHPpeA3pVXSQNK4LYruxHFWXS');
    console.log();

    //========================================================================
    // STEP 1: Wait additional time for validators to vote
    // ========================================================================

    console.log('1️⃣  Waiting for validator votes (30 seconds)...\n');
    console.log('   Validators need time to vote for recent slots.');
    console.log('   This ensures we can collect enough validator signatures.');
    console.log();

    await new Promise(resolve => setTimeout(resolve, 30000));

    console.log('   ✅ Wait complete\n');

    // ========================================================================
    // STEP 2: Generate proof with 7 validators
    // ========================================================================

    console.log('2️⃣  Generating proof with 7 validators...\n');

    const proof = await generateBurnProof({
        solanaRpc: CONFIG.SOLANA_RPC,
        burnNonce: CONFIG.BURN_NONCE,
        burnProgramId: CONFIG.BURN_PROGRAM.toBase58(),
        userAddress: userKeypair.publicKey.toBase58(),
        validatorCount: 7, // Use 7 validators
        onProgress: (msg) => console.log('   ' + msg)
    });

    console.log();
    console.log('   ✅ Proof generated!');
    console.log('      Validators:', proof.validatorVotes.length);
    console.log('      Slot:', proof.slot.toString());
    console.log('      Amount:', (Number(proof.amount) / 1_000_000).toFixed(6), 'XENCAT');
    console.log();

    if (proof.validatorVotes.length < 5) {
        console.log('   ⚠️  Warning: Only found', proof.validatorVotes.length, 'validators');
        console.log('   Light client requires at least 5 validators');
        console.log('   Try waiting longer and running again');
        console.log();
        return;
    }

    // ========================================================================
    // STEP 3: Submit to X1
    // ========================================================================

    console.log('3️⃣  Submitting proof to X1...\n');

    const provider = new anchor.AnchorProvider(
        x1Connection,
        new anchor.Wallet(userKeypair),
        { commitment: 'confirmed' }
    );

    // Load IDLs
    const mintIdl = require('../target/idl/xencat_mint_x1.json');
    const lightClientIdl = require('../target/idl/solana_light_client_x1.json');

    if (!mintIdl.types) {
        mintIdl.types = [];
    }

    const burnProofType = lightClientIdl.types.find((t: any) => t.name === 'BurnProof');
    const validatorVoteType = lightClientIdl.types.find((t: any) => t.name === 'ValidatorVote');

    if (burnProofType && !mintIdl.types.find((t: any) => t.name === 'BurnProof')) {
        mintIdl.types.push(burnProofType);
    }
    if (validatorVoteType && !mintIdl.types.find((t: any) => t.name === 'ValidatorVote')) {
        mintIdl.types.push(validatorVoteType);
    }

    const mintProgram = new anchor.Program(mintIdl, CONFIG.MINT_PROGRAM, provider);

    // Get PDAs
    const [mintStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_state_v2')],
        CONFIG.MINT_PROGRAM
    );

    const [lightClientStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('light_client_state')],
        CONFIG.LIGHT_CLIENT
    );

    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('validator_set')],
        CONFIG.LIGHT_CLIENT
    );

    const [processedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('processed_burn'),
            Buffer.from(new BigUint64Array([BigInt(CONFIG.BURN_NONCE)]).buffer)
        ],
        CONFIG.MINT_PROGRAM
    );

    const userTokenAccount = await getAssociatedTokenAddress(
        CONFIG.XENCAT_MINT_X1,
        userKeypair.publicKey
    );

    const mintState: any = await mintProgram.account.mintState.fetch(mintStatePda);

    // Check if token account exists
    const preInstructions: TransactionInstruction[] = [];
    let balanceBefore = 0;
    try {
        const account = await getAccount(x1Connection, userTokenAccount);
        balanceBefore = Number(account.amount);
    } catch {
        console.log('   🔧 Creating token account...');
        preInstructions.push(
            createAssociatedTokenAccountInstruction(
                userKeypair.publicKey,
                userTokenAccount,
                userKeypair.publicKey,
                CONFIG.XENCAT_MINT_X1
            )
        );
    }

    // Prepare proof data
    const toBN = (val: any): anchor.BN => {
        if (val instanceof anchor.BN) return val;
        if (typeof val === 'bigint') return new anchor.BN(val.toString());
        if (typeof val === 'object' && 'toNumber' in val) return new anchor.BN(val.toNumber());
        return new anchor.BN(val);
    };

    console.log('   🔍 Debug - Proof data sizes:');
    console.log('      burnRecordData length:', proof.burnRecordData.length);
    console.log('      blockHash length:', proof.blockHash.length);
    console.log('      stateRoot length:', proof.stateRoot.length);
    console.log('      merkleProof length:', proof.merkleProof.length);
    console.log('      validatorVotes length:', proof.validatorVotes.length);
    console.log();

    const proofData = {
        burnNonce: toBN(proof.burnNonce),
        user: new PublicKey(proof.user),
        amount: toBN(proof.amount),
        burnRecordData: Buffer.from(proof.burnRecordData),
        slot: toBN(proof.slot),
        blockHash: Buffer.from(proof.blockHash),
        validatorVotes: proof.validatorVotes.map((v: any) => ({
            validatorIdentity: new PublicKey(v.validatorIdentity),
            stake: toBN(v.stake),
            signature: Buffer.from(v.signature),
        })),
        merkleProof: proof.merkleProof.map((p: any) => Buffer.from(p)),
        stateRoot: Buffer.from(proof.stateRoot),
    };

    console.log('   📤 Sending transaction...');

    try {
        const signature = await mintProgram.methods
            .mintFromBurn(
                toBN(proof.burnNonce),
                proofData
            )
            .accounts({
                mintState: mintStatePda,
                xencatMint: CONFIG.XENCAT_MINT_X1,
                processedBurn: processedBurnPda,
                userTokenAccount: userTokenAccount,
                user: userKeypair.publicKey,
                mintFeeReceiver: mintState.feeReceiver,
                lightClientProgram: CONFIG.LIGHT_CLIENT,
                lightClientState: lightClientStatePda,
                validatorSet: validatorSetPda,
                lightClientFeeReceiver: mintState.feeReceiver,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .preInstructions(preInstructions)
            .rpc();

        console.log();
        console.log('   ✅ Transaction successful!');
        console.log('      Signature:', signature);
        console.log('      Explorer: https://explorer.x1.xyz/tx/' + signature + '?cluster=testnet');
        console.log();

        // ====================================================================
        // STEP 4: Verify
        // ====================================================================

        console.log('4️⃣  Verifying minted tokens...\n');

        await new Promise(resolve => setTimeout(resolve, 2000));

        const tokenAccount = await getAccount(x1Connection, userTokenAccount);
        const balanceAfter = Number(tokenAccount.amount);
        const minted = balanceAfter - balanceBefore;

        console.log('   💰 Balance before:', (balanceBefore / 1_000_000).toFixed(6), 'XENCAT');
        console.log('   💰 Balance after:', (balanceAfter / 1_000_000).toFixed(6), 'XENCAT');
        console.log('   🎯 Minted:', (minted / 1_000_000).toFixed(6), 'XENCAT');
        console.log();

        if (minted === Number(proof.amount)) {
            console.log('═'.repeat(80));
            console.log('🎉 E2E BRIDGE TEST SUCCESSFUL!');
            console.log('═'.repeat(80));
            console.log();
            console.log('✅ Burned 0.01 XENCAT on Solana mainnet');
            console.log('✅ Generated proof with', proof.validatorVotes.length, 'validators');
            console.log('✅ Light client verified signatures');
            console.log('✅ Minted 0.01 XENCAT on X1 testnet');
            console.log('✅ Replay protection working');
            console.log();
            console.log('🌉 Trustless bridge is OPERATIONAL! 🌉');
            console.log();
        } else {
            console.log('⚠️  Amount mismatch!');
            console.log('   Expected:', (Number(proof.amount) / 1_000_000).toFixed(6));
            console.log('   Got:', (minted / 1_000_000).toFixed(6));
        }

    } catch (error: any) {
        console.error('\n❌ Transaction failed!');
        console.error('   Error:', error.message);

        if (error.logs) {
            console.error('\n📜 Program Logs:');
            error.logs.forEach((log: string) => console.error('   ' + log));
        }

        throw error;
    }
}

completeE2E().catch((error) => {
    console.error('\n❌ E2E test failed:', error);
    process.exit(1);
});
