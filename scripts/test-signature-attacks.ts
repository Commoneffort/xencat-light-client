import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { SolanaLightClientX1 } from '../target/types/solana_light_client_x1';
import * as fs from 'fs';
import fetch from 'node-fetch';
import 'dotenv/config';

const X1_RPC = 'https://rpc.mainnet.x1.xyz';
const BURN_AMOUNT = 10000;

const VALIDATORS = [
    { name: 'Validator 3', api: 'http://74.50.76.62:10001', pubkey: new PublicKey('5NfpgFCwrYzcgJkda9bRJvccycLUo3dvVQsVAK2W43Um') },
    { name: 'Validator 4', api: 'http://149.50.116.21:8080', pubkey: new PublicKey('GdbXi56fCSQ1joCvGjqm7JKvqvwgtKh6xeusUqZbB3rH') },
    { name: 'Validator 5', api: 'http://64.20.49.142:8080', pubkey: new PublicKey('FmuuFgRh8NP8UD7QHg86f7vu7qpsmr1wE7hB59oojDpj') },
];

async function main() {
    console.log('🔐 SIGNATURE ATTACK TESTS');
    console.log('━'.repeat(60));

    // Load keypair
    let userKeypair: Keypair;
    const userPrivateKey = process.env.USER_PRIVATE_KEY;

    if (userPrivateKey) {
        try {
            const privateKeyArray = JSON.parse(userPrivateKey);
            userKeypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
        } catch {
            const bs58 = require('bs58');
            userKeypair = Keypair.fromSecretKey(bs58.decode(userPrivateKey));
        }
    } else {
        const keypairPath = process.env.HOME + '/.config/solana/identity.json';
        const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
        userKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    }

    console.log('👤 User:', userKeypair.publicKey.toBase58());

    // Setup connection
    const x1Connection = new Connection(X1_RPC, 'confirmed');
    const x1Provider = new anchor.AnchorProvider(
        x1Connection,
        new anchor.Wallet(userKeypair),
        { commitment: 'confirmed' }
    );

    // Load light client program
    const lightClientProgramId = new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5');
    const lightClientIdl = JSON.parse(fs.readFileSync('./target/idl/solana_light_client_x1.json', 'utf-8'));
    const lightClientProgram = new Program(lightClientIdl, lightClientProgramId, x1Provider) as Program<SolanaLightClientX1>;

    // Get validator set
    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('x1_validator_set_v2')],
        lightClientProgram.programId
    );

    const validatorSet = await lightClientProgram.account.x1ValidatorSet.fetch(validatorSetPda);
    const currentVersion = validatorSet.version.toNumber();

    console.log(`📊 Validator Set Version: ${currentVersion}\n`);

    // TEST 7.2: Duplicate Among Valid Set
    console.log('━'.repeat(60));
    console.log('TEST 7.2: Duplicate Among Valid Set');
    console.log('━'.repeat(60));

    const BURN_NONCE_7_2 = parseInt(process.env.BURN_NONCE_7_2 || '0');

    if (BURN_NONCE_7_2 > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_7_2}`);
        console.log('⏳ Waiting 20 seconds for finality...\n');
        await new Promise(resolve => setTimeout(resolve, 20000));

        // Get attestations from V3 and V4
        console.log('📡 Collecting attestations from V3 and V4...');
        const attestations = [];

        for (let i = 0; i < 2; i++) {
            try {
                const response = await fetch(`${VALIDATORS[i].api}/attest-burn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        burn_nonce: BURN_NONCE_7_2,
                        user: userKeypair.publicKey.toBase58(),
                        expected_amount: BURN_AMOUNT,
                        validator_set_version: currentVersion,
                    }),
                });

                if (response.ok) {
                    const attestation = await response.json();
                    attestations.push(attestation);
                    console.log(`   ✅ ${VALIDATORS[i].name} signed`);
                }
            } catch (error: any) {
                console.log(`   ❌ ${VALIDATORS[i].name}: ${error.message}`);
            }
        }

        if (attestations.length === 2) {
            console.log('\n📋 Creating array: [V3, V4, V3] - duplicate V3');

            const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(BURN_NONCE_7_2).toArrayLike(Buffer, 'le', 8),
                ],
                lightClientProgram.programId
            );

            // Create [V3, V4, V3] - duplicate V3
            const duplicatedAttestations = [
                attestations[0],  // V3
                attestations[1],  // V4
                attestations[0],  // V3 again (duplicate)
            ];

            const attestationData = {
                burnNonce: new anchor.BN(BURN_NONCE_7_2),
                user: userKeypair.publicKey,
                amount: new anchor.BN(BURN_AMOUNT),
                validatorSetVersion: new anchor.BN(currentVersion),
                attestations: duplicatedAttestations.map(a => ({
                    validatorPubkey: new PublicKey(a.validator_pubkey),
                    signature: a.signature,
                    timestamp: new anchor.BN(a.timestamp),
                })),
            };

            try {
                const tx = await lightClientProgram.methods
                    .submitBurnAttestation(attestationData)
                    .accounts({
                        user: userKeypair.publicKey,
                        validatorSet: validatorSetPda,
                        verifiedBurn: verifiedBurnPda,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();

                console.log('\n❌ TEST FAILED: Duplicate among valid set was accepted!');
                console.log(`📝 TX: ${tx}`);

            } catch (error: any) {
                console.log('\n✅ TEST PASSED: Duplicate among valid set rejected!');

                if (error.message.includes('DuplicateValidator') || error.message.includes('0x1001')) {
                    console.log('🔒 Reason: DuplicateValidator error');
                } else {
                    console.log(`📝 Error: ${error.message.substring(0, 100)}`);
                }
            }
        } else {
            console.log(`\n❌ Only got ${attestations.length} attestations, need 2`);
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_7_2 to run Test 7.2');
    }

    // TEST 4.2: Wrong Message Signature (Signature Replay)
    console.log('\n━'.repeat(60));
    console.log('TEST 4.2: Wrong Message Signature (Cross-Burn Replay)');
    console.log('━'.repeat(60));

    const BURN_NONCE_4_2_A = parseInt(process.env.BURN_NONCE_4_2_A || '0');
    const BURN_NONCE_4_2_B = parseInt(process.env.BURN_NONCE_4_2_B || '0');

    if (BURN_NONCE_4_2_A > 0 && BURN_NONCE_4_2_B > 0) {
        console.log(`\n🔥 Burn A (Source): ${BURN_NONCE_4_2_A}`);
        console.log(`🔥 Burn B (Target): ${BURN_NONCE_4_2_B}`);
        console.log('\n⏳ Waiting 20 seconds for finality...\n');
        await new Promise(resolve => setTimeout(resolve, 20000));

        // Get attestations for Burn A
        console.log('📡 Collecting attestations for Burn A...');
        const burnAAttestations = [];

        for (const validator of VALIDATORS) {
            try {
                const response = await fetch(`${validator.api}/attest-burn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        burn_nonce: BURN_NONCE_4_2_A,
                        user: userKeypair.publicKey.toBase58(),
                        expected_amount: BURN_AMOUNT,
                        validator_set_version: currentVersion,
                    }),
                });

                if (response.ok) {
                    const attestation = await response.json();
                    burnAAttestations.push(attestation);
                    console.log(`   ✅ ${validator.name} signed Burn A`);
                }
            } catch (error: any) {
                console.log(`   ❌ ${validator.name}: ${error.message}`);
            }
        }

        if (burnAAttestations.length >= 3) {
            console.log(`\n📋 Attempting to use Burn A signatures for Burn B...`);
            console.log('   This tests if signatures are bound to specific burn nonces');

            const [verifiedBurnBPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(BURN_NONCE_4_2_B).toArrayLike(Buffer, 'le', 8),  // Burn B!
                ],
                lightClientProgram.programId
            );

            // Try to use Burn A's attestations for Burn B
            const attestationData = {
                burnNonce: new anchor.BN(BURN_NONCE_4_2_B),  // Burn B nonce
                user: userKeypair.publicKey,
                amount: new anchor.BN(BURN_AMOUNT),
                validatorSetVersion: new anchor.BN(currentVersion),
                attestations: burnAAttestations.slice(0, 3).map(a => ({
                    validatorPubkey: new PublicKey(a.validator_pubkey),
                    signature: a.signature,  // Signatures from Burn A!
                    timestamp: new anchor.BN(a.timestamp),
                })),
            };

            try {
                const tx = await lightClientProgram.methods
                    .submitBurnAttestation(attestationData)
                    .accounts({
                        user: userKeypair.publicKey,
                        validatorSet: validatorSetPda,
                        verifiedBurn: verifiedBurnBPda,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();

                console.log('\n❌ TEST FAILED: Cross-burn signature replay accepted!');
                console.log(`📝 TX: ${tx}`);
                console.log('⚠️  SECURITY ISSUE: Signatures should be bound to specific nonces!');

            } catch (error: any) {
                console.log('\n✅ TEST PASSED: Cross-burn signature replay rejected!');
                console.log(`📝 Error: ${error.message.substring(0, 100)}`);
                console.log('\n🔒 Note: This test relies on validators including nonce in signed message.');
                console.log('   If program uses format-only validation, protection depends on');
                console.log('   validators correctly signing different messages for different nonces.');
            }
        } else {
            console.log(`\n❌ Only got ${burnAAttestations.length} attestations for Burn A`);
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_4_2_A and BURN_NONCE_4_2_B to run Test 4.2');
    }

    console.log('\n━'.repeat(60));
    console.log('🎉 SIGNATURE ATTACK TESTS COMPLETE!');
    console.log('━'.repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
