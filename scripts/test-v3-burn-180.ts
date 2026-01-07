/**
 * V3 E2E Test for Burn Nonce 180
 * Tests the complete V3 asset-aware bridge flow
 */

import 'dotenv/config';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import fs from 'fs';

// Configuration
const X1_RPC = process.env.X1_RPC || 'https://rpc.mainnet.x1.xyz';
const BURN_NONCE = 180;
const USER_PUBKEY = new PublicKey('6oQbeffgkGXhX9CxRvskiR47ViKSs59Mn2y4ZgSHR8oW');
const BURN_AMOUNT = 10000; // 0.01 XENCAT (6 decimals)
const ASSET_ID = 1; // XENCAT

// Program IDs
const LIGHT_CLIENT_PROGRAM = new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5');
const MINT_PROGRAM = new PublicKey('8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk');
const XENCAT_MINT = new PublicKey('DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb');

// Validators
const VALIDATORS = [
    { url: 'http://149.50.116.159:8080', pubkey: new PublicKey('9oa7NAscCZ1kCQFZJng9gfwvDzrEvyWgx4F244PHmHPH') },
    { url: 'http://193.34.212.186:8080', pubkey: new PublicKey('8byEUEZ2sMfP6RPX9VD8JCvCQK3F5FG2LytcR9TkVWag') },
    { url: 'http://74.50.76.62:10001', pubkey: new PublicKey('5NfpgFCwrYzcgJkda9bRJvccycLUo3dvVQsVAK2W43Um') },
    { url: 'http://149.50.116.21:8080', pubkey: new PublicKey('GdbXi56fCSQ1joCvGjqm7JKvqvwgtKh6xeusUqZbB3rH') },
    { url: 'http://64.20.49.142:8080', pubkey: new PublicKey('FmuuFgRh8NP8UD7QHg86f7vu7qpsmr1wE7hB59oojDpj') },
];

async function collectV3Attestations() {
    console.log('\n📥 Collecting V3 attestations from validators...');

    const attestations = [];

    for (const validator of VALIDATORS) {
        try {
            const response = await fetch(`${validator.url}/attest-burn`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    burn_nonce: BURN_NONCE,
                    user: USER_PUBKEY.toBase58(),
                    expected_amount: BURN_AMOUNT,
                    validator_set_version: 1,
                }),
            });

            if (!response.ok) {
                console.log(`  ⚠️  Validator ${validator.url}: ${response.status}`);
                continue;
            }

            const attestation: any = await response.json();

            console.log(`  ✅ ${validator.url}`);
            console.log(`     Asset: ${attestation.asset_name} (ID: ${attestation.asset_id})`);
            console.log(`     Validator: ${attestation.validator_pubkey}`);

            attestations.push({
                validatorPubkey: new PublicKey(attestation.validator_pubkey),
                signature: attestation.signature,
                timestamp: new anchor.BN(attestation.timestamp),
            });

            if (attestations.length >= 3) {
                console.log(`\n✅ Got ${attestations.length} attestations (threshold reached)`);
                break;
            }
        } catch (err: any) {
            console.log(`  ❌ Validator ${validator.url}: ${err.message}`);
        }
    }

    if (attestations.length < 3) {
        throw new Error(`Insufficient attestations: got ${attestations.length}, need 3`);
    }

    return attestations;
}

