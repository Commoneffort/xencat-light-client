/**
 * Test Production Burn - Real E2E Flow
 *
 * This script:
 * 1. Takes a real burn from Solana mainnet
 * 2. Generates proof with real validator signatures
 * 3. Builds Ed25519Program instructions
 * 4. Submits to X1 testnet
 * 5. Verifies tokens minted
 */

import 'dotenv/config';
import * as anchor from '@coral-xyz/anchor';
import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    SYSVAR_INSTRUCTIONS_PUBKEY,
} from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    getAccount,
} from '@solana/spl-token';
import { Program } from '@coral-xyz/anchor';
import { SolanaLightClientX1 } from '../target/types/solana_light_client_x1';
import { XencatMintX1 } from '../target/types/xencat_mint_x1';
import {
    createValidatorEd25519Instructions,
    estimateTransactionSize,
} from '../sdk/proof-generator/src/ed25519-instructions';
import { generateBurnProof } from '../sdk/proof-generator/src/index';
import bs58 from 'bs58';
import fs from 'fs';

console.log(`
╔═══════════════════════════════════════════════════════════╗
║  🔥 PRODUCTION BURN TEST - REAL E2E FLOW                  ║
║                                                           ║
║  Testing with REAL burn data from Solana mainnet!        ║
╚═══════════════════════════════════════════════════════════╝
`);

// Configuration
const CONFIG = {
    SOLANA_RPC: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
    X1_RPC: process.env.X1_RPC || 'https://rpc.testnet.x1.xyz',
    LIGHT_CLIENT_X1: new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5'),
    MINT_PROGRAM_X1: new PublicKey('8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk'),
    XENCAT_MINT_X1: new PublicKey('DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb'),
    BURN_PROGRAM_MAINNET: new PublicKey('2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp'),

    // Test with first available burn (nonce 6)
    TEST_BURN_NONCE: process.env.BURN_NONCE ? parseInt(process.env.BURN_NONCE) : 6,
    VALIDATOR_COUNT: 3, // Use 3 validators for testing
};

