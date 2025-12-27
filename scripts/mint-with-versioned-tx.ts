/**
 * Mint with Versioned Transaction (V0)
 *
 * Versioned transactions can be larger than legacy transactions.
 * This script attempts to use V0 transactions to bypass the size limit.
 */

import 'dotenv/config';
import {
    Connection,
    Keypair,
    PublicKey,
    TransactionMessage,
    VersionedTransaction,
    SystemProgram,
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

    // X1 Testnet
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
    console.log('║  🌉 MINT WITH VERSIONED TRANSACTION (V0)                 ║');
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
    console.log(`🔥 Burn Nonce: ${CONFIG.BURN_NONCE}\n`);

    // Connect to X1
    const x1Connection = new Connection(CONFIG.X1_RPC, 'confirmed');

    // ========================================================================
    // STEP 1: GENERATE PROOF (reuse from previous run)
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔐 STEP 1: Generate Proof');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`⏳ Generating proof...\n`);

    const proof = await generateBurnProof({
        solanaRpc: CONFIG.SOLANA_RPC,
        burnNonce: CONFIG.BURN_NONCE,
        burnProgramId: CONFIG.BURN_PROGRAM.toBase58(),
        userAddress: CONFIG.USER_ADDRESS.toBase58(),
        validatorCount: CONFIG.VALIDATOR_COUNT,
    });

    console.log(`✅ Proof generated!`);
    console.log(`  • Slot: ${proof.slot}`);
    console.log(`  • Validators: ${proof.validatorVotes.length}\n`);

    // ========================================================================
    // STEP 2: BUILD INSTRUCTIONS
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔨 STEP 2: Build Instructions');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Build Ed25519 instructions
    const ed25519Instructions = createValidatorEd25519Instructions(
        proof.validatorVotes,
        proof.blockHash,
        proof.slot
    );

    console.log(`✅ Ed25519 instructions: ${ed25519Instructions.length}\n`);

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
        [Buffer.from('validator_set'), Buffer.from([0])],
        CONFIG.LIGHT_CLIENT_PROGRAM
    );

    const userTokenAccount = await getAssociatedTokenAddress(
        CONFIG.XENCAT_MINT_X1,
        userKeypair.publicKey
    );

    // Get fee receivers
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

    // Encode proof
    const crypto = require('crypto');
    const discriminatorHash = crypto.createHash('sha256').update('global:mint_from_burn').digest();
    const discriminator = discriminatorHash.slice(0, 8);

    const encodedProof = encodeBurnProof(proof);

    const nonceBuffer = Buffer.alloc(8);
    nonceBuffer.writeBigUInt64LE(BigInt(CONFIG.BURN_NONCE));

    const instructionData = Buffer.concat([
        discriminator,
        nonceBuffer,
        encodedProof,
    ]);

    console.log(`📦 Instruction data: ${instructionData.length} bytes\n`);

    // Build mint instruction
    const mintIx = {
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
    };

    // ========================================================================
    // STEP 3: BUILD VERSIONED TRANSACTION (V0)
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔨 STEP 3: Build Versioned Transaction');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const instructions = [...ed25519Instructions, mintIx];

    const { blockhash } = await x1Connection.getLatestBlockhash();

    const messageV0 = new TransactionMessage({
        payerKey: userKeypair.publicKey,
        recentBlockhash: blockhash,
        instructions: instructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);

    console.log(`📦 Transaction version: 0 (versioned)`);
    console.log(`📝 Instructions: ${instructions.length}\n`);

    // ========================================================================
    // STEP 4: SIGN AND SEND
    // ========================================================================

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚀 STEP 4: Sign and Send');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    transaction.sign([userKeypair]);

    console.log(`📤 Sending to X1 testnet...\n`);

    const signature = await x1Connection.sendTransaction(transaction, {
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

    // Verify
    const processedBurnAccount = await x1Connection.getAccountInfo(processedBurn);
    if (!processedBurnAccount) {
        throw new Error('Processed burn not created!');
    }

    console.log(`✅ Processed burn created`);
    console.log(`✅ Replay protection active\n`);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 SUCCESS!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`📊 Summary:`);
    console.log(`  • Burned: 0.01 XENCAT (nonce ${CONFIG.BURN_NONCE})`);
    console.log(`  • Minted: 0.01 XENCAT on X1`);
    console.log(`  • Validators: ${ed25519Instructions.length}`);
    console.log(`  • Transaction: ${signature}\n`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('\n❌ Error:');
        console.error(error);
        process.exit(1);
    });
