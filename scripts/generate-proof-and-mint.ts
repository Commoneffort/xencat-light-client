/**
 * Generate Proof and Mint on X1
 *
 * This script:
 * 1. Generates proof for burn nonce 43
 * 2. Builds Ed25519 instructions
 * 3. Manually builds mint instruction (bypasses IDL issue)
 * 4. Submits to X1 testnet
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
    SYSVAR_INSTRUCTIONS_PUBKEY,
} from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { generateBurnProof, createValidatorEd25519Instructions } from '../sdk/proof-generator/src';
import { encodeBurnProof } from './manual-encode-proof';

const CONFIG = {
    // Solana Mainnet
    SOLANA_RPC: 'https://api.mainnet-beta.solana.com',
    BURN_PROGRAM: new PublicKey('2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp'),
    USER_ADDRESS: new PublicKey('6oQbeffgkGXhX9CxRvskiR47ViKSs59Mn2y4ZgSHR8oW'),

    // X1 Testnet (from MINT_INITIALIZED.md)
    X1_RPC: 'https://rpc.testnet.x1.xyz',
    LIGHT_CLIENT_PROGRAM: new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5'),
    MINT_PROGRAM: new PublicKey('8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk'),
    XENCAT_MINT_X1: new PublicKey('DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb'),

    // Burn data
    BURN_NONCE: 43,
    VALIDATOR_COUNT: 3,
};

async function main() {
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║  🌉 GENERATE PROOF AND MINT ON X1                        ║');
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
    console.log(`🔥 Burn Nonce: ${CONFIG.BURN_NONCE}`);
    console.log(`🎯 Validators: ${CONFIG.VALIDATOR_COUNT}\n`);

    // ========================================================================
    // STEP 1: GENERATE PROOF
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔐 STEP 1: Generate Burn Proof');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`⏳ Generating proof with ${CONFIG.VALIDATOR_COUNT} validators...\n`);

    const proof = await generateBurnProof({
        solanaRpc: CONFIG.SOLANA_RPC,
        burnNonce: CONFIG.BURN_NONCE,
        burnProgramId: CONFIG.BURN_PROGRAM.toBase58(),
        userAddress: CONFIG.USER_ADDRESS.toBase58(),
        validatorCount: CONFIG.VALIDATOR_COUNT,
    });

    console.log(`✅ Proof generated!`);
    console.log(`  • Slot: ${proof.slot}`);
    console.log(`  • Block hash: ${Buffer.from(proof.blockHash).toString('hex').slice(0, 16)}...`);
    console.log(`  • Validators: ${proof.validatorVotes.length}`);
    console.log(`  • Total stake: ${proof.validatorVotes.reduce((sum, v) => sum + Number(v.stake), 0) / 1e9} SOL\n`);

    // ========================================================================
    // STEP 2: BUILD ED25519 INSTRUCTIONS
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔐 STEP 2: Build Ed25519 Instructions');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const ed25519Instructions = createValidatorEd25519Instructions(
        proof.validatorVotes,
        proof.blockHash,
        proof.slot
    );

    console.log(`✅ Created ${ed25519Instructions.length} Ed25519 instructions`);
    console.log(`  • Each instruction: ${ed25519Instructions[0].data.length} bytes\n`);

    // ========================================================================
    // STEP 3: BUILD MINT INSTRUCTION (MANUAL)
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔨 STEP 3: Build Mint Instruction');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Connect to X1
    const x1Connection = new Connection(CONFIG.X1_RPC, 'confirmed');

    // Derive PDAs
    const [mintState] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_state_v2')],
        CONFIG.MINT_PROGRAM
    );

    const [processedBurn] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('processed_burn'),
            Buffer.from(CONFIG.BURN_NONCE.toString().padStart(16, '0')),
        ],
        CONFIG.MINT_PROGRAM
    );

    const [lightClientState] = PublicKey.findProgramAddressSync(
        [Buffer.from('light_client_state')],
        CONFIG.LIGHT_CLIENT_PROGRAM
    );

    const [validatorSet] = PublicKey.findProgramAddressSync(
        [Buffer.from('validator_set'), Buffer.from([0])], // version 0
        CONFIG.LIGHT_CLIENT_PROGRAM
    );

    const userTokenAccount = await getAssociatedTokenAddress(
        CONFIG.XENCAT_MINT_X1,
        userKeypair.publicKey
    );

    // Get fee receivers from state
    const mintStateAccount = await x1Connection.getAccountInfo(mintState);
    if (!mintStateAccount) {
        throw new Error('Mint state not initialized!');
    }
    const mintFeeReceiver = new PublicKey(mintStateAccount.data.slice(64, 96));

    const lightClientStateAccount = await x1Connection.getAccountInfo(lightClientState);
    if (!lightClientStateAccount) {
        throw new Error('Light client not initialized!');
    }
    const lightClientFeeReceiver = new PublicKey(lightClientStateAccount.data.slice(32, 64));

    console.log(`📝 Mint State: ${mintState.toBase58()}`);
    console.log(`📝 Processed Burn: ${processedBurn.toBase58()}`);
    console.log(`📝 Light Client State: ${lightClientState.toBase58()}`);
    console.log(`📝 Validator Set: ${validatorSet.toBase58()}\n`);

    // Manually encode the mint instruction
    // Discriminator for mint_from_burn: sha256("global:mint_from_burn")[0..8]
    const crypto = require('crypto');
    const discriminatorHash = crypto.createHash('sha256').update('global:mint_from_burn').digest();
    const discriminator = discriminatorHash.slice(0, 8);

    console.log(`🔨 Discriminator: ${Buffer.from(discriminator).toString('hex')}\n`);

    // Manually encode the proof (bypass borsh library issues)
    const encodedProof = encodeBurnProof(proof);

    // Build instruction data: discriminator + burn_nonce + proof
    const nonceBuffer = Buffer.alloc(8);
    nonceBuffer.writeBigUInt64LE(BigInt(CONFIG.BURN_NONCE));

    const instructionData = Buffer.concat([
        discriminator,
        nonceBuffer,
        encodedProof,
    ]);

    console.log(`📦 Instruction data: ${instructionData.length} bytes\n`);

    // Build mint instruction
    const mintIx = new TransactionInstruction({
        programId: CONFIG.MINT_PROGRAM,
        keys: [
            { pubkey: mintState, isSigner: false, isWritable: true },
            { pubkey: CONFIG.XENCAT_MINT_X1, isSigner: false, isWritable: true },
            { pubkey: processedBurn, isSigner: false, isWritable: true },
            { pubkey: userTokenAccount, isSigner: false, isWritable: true },
            { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: mintFeeReceiver, isSigner: false, isWritable: true },
            { pubkey: CONFIG.LIGHT_CLIENT_PROGRAM, isSigner: false, isWritable: false },
            { pubkey: lightClientState, isSigner: false, isWritable: false },
            { pubkey: validatorSet, isSigner: false, isWritable: false },
            { pubkey: lightClientFeeReceiver, isSigner: false, isWritable: true },
            { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: instructionData,
    });

    // ========================================================================
    // STEP 4: SUBMIT TRANSACTION
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚀 STEP 4: Submit to X1');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const transaction = new Transaction();

    // Add Ed25519 instructions
    ed25519Instructions.forEach(ix => transaction.add(ix));

    // Add mint instruction
    transaction.add(mintIx);

    // Get recent blockhash
    const { blockhash } = await x1Connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = userKeypair.publicKey;

    console.log(`📦 Transaction size: ${transaction.serialize({ requireAllSignatures: false }).length} bytes`);
    console.log(`📝 Instructions: ${transaction.instructions.length} (${ed25519Instructions.length} Ed25519 + 1 mint)\n`);

    console.log(`📤 Sending to X1 testnet...\n`);

    const signature = await x1Connection.sendTransaction(transaction, [userKeypair], {
        skipPreflight: false,
    });

    console.log(`✅ Transaction sent!`);
    console.log(`📝 Signature: ${signature}`);
    console.log(`🔗 Explorer: https://explorer.testnet.x1.xyz/tx/${signature}\n`);

    console.log(`⏳ Waiting for confirmation...\n`);

    const confirmation = await x1Connection.confirmTransaction(signature, 'finalized');

    if (confirmation.value.err) {
        console.error(`\n❌ Transaction failed:`, confirmation.value.err);
        throw new Error('Mint transaction failed!');
    }

    console.log(`\n✅ MINT CONFIRMED!`);
    console.log(`🎉 Successfully minted tokens on X1!\n`);

    // ========================================================================
    // STEP 5: VERIFY
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ STEP 5: Verify');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Check processed burn
    const processedBurnAccount = await x1Connection.getAccountInfo(processedBurn);
    if (!processedBurnAccount) {
        throw new Error('Processed burn not created!');
    }

    console.log(`✅ Processed burn created (${processedBurnAccount.data.length} bytes)`);
    console.log(`✅ Replay protection active\n`);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 SUCCESS!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`📊 Summary:`);
    console.log(`  • Burned on Solana: 0.01 XENCAT (nonce ${CONFIG.BURN_NONCE})`);
    console.log(`  • Minted on X1: 0.01 XENCAT`);
    console.log(`  • Ed25519 signatures verified: ${ed25519Instructions.length}`);
    console.log(`  • Transaction: ${signature}\n`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('\n❌ Error:');
        console.error(error);
        process.exit(1);
    });
