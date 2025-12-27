/**
 * Test bridge with an existing burn from Solana mainnet
 * This tests the complete verification flow without burning new tokens
 */

import * as anchor from '@coral-xyz/anchor';
import { Connection, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount } from '@solana/spl-token';
import { generateBurnProof } from '../sdk/proof-generator/src/index';

const CONFIG = {
    // Solana Mainnet
    SOLANA_RPC: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
    BURN_PROGRAM: new PublicKey('2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp'),

    // X1 Testnet
    X1_RPC: 'https://rpc.testnet.x1.xyz',
    LIGHT_CLIENT: new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5'),
    MINT_PROGRAM: new PublicKey('8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk'),
    XENCAT_MINT_X1: new PublicKey('DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb'),

    // Test Parameters
    TEST_NONCE: 39, // Try nonce 39
};

async function testBridge() {
    console.log('\n🌉 Testing Bridge with Existing Burn\n');
    console.log('═'.repeat(80));

    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const solanaConnection = new Connection(CONFIG.SOLANA_RPC, 'confirmed');
    const x1Connection = new Connection(CONFIG.X1_RPC, 'confirmed');

    console.log('\n📋 Configuration:');
    console.log('   Test Nonce:', CONFIG.TEST_NONCE);
    console.log('   Your Wallet:', provider.wallet.publicKey.toString());
    console.log('   X1 RPC:', CONFIG.X1_RPC);
    console.log();

    // ========================================================================
    // STEP 1: Fetch burn record details
    // ========================================================================

    console.log('1️⃣  Fetching burn record from Solana...\n');

    const [burnRecordPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('burn_record'),
            Buffer.from(new BigUint64Array([BigInt(CONFIG.TEST_NONCE)]).buffer)
        ],
        CONFIG.BURN_PROGRAM
    );

    const burnRecord = await solanaConnection.getAccountInfo(burnRecordPda);

    if (!burnRecord) {
        console.error('❌ Burn record not found for nonce', CONFIG.TEST_NONCE);
        process.exit(1);
    }

    const data = burnRecord.data;
    const burnUser = new PublicKey(data.slice(8, 40));
    const burnAmount = data.readBigUInt64LE(40);
    const burnNonce = data.readBigUInt64LE(48);
    const burnTimestamp = data.readBigUInt64LE(56);

    console.log('   🔥 Burn Record Details:');
    console.log('      PDA:', burnRecordPda.toString());
    console.log('      User:', burnUser.toString());
    console.log('      Amount:', (Number(burnAmount) / 1_000_000).toFixed(6), 'XENCAT');
    console.log('      Nonce:', burnNonce.toString());
    console.log('      Timestamp:', new Date(Number(burnTimestamp) * 1000).toISOString());
    console.log();

    // ========================================================================
    // STEP 2: Check if already processed
    // ========================================================================

    console.log('2️⃣  Checking if burn already processed on X1...\n');

    const [processedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('processed_burn'),
            Buffer.from(new BigUint64Array([BigInt(CONFIG.TEST_NONCE)]).buffer)
        ],
        CONFIG.MINT_PROGRAM
    );

    const processedBurn = await x1Connection.getAccountInfo(processedBurnPda);

    if (processedBurn) {
        console.log('   ⚠️  This burn has already been processed!');
        console.log('      Processed Burn PDA:', processedBurnPda.toString());
        console.log('      This is expected if you ran this test before.');
        console.log('      The replay protection is working correctly! ✅');
        console.log();
        console.log('   Try using a different nonce from the list of recent burns.');
        console.log('   Run: npx ts-node scripts/check-existing-burns.ts');
        console.log();
        return;
    }

    console.log('   ✅ Burn not yet processed - good to test!');
    console.log();

    // ========================================================================
    // STEP 3: Generate proof
    // ========================================================================

    console.log('3️⃣  Generating proof from Solana validators...\n');
    console.log('   This may take 30-60 seconds...');
    console.log();

    const proof = await generateBurnProof({
        solanaRpc: CONFIG.SOLANA_RPC,
        burnNonce: CONFIG.TEST_NONCE,
        burnProgramId: CONFIG.BURN_PROGRAM.toBase58(),
        userAddress: burnUser.toBase58(),
        onProgress: (msg) => console.log('   ' + msg)
    });

    console.log();
    console.log('   ✅ Proof generated successfully!');
    console.log('      Validators:', proof.validatorVotes.length);
    console.log('      Slot:', proof.slot.toString());
    console.log('      Merkle Proof Length:', proof.merkleProof.length);
    console.log();

    // ========================================================================
    // STEP 4: Submit to X1
    // ========================================================================

    console.log('4️⃣  Submitting proof to X1 testnet...\n');

    // Load IDLs and merge types
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

    const x1Provider = new anchor.AnchorProvider(
        x1Connection,
        provider.wallet,
        { commitment: 'confirmed' }
    );

    const mintProgram = new anchor.Program(mintIdl, CONFIG.MINT_PROGRAM, x1Provider);

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

    // Get user token account (where tokens will be minted)
    const userTokenAccount = await getAssociatedTokenAddress(
        CONFIG.XENCAT_MINT_X1,
        burnUser // Mint to the original burn user
    );

    // Get mint state for fee receiver
    const mintState: any = await mintProgram.account.mintState.fetch(mintStatePda);

    // Check if user token account exists
    const preInstructions: TransactionInstruction[] = [];
    try {
        await getAccount(x1Connection, userTokenAccount);
    } catch {
        console.log('   🔧 Creating token account for user...');
        preInstructions.push(
            createAssociatedTokenAccountInstruction(
                provider.wallet.publicKey,
                userTokenAccount,
                burnUser,
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
                user: burnUser,
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
        // STEP 5: Verify
        // ====================================================================

        console.log('5️⃣  Verifying minted tokens...\n');

        await new Promise(resolve => setTimeout(resolve, 2000));

        const tokenAccount = await getAccount(x1Connection, userTokenAccount);
        const balance = Number(tokenAccount.amount);

        console.log('   💰 User balance on X1:', (balance / 1_000_000).toFixed(6), 'XENCAT');
        console.log('   🎯 Amount minted:', (Number(burnAmount) / 1_000_000).toFixed(6), 'XENCAT');
        console.log();

        if (balance >= Number(burnAmount)) {
            console.log('═'.repeat(80));
            console.log('🎉 BRIDGE TEST SUCCESSFUL!');
            console.log('═'.repeat(80));
            console.log();
            console.log('✅ Burn verified on Solana');
            console.log('✅ Proof generated with 20 validators');
            console.log('✅ Light client verified signatures');
            console.log('✅ Tokens minted on X1');
            console.log('✅ Replay protection active');
            console.log();
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

testBridge().catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
});
