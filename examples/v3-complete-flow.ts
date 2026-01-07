/**
 * COMPLETE V3 BRIDGE FLOW EXAMPLE
 *
 * This example demonstrates the complete asset-aware bridge flow:
 * 1. Burn XENCAT on Solana
 * 2. Collect V3 attestations from validators
 * 3. Submit attestations to X1 light client
 * 4. Mint XENCAT on X1
 *
 * Usage:
 *   BURN_AMOUNT=1000000 USER_PRIVATE_KEY=<key> ts-node examples/v3-complete-flow.ts
 */

import 'dotenv/config';
import * as anchor from '@coral-xyz/anchor';
import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    SystemProgram,
    sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    createBurnInstruction,
} from '@solana/spl-token';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// CONFIGURATION
// ============================================================================

const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const X1_RPC = 'https://rpc.mainnet.x1.xyz';

const XENCAT_MINT_SOLANA = new PublicKey('7UN8WkBumTUCofVPXCPjNWQ6msQhzrg9tFQRP48Nmw5V');
const XENCAT_MINT_X1 = new PublicKey('DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb');
const BURN_PROGRAM_SOLANA = new PublicKey('2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp');

const LIGHT_CLIENT_PROGRAM_X1 = new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5');
const MINT_PROGRAM_X1 = new PublicKey('8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk');

const VALIDATORS = [
    'http://149.50.116.159:8080',
    'http://193.34.212.186:8080',
    'http://74.50.76.62:10001',
    'http://149.50.116.21:8080',
    'http://64.20.49.142:8080',
];

const VALIDATOR_PUBKEYS = [
    new PublicKey('9oa7NAscCZ1kCQFZJng9gfwvDzrEvyWgx4F244PHmHPH'),
    new PublicKey('8byEUEZ2sMfP6RPX9VD8JCvCQK3F5FG2LytcR9TkVWag'),
    new PublicKey('5NfpgFCwrYzcgJkda9bRJvccycLUo3dvVQsVAK2W43Um'),
    new PublicKey('GdbXi56fCSQ1joCvGjqm7JKvqvwgtKh6xeusUqZbB3rH'),
    new PublicKey('FmuuFgRh8NP8UD7QHg86f7vu7qpsmr1wE7hB59oojDpj'),
];

enum Asset {
    XENCAT = 1,
    DGN = 2,
}

// ============================================================================
// STEP 1: BURN XENCAT ON SOLANA
// ============================================================================

