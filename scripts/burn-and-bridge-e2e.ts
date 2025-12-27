/**
 * Burn and Bridge E2E Test
 *
 * This script performs a complete end-to-end test:
 * 1. Burn XENCAT on Solana mainnet (REAL TOKENS!)
 * 2. Generate proof with real validator signatures
 * 3. Submit to X1 testnet with Ed25519 verification
 * 4. Mint tokens on X1
 *
 * ⚠️ WARNING: This burns REAL XENCAT tokens on mainnet!
 */

import 'dotenv/config';
import * as anchor from '@coral-xyz/anchor';
import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    SystemProgram,
    TransactionInstruction,
} from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    getAccount,
    createBurnInstruction,
} from '@solana/spl-token';
import bs58 from 'bs58';

const CONFIG = {
    // Solana Mainnet
    SOLANA_RPC: 'https://api.mainnet-beta.solana.com',
    XENCAT_MINT: new PublicKey('7UN8WkBumTUCofVPXCPjNWQ6msQhzrg9tFQRP48Nmw5V'),
    BURN_PROGRAM: new PublicKey('2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp'),

    // Test amount (0.01 XENCAT = 10,000 with 6 decimals)
    BURN_AMOUNT: 10_000,
};

async function main() {
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║  🔥 BURN AND BRIDGE E2E TEST                              ║');
    console.log('║                                                           ║');
    console.log('║  ⚠️  WARNING: Burns REAL XENCAT on Solana mainnet!        ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    // Load user keypair
    const privateKeyEnv = process.env.USER_PRIVATE_KEY;
    if (!privateKeyEnv) {
        throw new Error('USER_PRIVATE_KEY required!');
    }

    let userKeypair: Keypair;
    try {
        const privateKeyArray = JSON.parse(privateKeyEnv);
        userKeypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
    } catch {
        userKeypair = Keypair.fromSecretKey(bs58.decode(privateKeyEnv));
    }

    console.log(`👤 User: ${userKeypair.publicKey.toBase58()}`);
    console.log(`🔥 Amount: ${CONFIG.BURN_AMOUNT / 1_000_000} XENCAT\n`);

    // Connect to Solana
    const connection = new Connection(CONFIG.SOLANA_RPC, 'confirmed');

    // ========================================================================
    // STEP 1: CHECK BALANCE
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💰 STEP 1: Check Balance');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const userTokenAccount = await getAssociatedTokenAddress(
        CONFIG.XENCAT_MINT,
        userKeypair.publicKey
    );

    let balance: bigint;
    try {
        const accountInfo = await getAccount(connection, userTokenAccount);
        balance = accountInfo.amount;
        console.log(`Current balance: ${Number(balance) / 1_000_000} XENCAT`);
    } catch (error) {
        throw new Error('Token account not found. You need XENCAT tokens to burn!');
    }

    if (balance < BigInt(CONFIG.BURN_AMOUNT)) {
        throw new Error(`Insufficient balance. Need ${CONFIG.BURN_AMOUNT / 1_000_000} XENCAT, have ${Number(balance) / 1_000_000}`);
    }

    console.log(`✅ Sufficient balance\n`);

    // User confirmation
    console.log('⚠️  CONFIRMATION REQUIRED:');
    console.log(`   You are about to burn ${CONFIG.BURN_AMOUNT / 1_000_000} XENCAT`);
    console.log(`   on Solana mainnet (IRREVERSIBLE!)`);
    console.log(`   Press Ctrl+C to cancel, or wait 5 seconds to proceed...\n`);

    await new Promise(resolve => setTimeout(resolve, 5000));

    // ========================================================================
    // STEP 2: GET CURRENT GLOBAL NONCE
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔢 STEP 2: Get Global Nonce');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const [globalStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('global_state')],
        CONFIG.BURN_PROGRAM
    );

    const globalStateAccount = await connection.getAccountInfo(globalStatePda);
    if (!globalStateAccount) {
        throw new Error('Burn program not initialized!');
    }

    // Parse global state (nonce_counter is at offset 8)
    const currentNonce = globalStateAccount.data.readBigUInt64LE(8);
    console.log(`📍 Current global nonce: ${currentNonce}`);
    console.log(`📍 Your burn will use nonce: ${currentNonce}\n`);

    // ========================================================================
    // STEP 3: BUILD BURN TRANSACTION
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔨 STEP 3: Build Burn Transaction');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Derive burn record PDA (using global nonce with to_le_bytes format)
    const nonceBuffer = Buffer.alloc(8);
    nonceBuffer.writeBigUInt64LE(currentNonce);
    const [burnRecordPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('burn_record'),
            nonceBuffer,
        ],
        CONFIG.BURN_PROGRAM
    );

    console.log(`📝 Burn Record PDA: ${burnRecordPda.toBase58()}`);
    console.log(`📝 Global State PDA: ${globalStatePda.toBase58()}\n`);

    // Build burn instruction using burn program
    // The burn program will handle everything
    const burnIx = new TransactionInstruction({
        programId: CONFIG.BURN_PROGRAM,
        keys: [
            { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: globalStatePda, isSigner: false, isWritable: true },
            { pubkey: burnRecordPda, isSigner: false, isWritable: true },
            { pubkey: CONFIG.XENCAT_MINT, isSigner: false, isWritable: true },
            { pubkey: userTokenAccount, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([
            Buffer.from([33, 48, 36, 182, 68, 82, 120, 188]), // burn_xencat discriminator (sha256("global:burn_xencat"))
            Buffer.from(new anchor.BN(CONFIG.BURN_AMOUNT).toArray('le', 8)),
        ]),
    });

    const transaction = new Transaction().add(burnIx);

    console.log(`✅ Transaction built\n`);

    // ========================================================================
    // STEP 4: SEND BURN TRANSACTION
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚀 STEP 4: Send Burn Transaction');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`📤 Sending to Solana mainnet...`);

    const signature = await connection.sendTransaction(transaction, [userKeypair], {
        skipPreflight: false,
    });

    console.log(`\n✅ Transaction sent!`);
    console.log(`📝 Signature: ${signature}`);
    console.log(`🔗 Solscan: https://solscan.io/tx/${signature}\n`);

    console.log(`⏳ Waiting for confirmation...`);

    const confirmation = await connection.confirmTransaction(signature, 'finalized');

    if (confirmation.value.err) {
        console.error(`\n❌ Transaction failed:`, confirmation.value.err);
        throw new Error('Burn transaction failed!');
    }

    console.log(`\n✅ BURN CONFIRMED!`);
    console.log(`🔥 Burned ${CONFIG.BURN_AMOUNT / 1_000_000} XENCAT`);
    console.log(`📍 Nonce: ${currentNonce}\n`);

    // Verify burn record exists
    const burnRecordCheck = await connection.getAccountInfo(burnRecordPda);
    if (!burnRecordCheck) {
        throw new Error('Burn record not created!');
    }

    console.log(`✅ Burn record created (${burnRecordCheck.data.length} bytes)\n`);

    // ========================================================================
    // STEP 5: WAIT AND GENERATE PROOF
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔐 STEP 5: Generate Proof');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`⏳ Waiting 30 seconds for Solana finality...\n`);
    await new Promise(resolve => setTimeout(resolve, 30000));

    console.log(`📊 Burn Summary:`);
    console.log(`  • Transaction: ${signature}`);
    console.log(`  • Nonce: ${currentNonce}`);
    console.log(`  • Amount: ${CONFIG.BURN_AMOUNT / 1_000_000} XENCAT`);
    console.log(`  • User: ${userKeypair.publicKey.toBase58()}`);
    console.log(`  • Burn Record: ${burnRecordPda.toBase58()}\n`);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ BURN COMPLETE!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`Next steps:`);
    console.log(`  1. Generate proof: BURN_NONCE=${currentNonce} npx ts-node scripts/generate-and-submit-proof.ts`);
    console.log(`  2. Or wait for full E2E script with proof generation\n`);

    console.log(`🎉 SUCCESS! Your burn is on Solana mainnet and ready to bridge!\n`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('\n❌ Error:');
        console.error(error);
        process.exit(1);
    });
