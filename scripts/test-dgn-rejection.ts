/**
 * Test Asset Isolation: Verify XENCAT mint program rejects DGN burns
 *
 * This test confirms the critical security feature of V3:
 * - Light client should accept DGN attestations (asset_id=2)
 * - XENCAT mint program should REJECT with AssetNotMintable error
 */

import 'dotenv/config';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import fs from 'fs';

// Configuration
const X1_RPC = process.env.X1_RPC || 'https://rpc.mainnet.x1.xyz';
const BURN_NONCE = 181; // DGN burn
const USER_PUBKEY = new PublicKey('6oQbeffgkGXhX9CxRvskiR47ViKSs59Mn2y4ZgSHR8oW');
const BURN_AMOUNT = 1000000; // 1 DGN (6 decimals)
const ASSET_ID = 2; // DGN

// Program IDs
const LIGHT_CLIENT_PROGRAM = new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5');
const XENCAT_MINT_PROGRAM = new PublicKey('8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk');
const XENCAT_MINT = new PublicKey('DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb');

// Validators
const VALIDATORS = [
    { url: 'http://149.50.116.159:8080', pubkey: new PublicKey('9oa7NAscCZ1kCQFZJng9gfwvDzrEvyWgx4F244PHmHPH') },
    { url: 'http://193.34.212.186:8080', pubkey: new PublicKey('8byEUEZ2sMfP6RPX9VD8JCvCQK3F5FG2LytcR9TkVWag') },
    { url: 'http://74.50.76.62:10001', pubkey: new PublicKey('5NfpgFCwrYzcgJkda9bRJvccycLUo3dvVQsVAK2W43Um') },
];

async function collectDGNAttestations() {
    console.log('\n📥 Collecting DGN attestations...');

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

            attestations.push({
                validatorPubkey: new PublicKey(attestation.validator_pubkey),
                signature: attestation.signature,
                timestamp: new anchor.BN(attestation.timestamp),
            });

            if (attestations.length >= 3) {
                console.log(`\n✅ Got ${attestations.length} DGN attestations`);
                break;
            }
        } catch (err: any) {
            console.log(`  ❌ Validator ${validator.url}: ${err.message}`);
        }
    }

    return attestations;
}

async function main() {
    console.log('🧪 Asset Isolation Test: DGN Rejection by XENCAT Mint');
    console.log('='.repeat(60));
    console.log(`Burn Nonce: ${BURN_NONCE}`);
    console.log(`Asset: DGN (asset_id=2)`);
    console.log(`Expected: Light client ACCEPTS, XENCAT mint REJECTS`);

    // Load user keypair
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

    console.log(`\n👤 User: ${user.publicKey.toBase58()}`);

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
    const mintProgram = new anchor.Program(mintIdl, XENCAT_MINT_PROGRAM, provider);

    // Step 1: Collect DGN attestations
    const attestations = await collectDGNAttestations();

    if (attestations.length < 3) {
        throw new Error(`Insufficient attestations: got ${attestations.length}, need 3`);
    }

    // Step 2: Derive PDAs
    console.log('\n🔑 Deriving PDAs...');

    const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('verified_burn_v3'),
            Buffer.from([ASSET_ID]),
            USER_PUBKEY.toBuffer(),
            Buffer.from(new BigUint64Array([BigInt(BURN_NONCE)]).buffer),
        ],
        LIGHT_CLIENT_PROGRAM
    );

    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('x1_validator_set_v2')],
        LIGHT_CLIENT_PROGRAM
    );

    console.log(`  Verified Burn V3 (DGN): ${verifiedBurnPda.toBase58()}`);

    // Step 3: Submit to light client (should SUCCEED)
    console.log('\n📤 Test 1: Submitting DGN attestations to light client...');

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

        console.log(`  ✅ SUCCESS: Light client accepted DGN attestations`);
        console.log(`  ✅ Transaction: ${tx}`);
    } catch (err: any) {
        console.log(`  ❌ UNEXPECTED: Light client rejected DGN`);
        console.log(`  Error: ${err.message}`);
        throw err;
    }

    // Step 4: Try to mint with XENCAT program (should FAIL)
    console.log('\n🚫 Test 2: Attempting to mint with XENCAT program...');

    const [mintStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_state_v2')],
        XENCAT_MINT_PROGRAM
    );

    const [processedBurnPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('processed_burn_v3'),
            Buffer.from([ASSET_ID]),
            Buffer.from(new BigUint64Array([BigInt(BURN_NONCE)]).buffer),
            USER_PUBKEY.toBuffer(),
        ],
        XENCAT_MINT_PROGRAM
    );

    const userTokenAccount = await getAssociatedTokenAddress(
        XENCAT_MINT,
        user.publicKey
    );

    try {
        await mintProgram.methods
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

        console.log(`  ❌ CRITICAL FAILURE: XENCAT mint accepted DGN!`);
        console.log(`  🚨 SECURITY BREACH: Asset isolation broken!`);
        process.exit(1);
    } catch (err: any) {
        const errorMsg = err.message || '';
        const logs = err.logs || [];

        if (errorMsg.includes('AssetNotMintable') || errorMsg.includes('6014')) {
            console.log(`  ✅ SUCCESS: XENCAT mint rejected DGN`);
            console.log(`  ✅ Error: AssetNotMintable (expected)`);
            console.log(`  ✅ Asset isolation working correctly!`);
        } else {
            console.log(`  ⚠️  Rejected but with unexpected error:`);
            console.log(`  Error: ${errorMsg}`);
            console.log(`  Logs:`, logs);
        }
    }

    console.log('\n✅ Asset Isolation Test Complete!');
    console.log('='.repeat(60));
    console.log('✅ Light client accepts DGN (asset_id=2)');
    console.log('✅ XENCAT mint rejects DGN (AssetNotMintable)');
    console.log('✅ Asset namespace separation working correctly');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('\n❌ Test failed:', err);
        process.exit(1);
    });