async function burnXencatOnSolana(
    userKeypair: Keypair,
    amount: number
): Promise<{ burnNonce: number; signature: string }> {
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║   STEP 1: Burn XENCAT on Solana                      ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    const solanaConnection = new Connection(SOLANA_RPC, 'confirmed');

    // Get user's token account
    const userTokenAccount = await getAssociatedTokenAddress(
        XENCAT_MINT_SOLANA,
        userKeypair.publicKey
    );

    console.log(`👤 User: ${userKeypair.publicKey.toBase58()}`);
    console.log(`🔥 Burning: ${amount} tokens (${amount / 1e6} XENCAT)`);
    console.log(`📍 Token account: ${userTokenAccount.toBase58()}\n`);

    // Derive burn record PDA
    // Get next nonce (simplified - in production, query from chain)
    const burnNonce = Date.now(); // Use timestamp as nonce for uniqueness

    const [burnRecordPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('burn_record'),
            userKeypair.publicKey.toBuffer(),
            Buffer.from(new BigUint64Array([BigInt(burnNonce)]).buffer),
        ],
        BURN_PROGRAM_SOLANA
    );

    console.log(`🔑 Burn Record PDA: ${burnRecordPda.toBase58()}`);
    console.log(`🔢 Burn Nonce: ${burnNonce}\n`);

    // Create burn transaction
    const burnIx = createBurnInstruction(
        userTokenAccount,
        XENCAT_MINT_SOLANA,
        userKeypair.publicKey,
        amount
    );

    // Create burn record instruction (from burn program)
    // Note: This is a simplified example. In production, use the actual burn program instruction
    const createBurnRecordIx = new anchor.web3.TransactionInstruction({
        programId: BURN_PROGRAM_SOLANA,
        keys: [
            { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: burnRecordPda, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([
            Buffer.from([0]), // Instruction discriminator (burn instruction)
            Buffer.from(new BigUint64Array([BigInt(burnNonce)]).buffer),
            Buffer.from(new BigUint64Array([BigInt(amount)]).buffer),
        ]),
    });

    const tx = new Transaction().add(burnIx, createBurnRecordIx);

    console.log('📤 Sending burn transaction...');
    const signature = await sendAndConfirmTransaction(solanaConnection, tx, [userKeypair]);

    console.log(`✅ Burn successful!`);
    console.log(`📝 Signature: ${signature}\n`);

    // Wait for finality (32 slots ≈ 13 seconds)
    console.log('⏳ Waiting for finality (32 slots ≈ 13 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 15000));
    console.log('✅ Burn finalized\n');

    return { burnNonce, signature };
}

// ============================================================================
// STEP 2: COLLECT V3 ATTESTATIONS FROM VALIDATORS
// ============================================================================

async function collectAttestationsV3(
    burnNonce: number,
    user: PublicKey,
    amount: number
): Promise<any[]> {
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║   STEP 2: Collect V3 Attestations from Validators    ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    // Get current validator set version from X1
    const x1Connection = new Connection(X1_RPC, 'confirmed');
    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('x1_validator_set_v2')],
        LIGHT_CLIENT_PROGRAM_X1
    );

    const validatorSetAccount = await x1Connection.getAccountInfo(validatorSetPda);
    if (!validatorSetAccount) {
        throw new Error('Validator set not found on X1');
    }

    const validatorSetVersion = Number(validatorSetAccount.data.readBigUInt64LE(8));
    console.log(`📊 Current validator set version: ${validatorSetVersion}\n`);

    const attestations = [];

    for (let i = 0; i < VALIDATORS.length; i++) {
        const validatorUrl = VALIDATORS[i];
        console.log(`🔍 Requesting attestation from validator ${i + 1}...`);
        console.log(`   URL: ${validatorUrl}`);

        try {
            const response = await fetch(`${validatorUrl}/attest-burn-v3`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    burn_nonce: burnNonce,
                    user: user.toBase58(),
                    amount,
                    validator_set_version: validatorSetVersion,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.log(`   ❌ Failed: ${response.status} - ${errorText}\n`);
                continue;
            }

            const attestation = await response.json();
            console.log(`   ✅ Received attestation`);
            console.log(`   Asset ID: ${attestation.asset_id} (${attestation.asset_name})`);
            console.log(`   Validator: ${attestation.validator_pubkey}\n`);

            attestations.push(attestation);

            // Need at least 3 attestations (threshold)
            if (attestations.length >= 3) {
                console.log(`✅ Collected ${attestations.length} attestations (threshold met)\n`);
                break;
            }
        } catch (err: any) {
            console.log(`   ❌ Error: ${err.message}\n`);
        }
    }

    if (attestations.length < 3) {
        throw new Error(`Insufficient attestations: got ${attestations.length}, need 3`);
    }

    return attestations;
}

// ============================================================================
// STEP 3: SUBMIT ATTESTATIONS TO X1 LIGHT CLIENT
// ============================================================================