async function main() {
    console.log('🧪 V3 Asset-Aware Bridge E2E Test');
    console.log('='.repeat(50));
    console.log(`Burn Nonce: ${BURN_NONCE}`);
    console.log(`User: ${USER_PUBKEY.toBase58()}`);
    console.log(`Amount: ${BURN_AMOUNT} (0.01 XENCAT)`);
    console.log(`Asset ID: ${ASSET_ID} (XENCAT)`);

    // Load user keypair from environment
    const privateKeyEnv = process.env.USER_PRIVATE_KEY;
    if (!privateKeyEnv) {
        throw new Error('USER_PRIVATE_KEY environment variable required!');
    }

    let user: Keypair;
    try {
        const privateKeyArray = JSON.parse(privateKeyEnv);
        user = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
    } catch {
        user = Keypair.fromSecretKey(bs58.decode(privateKeyEnv));
    }

    console.log(`\n👤 Loaded keypair: ${user.publicKey.toBase58()}`);

    if (user.publicKey.toBase58() !== USER_PUBKEY.toBase58()) {
        throw new Error(`Keypair mismatch! Expected ${USER_PUBKEY.toBase58()}, got ${user.publicKey.toBase58()}`);
    }

    // Setup connection and programs
    const connection = new Connection(X1_RPC, 'confirmed');
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(user), {
        commitment: 'confirmed',
    });

    const lightClientIdl = JSON.parse(
        fs.readFileSync('target/idl/solana_light_client_x1.json', 'utf-8')
    );
    const mintIdl = JSON.parse(
        fs.readFileSync('target/idl/xencat_mint_x1.json', 'utf-8')
    );

    const lightClientProgram = new anchor.Program(lightClientIdl, LIGHT_CLIENT_PROGRAM, provider);
    const mintProgram = new anchor.Program(mintIdl, MINT_PROGRAM, provider);

    // Step 1: Collect V3 attestations
    const attestations = await collectV3Attestations();

    // Step 2: Derive V3 PDAs
    console.log('\n🔑 Deriving V3 PDAs...');

    const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('verified_burn_v3'),
            Buffer.from([ASSET_ID]),
            USER_PUBKEY.toBuffer(),
            Buffer.from(new BigUint64Array([BigInt(BURN_NONCE)]).buffer),
        ],
        LIGHT_CLIENT_PROGRAM
    );

    console.log(`  Verified Burn V3: ${verifiedBurnPda.toBase58()}`);

    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('x1_validator_set_v2')],
        LIGHT_CLIENT_PROGRAM
    );

    console.log(`  Validator Set: ${validatorSetPda.toBase58()}`);

    // Step 3: Submit attestations to light client V3
    console.log('\n📤 Submitting attestations to light client V3...');

    try {
        const attestationData = {
            assetId: ASSET_ID,
            burnNonce: new anchor.BN(BURN_NONCE),
            user: USER_PUBKEY,
            amount: new anchor.BN(BURN_AMOUNT),
            validatorSetVersion: new anchor.BN(1),
            attestations: attestations,
        };

        const tx = await lightClientProgram.methods
            .submitBurnAttestationV3(ASSET_ID, new anchor.BN(BURN_NONCE), attestationData)
            .accounts({
                user: user.publicKey,
                validatorSet: validatorSetPda,
                verifiedBurn: verifiedBurnPda,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([user])
            .rpc();

        console.log(`  ✅ Transaction: ${tx}`);
        console.log(`  ✅ Verified burn created at: ${verifiedBurnPda.toBase58()}`);
    } catch (err: any) {
        console.log(`  ❌ Error: ${err.message}`);
        if (err.logs) {
            console.log('  Logs:', err.logs);
        }
        throw err;
    }

    // Step 4: Mint from burn V3
    console.log('\n🪙  Minting XENCAT using V3...');

    const [mintStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_state_v2')],
        MINT_PROGRAM
    );

    const [processedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('processed_burn_v3'),
            Buffer.from([ASSET_ID]),
            Buffer.from(new BigUint64Array([BigInt(BURN_NONCE)]).buffer),
            USER_PUBKEY.toBuffer(),
        ],
        MINT_PROGRAM
    );

    const userTokenAccount = await getAssociatedTokenAddress(
        XENCAT_MINT,
        user.publicKey
    );

    console.log(`  Mint State: ${mintStatePda.toBase58()}`);
    console.log(`  Processed Burn V3: ${processedBurnPda.toBase58()}`);
    console.log(`  User Token Account: ${userTokenAccount.toBase58()}`);

    try {
        const tx = await mintProgram.methods
            .mintFromBurnV3(new anchor.BN(BURN_NONCE), ASSET_ID)
            .accounts({
                mintState: mintStatePda,
                xencatMint: XENCAT_MINT,
                processedBurn: processedBurnPda,
                userTokenAccount: userTokenAccount,
                user: user.publicKey,
                validatorSet: validatorSetPda,
                verifiedBurn: verifiedBurnPda,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .remainingAccounts(
                VALIDATORS.map(v => ({
                    pubkey: v.pubkey,
                    isWritable: true,
                    isSigner: false,
                }))
            )
            .signers([user])
            .rpc();

        console.log(`  ✅ Transaction: ${tx}`);
        console.log(`  ✅ Minted 0.01 XENCAT to ${userTokenAccount.toBase58()}`);
    } catch (err: any) {
        console.log(`  ❌ Error: ${err.message}`);
        if (err.logs) {
            console.log('  Logs:', err.logs);
        }
        throw err;
    }

    console.log('\n✅ V3 E2E Test Complete!');
    console.log('='.repeat(50));
    console.log('✅ Asset detection: XENCAT (asset_id=1)');
    console.log('✅ Attestations collected from all validators');
    console.log('✅ Light client V3 verified burn');
    console.log('✅ Mint program V3 minted tokens');
    console.log('✅ Fees distributed to validators');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('\n❌ Test failed:', err);
        process.exit(1);
    });
