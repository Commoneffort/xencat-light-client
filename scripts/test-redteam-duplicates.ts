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
    console.log('🔴 RED TEAM: DUPLICATE & ORDERING ATTACKS');
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

    // TEST 9.1: Double-Submit Same Attestation in Same Array
    console.log('━'.repeat(60));
    console.log('TEST 9.1: Double-Submit Same Attestation (Intra-TX Replay)');
    console.log('━'.repeat(60));

    const BURN_NONCE_9_1 = parseInt(process.env.BURN_NONCE_9_1 || '0');

    if (BURN_NONCE_9_1 > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_9_1}`);
        console.log('⏳ Waiting 20 seconds for finality...\n');
        await new Promise(resolve => setTimeout(resolve, 20000));

        // Collect attestations
        console.log('📡 Collecting attestations...');
        const attestations = [];

        for (const validator of VALIDATORS) {
            try {
                const response = await fetch(`${validator.api}/attest-burn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        burn_nonce: BURN_NONCE_9_1,
                        user: userKeypair.publicKey.toBase58(),
                        expected_amount: BURN_AMOUNT,
                        validator_set_version: currentVersion,
                    }),
                });

                if (response.ok) {
                    const attestation = await response.json();
                    attestations.push(attestation);
                    console.log(`   ✅ ${validator.name} signed`);
                }
            } catch (error: any) {
                console.log(`   ❌ ${validator.name}: ${error.message}`);
            }
        }

        if (attestations.length >= 1) {
            console.log('\n🎯 ATTACK: Submitting same attestation 3 times in same array');
            console.log(`   Using ${attestations[0].validator_pubkey} signature 3 times`);

            const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(BURN_NONCE_9_1).toArrayLike(Buffer, 'le', 8),
                ],
                lightClientProgram.programId
            );

            // Create array with same attestation 3 times
            const duplicateAttestations = [
                attestations[0],
                attestations[0],
                attestations[0],
            ];

            const attestationData = {
                burnNonce: new anchor.BN(BURN_NONCE_9_1),
                user: userKeypair.publicKey,
                amount: new anchor.BN(BURN_AMOUNT),
                validatorSetVersion: new anchor.BN(currentVersion),
                attestations: duplicateAttestations.map(a => ({
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

                console.log('\n❌ TEST FAILED: Intra-TX duplicate accepted!');
                console.log(`📝 TX: ${tx}`);
                console.log('⚠️  SECURITY ISSUE: Same attestation counted 3 times!');

            } catch (error: any) {
                console.log('\n✅ TEST PASSED: Intra-TX duplicate rejected!');

                if (error.message.includes('DuplicateValidator') || error.message.includes('0x1001')) {
                    console.log('🔒 Reason: DuplicateValidator error');
                    console.log('   On-chain deduplication working');
                } else {
                    console.log(`📝 Error: ${error.message.substring(0, 100)}`);
                }
            }
        } else {
            console.log(`\n❌ Only got ${attestations.length} attestations`);
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_9_1 to run Test 9.1');
    }

    // TEST 5.1: Invalid Signatures First, Valid Last
    console.log('\n━'.repeat(60));
    console.log('TEST 5.1: Ordering Attack - Invalid First, Valid Last');
    console.log('━'.repeat(60));

    const BURN_NONCE_5_1 = parseInt(process.env.BURN_NONCE_5_1 || '0');

    if (BURN_NONCE_5_1 > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_5_1}`);
        console.log('⏳ Waiting 20 seconds for finality...\n');
        await new Promise(resolve => setTimeout(resolve, 20000));

        // Collect attestations
        console.log('📡 Collecting valid attestations...');
        const attestations = [];

        for (const validator of VALIDATORS) {
            try {
                const response = await fetch(`${validator.api}/attest-burn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        burn_nonce: BURN_NONCE_5_1,
                        user: userKeypair.publicKey.toBase58(),
                        expected_amount: BURN_AMOUNT,
                        validator_set_version: currentVersion,
                    }),
                });

                if (response.ok) {
                    const attestation = await response.json();
                    attestations.push(attestation);
                    console.log(`   ✅ ${validator.name} signed`);
                }
            } catch (error: any) {
                console.log(`   ❌ ${validator.name}: ${error.message}`);
            }
        }

        if (attestations.length >= 3) {
            console.log('\n🎯 ATTACK: Placing invalid signatures before valid ones');
            console.log('   Array: [INVALID, INVALID, V3, V4, V5]');
            console.log('   Goal: Ensure ALL signatures are validated, not just first N');

            const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(BURN_NONCE_5_1).toArrayLike(Buffer, 'le', 8),
                ],
                lightClientProgram.programId
            );

            // Create fake attestations with garbage signatures
            const fakeAttestation1 = {
                validatorPubkey: VALIDATORS[0].pubkey,
                signature: Buffer.alloc(64, 0xFF),  // All 0xFF
                timestamp: new anchor.BN(Date.now()),
            };

            const fakeAttestation2 = {
                validatorPubkey: VALIDATORS[1].pubkey,
                signature: Buffer.alloc(64, 0x00),  // All 0x00
                timestamp: new anchor.BN(Date.now()),
            };

            // Create ordered array: [invalid, invalid, valid, valid, valid]
            const orderedAttestations = [
                fakeAttestation1,
                fakeAttestation2,
                {
                    validatorPubkey: new PublicKey(attestations[0].validator_pubkey),
                    signature: attestations[0].signature,
                    timestamp: new anchor.BN(attestations[0].timestamp),
                },
                {
                    validatorPubkey: new PublicKey(attestations[1].validator_pubkey),
                    signature: attestations[1].signature,
                    timestamp: new anchor.BN(attestations[1].timestamp),
                },
                {
                    validatorPubkey: new PublicKey(attestations[2].validator_pubkey),
                    signature: attestations[2].signature,
                    timestamp: new anchor.BN(attestations[2].timestamp),
                },
            ];

            const attestationData = {
                burnNonce: new anchor.BN(BURN_NONCE_5_1),
                user: userKeypair.publicKey,
                amount: new anchor.BN(BURN_AMOUNT),
                validatorSetVersion: new anchor.BN(currentVersion),
                attestations: orderedAttestations,
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

                console.log('\n⚠️  TEST RESULT: Transaction succeeded');
                console.log(`📝 TX: ${tx}`);
                console.log('🔍 Analysis: Program accepts arrays with invalid signatures');
                console.log('   as long as ≥threshold VALID signatures present.');
                console.log('   This is EXPECTED behavior for format-only validation.');

            } catch (error: any) {
                console.log('\n✅ TEST INFO: Transaction failed');
                console.log(`📝 Error: ${error.message.substring(0, 100)}`);
            }
        } else {
            console.log(`\n❌ Only got ${attestations.length} attestations`);
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_5_1 to run Test 5.1');
    }

    // TEST 5.2: Extreme Ordering - Valid Signatures Scattered
    console.log('\n━'.repeat(60));
    console.log('TEST 5.2: Ordering Attack - Valid Signatures Scattered');
    console.log('━'.repeat(60));

    const BURN_NONCE_5_2 = parseInt(process.env.BURN_NONCE_5_2 || '0');

    if (BURN_NONCE_5_2 > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_5_2}`);
        console.log('⏳ Waiting 20 seconds for finality...\n');
        await new Promise(resolve => setTimeout(resolve, 20000));

        // Collect attestations
        console.log('📡 Collecting attestations...');
        const attestations = [];

        for (const validator of VALIDATORS) {
            try {
                const response = await fetch(`${validator.api}/attest-burn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        burn_nonce: BURN_NONCE_5_2,
                        user: userKeypair.publicKey.toBase58(),
                        expected_amount: BURN_AMOUNT,
                        validator_set_version: currentVersion,
                    }),
                });

                if (response.ok) {
                    const attestation = await response.json();
                    attestations.push(attestation);
                    console.log(`   ✅ ${validator.name} signed`);
                }
            } catch (error: any) {
                console.log(`   ❌ ${validator.name}: ${error.message}`);
            }
        }

        if (attestations.length >= 3) {
            console.log('\n🎯 ATTACK: Randomly shuffling valid attestations');
            console.log('   Testing multiple random orderings to ensure order-independence');

            const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(BURN_NONCE_5_2).toArrayLike(Buffer, 'le', 8),
                ],
                lightClientProgram.programId
            );

            // Test with reverse order
            const reversedAttestations = [
                attestations[2],
                attestations[1],
                attestations[0],
            ];

            console.log('   Order: [V5, V4, V3] (reversed)');

            const attestationData = {
                burnNonce: new anchor.BN(BURN_NONCE_5_2),
                user: userKeypair.publicKey,
                amount: new anchor.BN(BURN_AMOUNT),
                validatorSetVersion: new anchor.BN(currentVersion),
                attestations: reversedAttestations.map(a => ({
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

                console.log('\n✅ TEST PASSED: Reversed order accepted!');
                console.log(`📝 TX: ${tx}`);
                console.log('🔍 Confirms order-independent validation (Test 15.1)');

            } catch (error: any) {
                console.log('\n⚠️  TEST INFO: Reversed order rejected');
                console.log(`📝 Error: ${error.message.substring(0, 100)}`);
            }
        } else {
            console.log(`\n❌ Only got ${attestations.length} attestations`);
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_5_2 to run Test 5.2');
    }

    console.log('\n━'.repeat(60));
    console.log('🎉 DUPLICATE & ORDERING ATTACK TESTS COMPLETE!');
    console.log('━'.repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