async function main() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔧 SETUP');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Load user keypair
    const privateKeyEnv = process.env.USER_PRIVATE_KEY;
    if (!privateKeyEnv) {
        throw new Error('USER_PRIVATE_KEY environment variable required!');
    }

    let userKeypair: Keypair;
    try {
        const privateKeyArray = JSON.parse(privateKeyEnv);
        userKeypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
    } catch {
        userKeypair = Keypair.fromSecretKey(bs58.decode(privateKeyEnv));
    }

    console.log(`👤 User: ${userKeypair.publicKey.toBase58()}`);
    console.log(`🔥 Burn Nonce: ${CONFIG.TEST_BURN_NONCE}`);
    console.log(`🎯 Validators: ${CONFIG.VALIDATOR_COUNT}\n`);

    // Setup connections
    const solanaConnection = new Connection(CONFIG.SOLANA_RPC, 'finalized');
    const x1Connection = new Connection(CONFIG.X1_RPC, 'confirmed');

    console.log(`🌐 Solana RPC: ${CONFIG.SOLANA_RPC}`);
    console.log(`🧪 X1 RPC: ${CONFIG.X1_RPC}\n`);

    // Setup X1 provider
    const wallet = new anchor.Wallet(userKeypair);
    const x1Provider = new anchor.AnchorProvider(x1Connection, wallet, {
        commitment: 'confirmed',
    });
    anchor.setProvider(x1Provider);

    // Load programs
    const lightClientIdl = JSON.parse(
        fs.readFileSync('target/idl/solana_light_client_x1.json', 'utf-8')
    );
    const lightClientProgram = new Program(
        lightClientIdl,
        CONFIG.LIGHT_CLIENT_X1,
        x1Provider
    ) as Program<SolanaLightClientX1>;

    const mintIdl = JSON.parse(
        fs.readFileSync('target/idl/xencat_mint_x1.json', 'utf-8')
    );
    const mintProgram = new Program(
        mintIdl,
        CONFIG.MINT_PROGRAM_X1,
        x1Provider
    ) as Program<XencatMintX1>;

    console.log(`✅ Programs loaded\n`);

    // ========================================================================
    // STEP 1: VERIFY BURN EXISTS ON SOLANA
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 STEP 1: Verify Burn Record on Solana');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const [burnRecordPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('burn_record'),
            userKeypair.publicKey.toBuffer(),
            new anchor.BN(CONFIG.TEST_BURN_NONCE).toArrayLike(Buffer, 'le', 8),
        ],
        CONFIG.BURN_PROGRAM_MAINNET
    );

    console.log(`📝 Burn Record PDA: ${burnRecordPda.toBase58()}`);

    const burnAccount = await solanaConnection.getAccountInfo(burnRecordPda);
    if (!burnAccount) {
        throw new Error(`Burn record not found for nonce ${CONFIG.TEST_BURN_NONCE}`);
    }

    console.log(`✅ Burn record exists (${burnAccount.data.length} bytes)\n`);

    // ========================================================================
    // STEP 2: GENERATE PROOF WITH REAL VALIDATOR SIGNATURES
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔐 STEP 2: Generate Proof with Real Signatures');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('⏳ Fetching Solana state and generating Merkle proof...');
    console.log('   This may take 30-60 seconds...\n');

    const proof = await generateBurnProof({
        solanaRpc: CONFIG.SOLANA_RPC,
        burnNonce: CONFIG.TEST_BURN_NONCE,
        burnProgramId: CONFIG.BURN_PROGRAM_MAINNET.toBase58(),
        userAddress: userKeypair.publicKey.toBase58(),
        validatorCount: CONFIG.VALIDATOR_COUNT,
        onProgress: (step, progress, message) => {
            console.log(`  [${step}] ${progress.toFixed(0)}% - ${message}`);
        },
    });

    console.log(`\n✅ Proof generated successfully!\n`);

    console.log(`📊 Proof Statistics:`);
    console.log(`  • Validators: ${proof.validatorVotes.length}`);
    console.log(`  • Slot: ${proof.slot}`);
    console.log(`  • Block hash: ${Buffer.from(proof.blockHash).toString('hex').slice(0, 16)}...`);
    console.log(`  • Merkle proof depth: ${proof.merkleProof.length}`);
    console.log(`  • Amount: ${Number(proof.amount) / 1_000_000} XENCAT\n`);

    console.log(`🎯 Validator Details:`);
    proof.validatorVotes.forEach((vote, idx) => {
        const identity = vote.validatorIdentity.toBase58();
        const sig = Buffer.from(vote.signature).toString('hex').slice(0, 16);
        const stakeSOL = Number(vote.stake) / 1e9;
        console.log(`  ${idx + 1}. ${identity.slice(0, 8)}...`);
        console.log(`     Stake: ${stakeSOL.toLocaleString()} SOL`);
        console.log(`     Signature: ${sig}...\n`);
    });

    // ========================================================================
    // STEP 3: BUILD Ed25519 INSTRUCTIONS
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔒 STEP 3: Build Ed25519Program Instructions');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const ed25519Instructions = createValidatorEd25519Instructions(
        proof.validatorVotes.map((vote) => ({
            validatorIdentity: vote.validatorIdentity,
            signature: vote.signature,
            stake: vote.stake,
        })),
        proof.blockHash,
        BigInt(proof.slot)
    );

    console.log(`✅ Created ${ed25519Instructions.length} Ed25519Program instructions\n`);

    // Estimate size
    const sizeEstimate = estimateTransactionSize(ed25519Instructions.length, 500);
    console.log(`📏 Transaction Size Estimate:`);
    console.log(`  • Ed25519 instructions: ${ed25519Instructions.length} × 143 = ${ed25519Instructions.length * 143} bytes`);
    console.log(`  • verify_proof: ~500 bytes`);
    console.log(`  • Total: ${sizeEstimate.totalSize} bytes`);
    console.log(`  • Limit: 1232 bytes`);
    console.log(`  • Status: ${sizeEstimate.withinLimit ? '✅ Under limit' : '❌ Over limit'}\n`);

    if (!sizeEstimate.withinLimit) {
        throw new Error('Transaction too large!');
    }

    // ========================================================================
    // STEP 4: CHECK IF ALREADY PROCESSED
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 STEP 4: Check If Already Processed');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const [processedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('processed_burn'),
            userKeypair.publicKey.toBuffer(),
            new anchor.BN(CONFIG.TEST_BURN_NONCE).toArrayLike(Buffer, 'le', 8),
        ],
        CONFIG.MINT_PROGRAM_X1
    );

    console.log(`📍 ProcessedBurn PDA: ${processedBurnPda.toBase58()}`);

    const processedAccount = await x1Connection.getAccountInfo(processedBurnPda);
    if (processedAccount) {
        console.log(`\n⚠️  Burn already processed!`);
        console.log(`   This burn has already been minted on X1.`);
        console.log(`   Choose a different nonce to test.\n`);
        return;
    }

    console.log(`✅ Burn not yet processed - ready to mint!\n`);

    // ========================================================================
    // STEP 5: BUILD MINT TRANSACTION
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💎 STEP 5: Build Mint Transaction');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Derive PDAs
    const [lightClientState] = PublicKey.findProgramAddressSync(
        [Buffer.from('light_client_state')],
        CONFIG.LIGHT_CLIENT_X1
    );

    const [validatorSet] = PublicKey.findProgramAddressSync(
        [Buffer.from('validator_set')],
        CONFIG.LIGHT_CLIENT_X1
    );

    const [mintState] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_state_v2')],
        CONFIG.MINT_PROGRAM_X1
    );

    // Get fee receiver
    const stateAccount = await lightClientProgram.account.lightClientState.fetch(lightClientState);
    const feeReceiver = stateAccount.feeReceiver;

    // Get user's X1 token account
    const x1TokenAccount = await getAssociatedTokenAddress(
        CONFIG.XENCAT_MINT_X1,
        userKeypair.publicKey
    );

    // Check if token account exists
    let needsAtaCreation = false;
    try {
        await getAccount(x1Connection, x1TokenAccount);
        console.log(`✅ Token account exists: ${x1TokenAccount.toBase58()}\n`);
    } catch {
        needsAtaCreation = true;
        console.log(`📝 Will create token account: ${x1TokenAccount.toBase58()}\n`);
    }

    // Convert proof to program format
    const burnProofData = {
        user: proof.user,
        amount: new anchor.BN(proof.amount),
        burnRecordData: Array.from(proof.burnRecordData),
        slot: new anchor.BN(proof.slot),
        blockHash: Array.from(proof.blockHash),
        validatorVotes: proof.validatorVotes.map((vote) => ({
            validatorIdentity: vote.validatorIdentity,
            stake: new anchor.BN(vote.stake.toString()),
            signature: Array.from(vote.signature),
        })),
        merkleProof: proof.merkleProof.map((hash) => Array.from(hash)),
        stateRoot: Array.from(proof.stateRoot),
    };

    const burnNonce = new anchor.BN(proof.burnNonce);

    // Build transaction
    const transaction = new Transaction();

    // Add ATA creation if needed
    if (needsAtaCreation) {
        const createAtaIx = createAssociatedTokenAccountInstruction(
            userKeypair.publicKey,
            x1TokenAccount,
            userKeypair.publicKey,
            CONFIG.XENCAT_MINT_X1
        );
        transaction.add(createAtaIx);
        console.log(`➕ Added: Create Associated Token Account`);
    }

    // CRITICAL: Ed25519 instructions MUST come first!
    ed25519Instructions.forEach((ix, idx) => {
        transaction.add(ix);
        console.log(`➕ Added: Ed25519 instruction ${idx} (validator ${idx + 1})`);
    });

    // Add mint_from_burn instruction
    const mintIx = await mintProgram.methods
        .mintFromBurn(burnNonce, burnProofData)
        .accounts({
            mintState,
            lightClientState,
            validatorSet,
            processedBurn: processedBurnPda,
            xencatMint: CONFIG.XENCAT_MINT_X1,
            userTokenAccount: x1TokenAccount,
            user: userKeypair.publicKey,
            lightClientFeeReceiver: feeReceiver,
            lightClientProgram: CONFIG.LIGHT_CLIENT_X1,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .instruction();

    transaction.add(mintIx);
    console.log(`➕ Added: mint_from_burn instruction\n`);

    console.log(`📦 Transaction Structure:`);
    console.log(`  Instructions: ${transaction.instructions.length}`);
    transaction.instructions.forEach((ix, idx) => {
        console.log(`    [${idx}] ${ix.programId.toBase58().slice(0, 8)}...`);
    });
    console.log('');

    // ========================================================================
    // STEP 6: SUBMIT TRANSACTION
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚀 STEP 6: Submit Transaction to X1 Testnet');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`📤 Sending transaction...`);

    const signature = await x1Connection.sendTransaction(transaction, [userKeypair], {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
    });

    console.log(`\n✅ Transaction sent!`);
    console.log(`📝 Signature: ${signature}\n`);

    console.log(`⏳ Waiting for confirmation...`);
    const confirmation = await x1Connection.confirmTransaction(signature, 'confirmed');

    if (confirmation.value.err) {
        console.error(`\n❌ Transaction failed:`, confirmation.value.err);
        throw new Error('Transaction failed');
    }

    console.log(`\n✅ TRANSACTION CONFIRMED!\n`);

    // Get transaction details to see compute units used
    const txDetails = await x1Connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
    });

    if (txDetails?.meta) {
        console.log(`📊 Transaction Metrics:`);
        console.log(`  • Compute units consumed: ${txDetails.meta.computeUnitsConsumed}`);
        console.log(`  • Fee: ${txDetails.meta.fee / 1e9} SOL\n`);
    }

    // ========================================================================
    // STEP 7: VERIFY TOKENS MINTED
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ STEP 7: Verify Tokens Minted');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const finalBalance = await getAccount(x1Connection, x1TokenAccount);
    console.log(`💰 X1 Balance: ${Number(finalBalance.amount) / 1_000_000} XENCAT\n`);

    // Verify processed burn exists
    const processedCheck = await x1Connection.getAccountInfo(processedBurnPda);
    if (processedCheck) {
        console.log(`✅ Burn marked as processed (prevents replay)\n`);
    }

    // ========================================================================
    // SUCCESS!
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 SUCCESS! PRODUCTION TEST COMPLETE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`✅ Verified:`);
    console.log(`  • Real burn from Solana mainnet`);
    console.log(`  • Real validator signatures (${CONFIG.VALIDATOR_COUNT} validators)`);
    console.log(`  • Ed25519 cryptographic verification`);
    console.log(`  • Transaction under size limit`);
    console.log(`  • Tokens minted on X1 testnet`);
    console.log(`  • Replay protection active\n`);

    console.log(`🔗 View transaction:`);
    console.log(`   X1 Explorer: https://explorer.x1.xyz/tx/${signature}?cluster=testnet\n`);

    console.log(`📝 Next steps:`);
    console.log(`  • Process remaining burns (38 more)`);
    console.log(`  • Run security tests`);
    console.log(`  • Performance optimization`);
    console.log(`  • Security audit\n`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('\n❌ Test failed:');
        console.error(error);
        if (error.logs) {
            console.error('\n📋 Transaction logs:');
            error.logs.forEach((log: string) => console.error(`  ${log}`));
        }
        process.exit(1);
    });