async function submitAttestationsToX1(
    userKeypair: Keypair,
    assetId: number,
    burnNonce: number,
    attestations: any[]
): Promise<PublicKey> {
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║   STEP 3: Submit Attestations to X1 Light Client     ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    const x1Connection = new Connection(X1_RPC, 'confirmed');
    const provider = new anchor.AnchorProvider(
        x1Connection,
        new anchor.Wallet(userKeypair),
        { commitment: 'confirmed' }
    );

    // Load light client program
    const lightClientIdlPath = path.join(__dirname, '../target/idl/solana_light_client_x1.json');
    const lightClientIdl = JSON.parse(fs.readFileSync(lightClientIdlPath, 'utf-8'));
    const lightClientProgram = new anchor.Program(
        lightClientIdl,
        LIGHT_CLIENT_PROGRAM_X1,
        provider
    );

    // Derive PDAs
    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('x1_validator_set_v2')],
        LIGHT_CLIENT_PROGRAM_X1
    );

    const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('verified_burn_v3'),
            Buffer.from([assetId]),
            userKeypair.publicKey.toBuffer(),
            Buffer.from(new BigUint64Array([BigInt(burnNonce)]).buffer),
        ],
        LIGHT_CLIENT_PROGRAM_X1
    );

    console.log(`🔑 Validator Set PDA: ${validatorSetPda.toBase58()}`);
    console.log(`🔑 Verified Burn PDA: ${verifiedBurnPda.toBase58()}\n`);

    // Build attestation data
    const attestationData = {
        assetId,
        burnNonce,
        user: userKeypair.publicKey,
        amount: attestations[0].amount,
        validatorSetVersion: attestations[0].validator_set_version,
        attestations: attestations.map(a => ({
            validatorPubkey: new PublicKey(a.validator_pubkey),
            signature: Array.from(Buffer.from(a.signature, 'hex')),
            timestamp: a.timestamp,
        })),
    };

    console.log('📤 Submitting attestations to light client...');

    try {
        const tx = await lightClientProgram.methods
            .submitBurnAttestationV3(assetId, burnNonce, attestationData)
            .accounts({
                user: userKeypair.publicKey,
                validatorSet: validatorSetPda,
                verifiedBurn: verifiedBurnPda,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        console.log(`✅ Attestations verified!`);
        console.log(`📝 Transaction: ${tx}\n`);
    } catch (err: any) {
        console.error('❌ Failed to submit attestations:', err.message);
        throw err;
    }

    return verifiedBurnPda;
}

// ============================================================================
// STEP 4: MINT XENCAT ON X1
// ============================================================================

async function mintXencatOnX1(
    userKeypair: Keypair,
    assetId: number,
    burnNonce: number
): Promise<string> {
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║   STEP 4: Mint XENCAT on X1                           ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    const x1Connection = new Connection(X1_RPC, 'confirmed');
    const provider = new anchor.AnchorProvider(
        x1Connection,
        new anchor.Wallet(userKeypair),
        { commitment: 'confirmed' }
    );

    // Load mint program
    const mintIdlPath = path.join(__dirname, '../target/idl/xencat_mint_x1.json');
    const mintIdl = JSON.parse(fs.readFileSync(mintIdlPath, 'utf-8'));
    const mintProgram = new anchor.Program(mintIdl, MINT_PROGRAM_X1, provider);

    // Derive PDAs
    const [mintStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_state_v2')],
        MINT_PROGRAM_X1
    );

    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('x1_validator_set_v2')],
        LIGHT_CLIENT_PROGRAM_X1
    );

    const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('verified_burn_v3'),
            Buffer.from([assetId]),
            userKeypair.publicKey.toBuffer(),
            Buffer.from(new BigUint64Array([BigInt(burnNonce)]).buffer),
        ],
        LIGHT_CLIENT_PROGRAM_X1
    );

    const [processedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('processed_burn_v3'),
            Buffer.from([assetId]),
            Buffer.from(new BigUint64Array([BigInt(burnNonce)]).buffer),
            userKeypair.publicKey.toBuffer(),
        ],
        MINT_PROGRAM_X1
    );

    // Get user's token account on X1
    const userTokenAccount = await getAssociatedTokenAddress(
        XENCAT_MINT_X1,
        userKeypair.publicKey
    );

    console.log(`🔑 Mint State PDA: ${mintStatePda.toBase58()}`);
    console.log(`🔑 Verified Burn PDA: ${verifiedBurnPda.toBase58()}`);
    console.log(`🔑 Processed Burn PDA: ${processedBurnPda.toBase58()}`);
    console.log(`📍 User Token Account: ${userTokenAccount.toBase58()}\n`);

    console.log('📤 Minting XENCAT tokens...');

    try {
        const tx = await mintProgram.methods
            .mintFromBurnV3(burnNonce, assetId)
            .accounts({
                mintState: mintStatePda,
                xencatMint: XENCAT_MINT_X1,
                processedBurn: processedBurnPda,
                userTokenAccount,
                user: userKeypair.publicKey,
                validatorSet: validatorSetPda,
                verifiedBurn: verifiedBurnPda,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .remainingAccounts(
                // Pass validator accounts for fee distribution
                VALIDATOR_PUBKEYS.map(v => ({
                    pubkey: v,
                    isWritable: true,
                    isSigner: false,
                }))
            )
            .rpc();

        console.log(`✅ XENCAT minted successfully!`);
        console.log(`📝 Transaction: ${tx}\n`);
        console.log(`💰 Fees distributed to ${VALIDATOR_PUBKEYS.length} validators\n`);

        return tx;
    } catch (err: any) {
        console.error('❌ Failed to mint:', err.message);
        throw err;
    }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║                                                       ║');
    console.log('║      XENCAT BRIDGE V3 - COMPLETE FLOW EXAMPLE        ║');
    console.log('║                                                       ║');
    console.log('╚═══════════════════════════════════════════════════════╝');

    // Load user keypair
    const privateKeyEnv = process.env.USER_PRIVATE_KEY;
    if (!privateKeyEnv) {
        throw new Error('USER_PRIVATE_KEY environment variable required');
    }

    let userKeypair: Keypair;
    try {
        const privateKeyArray = JSON.parse(privateKeyEnv);
        userKeypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
    } catch {
        userKeypair = Keypair.fromSecretKey(bs58.decode(privateKeyEnv));
    }

    const burnAmount = parseInt(process.env.BURN_AMOUNT || '1000000'); // Default: 1 XENCAT

    console.log('\n📋 Configuration:');
    console.log(`   User: ${userKeypair.publicKey.toBase58()}`);
    console.log(`   Amount: ${burnAmount} (${burnAmount / 1e6} XENCAT)`);
    console.log(`   Asset: XENCAT (asset_id=1)`);

    try {
        // Step 1: Burn on Solana
        const { burnNonce } = await burnXencatOnSolana(userKeypair, burnAmount);

        // Step 2: Collect attestations
        const attestations = await collectAttestationsV3(
            burnNonce,
            userKeypair.publicKey,
            burnAmount
        );

        // Step 3: Submit to X1
        await submitAttestationsToX1(
            userKeypair,
            Asset.XENCAT,
            burnNonce,
            attestations
        );

        // Step 4: Mint on X1
        await mintXencatOnX1(userKeypair, Asset.XENCAT, burnNonce);

        console.log('\n╔═══════════════════════════════════════════════════════╗');
        console.log('║                                                       ║');
        console.log('║              ✅ BRIDGE FLOW COMPLETE!                 ║');
        console.log('║                                                       ║');
        console.log('╚═══════════════════════════════════════════════════════╝\n');

    } catch (err: any) {
        console.error('\n╔═══════════════════════════════════════════════════════╗');
        console.error('║                                                       ║');
        console.error('║                 ❌ FLOW FAILED                        ║');
        console.error('║                                                       ║');
        console.error('╚═══════════════════════════════════════════════════════╝\n');
        console.error('Error:', err.message);
        if (err.logs) {
            console.error('\nTransaction logs:');
            err.logs.forEach((log: string) => console.error(log));
        }
        process.exit(1);
    }
}

main().catch(console.error);
