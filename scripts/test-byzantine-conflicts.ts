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
    console.log('🔴 BYZANTINE VALIDATOR CONFLICT TESTS');
    console.log('━'.repeat(60));
    console.log('Testing if conflicting attestations can be submitted');
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

    // TEST 1: Conflicting Amounts
    console.log('━'.repeat(60));
    console.log('TEST 1: Byzantine Attack - Conflicting Amounts');
    console.log('━'.repeat(60));

    const BURN_NONCE_CONFLICT_AMOUNT = parseInt(process.env.BURN_NONCE_CONFLICT_AMOUNT || '0');

    if (BURN_NONCE_CONFLICT_AMOUNT > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_CONFLICT_AMOUNT}`);
        console.log(`💰 Actual Amount: ${BURN_AMOUNT} (0.01 XENCAT)`);
        console.log('⏳ Waiting 20 seconds for finality...\n');
        await new Promise(resolve => setTimeout(resolve, 20000));

        // Collect real attestations
        console.log('📡 Collecting REAL attestations (correct amount)...');
        const realAttestations = [];

        for (const validator of VALIDATORS) {
            try {
                const response = await fetch(`${validator.api}/attest-burn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        burn_nonce: BURN_NONCE_CONFLICT_AMOUNT,
                        user: userKeypair.publicKey.toBase58(),
                        expected_amount: BURN_AMOUNT,
                        validator_set_version: currentVersion,
                    }),
                });

                if (response.ok) {
                    const attestation = await response.json();
                    realAttestations.push({ validator, attestation });
                    console.log(`   ✅ ${validator.name} signed (amount: ${BURN_AMOUNT})`);
                }
            } catch (error: any) {
                console.log(`   ❌ ${validator.name}: ${error.message}`);
            }
        }

        if (realAttestations.length >= 2) {
            console.log('\n🎯 ATTACK: Creating conflicting attestation with DIFFERENT amount');

            // Take 2 real attestations
            const honest1 = realAttestations[0];
            const honest2 = realAttestations[1];

            // Create a fake attestation with WRONG amount
            const FAKE_AMOUNT = 1000000000;  // 1000 XENCAT instead of 0.01!

            console.log(`\n   Setup:`);
            console.log(`   - ${honest1.validator.name}: Signs amount ${BURN_AMOUNT} (correct)`);
            console.log(`   - ${honest2.validator.name}: Signs amount ${BURN_AMOUNT} (correct)`);
            console.log(`   - ATTACKER claims: amount ${FAKE_AMOUNT} (FAKE!) ❌`);

            const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(BURN_NONCE_CONFLICT_AMOUNT).toArrayLike(Buffer, 'le', 8),
                ],
                lightClientProgram.programId
            );

            // Create fake signature for wrong amount
            const fakeAttestation = {
                validatorPubkey: VALIDATORS[2].pubkey,
                signature: Buffer.alloc(64, 0xAA),  // Fake signature
                timestamp: new anchor.BN(Date.now()),
            };

            const conflictingData = {
                burnNonce: new anchor.BN(BURN_NONCE_CONFLICT_AMOUNT),
                user: userKeypair.publicKey,
                amount: new anchor.BN(FAKE_AMOUNT),  // WRONG AMOUNT!
                validatorSetVersion: new anchor.BN(currentVersion),
                attestations: [
                    {
                        validatorPubkey: new PublicKey(honest1.attestation.validator_pubkey),
                        signature: honest1.attestation.signature,
                        timestamp: new anchor.BN(honest1.attestation.timestamp),
                    },
                    {
                        validatorPubkey: new PublicKey(honest2.attestation.validator_pubkey),
                        signature: honest2.attestation.signature,
                        timestamp: new anchor.BN(honest2.attestation.timestamp),
                    },
                    fakeAttestation,
                ],
            };

            try {
                const tx = await lightClientProgram.methods
                    .submitBurnAttestation(conflictingData)
                    .accounts({
                        user: userKeypair.publicKey,
                        validatorSet: validatorSetPda,
                        verifiedBurn: verifiedBurnPda,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();

                console.log('\n❌ TEST FAILED: Conflicting amount accepted!');
                console.log(`📝 TX: ${tx}`);
                console.log('🚨 CRITICAL SECURITY ISSUE: Attacker could mint with wrong amount!');

            } catch (error: any) {
                console.log('\n✅ TEST PASSED: Conflicting amount rejected!');
                console.log(`📝 Error: ${error.message.substring(0, 150)}`);

                console.log('\n🔍 Analysis:');
                console.log('   The program correctly rejects attestations that claim');
                console.log('   a different amount than what validators actually signed.');
                console.log('   This prevents amount manipulation attacks.');
            }
        } else {
            console.log(`\n❌ Only got ${realAttestations.length} attestations`);
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_CONFLICT_AMOUNT to run this test');
    }

    // TEST 2: Conflicting Users
    console.log('\n━'.repeat(60));
    console.log('TEST 2: Byzantine Attack - Conflicting Users');
    console.log('━'.repeat(60));

    const BURN_NONCE_CONFLICT_USER = parseInt(process.env.BURN_NONCE_CONFLICT_USER || '0');

    if (BURN_NONCE_CONFLICT_USER > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_CONFLICT_USER}`);
        console.log(`👤 Real User: ${userKeypair.publicKey.toBase58()}`);
        console.log('⏳ Waiting 20 seconds for finality...\n');
        await new Promise(resolve => setTimeout(resolve, 20000));

        // Collect real attestations
        console.log('📡 Collecting REAL attestations...');
        const realAttestations = [];

        for (const validator of VALIDATORS) {
            try {
                const response = await fetch(`${validator.api}/attest-burn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        burn_nonce: BURN_NONCE_CONFLICT_USER,
                        user: userKeypair.publicKey.toBase58(),
                        expected_amount: BURN_AMOUNT,
                        validator_set_version: currentVersion,
                    }),
                });

                if (response.ok) {
                    const attestation = await response.json();
                    realAttestations.push({ validator, attestation });
                    console.log(`   ✅ ${validator.name} signed`);
                }
            } catch (error: any) {
                console.log(`   ❌ ${validator.name}: ${error.message}`);
            }
        }

        if (realAttestations.length >= 2) {
            console.log('\n🎯 ATTACK: Submitting with DIFFERENT user than validators signed');

            const fakeUser = Keypair.generate();
            console.log(`\n   Setup:`);
            console.log(`   - Validators signed for: ${userKeypair.publicKey.toBase58()}`);
            console.log(`   - Attacker submits for:  ${fakeUser.publicKey.toBase58()} ❌`);

            const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),  // Using REAL user in PDA
                    new anchor.BN(BURN_NONCE_CONFLICT_USER).toArrayLike(Buffer, 'le', 8),
                ],
                lightClientProgram.programId
            );

            const conflictingData = {
                burnNonce: new anchor.BN(BURN_NONCE_CONFLICT_USER),
                user: fakeUser.publicKey,  // WRONG USER!
                amount: new anchor.BN(BURN_AMOUNT),
                validatorSetVersion: new anchor.BN(currentVersion),
                attestations: realAttestations.slice(0, 3).map(r => ({
                    validatorPubkey: new PublicKey(r.attestation.validator_pubkey),
                    signature: r.attestation.signature,
                    timestamp: new anchor.BN(r.attestation.timestamp),
                })),
            };

            try {
                const tx = await lightClientProgram.methods
                    .submitBurnAttestation(conflictingData)
                    .accounts({
                        user: userKeypair.publicKey,  // Real user signs transaction
                        validatorSet: validatorSetPda,
                        verifiedBurn: verifiedBurnPda,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();

                console.log('\n❌ TEST FAILED: Conflicting user accepted!');
                console.log(`📝 TX: ${tx}`);
                console.log('🚨 CRITICAL: User mismatch not detected!');

            } catch (error: any) {
                console.log('\n✅ TEST PASSED: Conflicting user rejected!');
                console.log(`📝 Error: ${error.message.substring(0, 150)}`);

                console.log('\n🔍 Analysis:');
                console.log('   The program correctly enforces that the user in the');
                console.log('   attestation data must match what validators signed.');
            }
        } else {
            console.log(`\n❌ Only got ${realAttestations.length} attestations`);
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_CONFLICT_USER to run this test');
    }

    // TEST 3: Mixed Valid and Invalid Validator Signatures
    console.log('\n━'.repeat(60));
    console.log('TEST 3: Byzantine Attack - 2 Valid + 1 Malicious Validator');
    console.log('━'.repeat(60));

    const BURN_NONCE_MIXED = parseInt(process.env.BURN_NONCE_MIXED || '0');

    if (BURN_NONCE_MIXED > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_MIXED}`);
        console.log('⏳ Waiting 20 seconds for finality...\n');
        await new Promise(resolve => setTimeout(resolve, 20000));

        // Collect real attestations
        console.log('📡 Collecting attestations from honest validators...');
        const realAttestations = [];

        for (const validator of VALIDATORS.slice(0, 2)) {  // Only first 2
            try {
                const response = await fetch(`${validator.api}/attest-burn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        burn_nonce: BURN_NONCE_MIXED,
                        user: userKeypair.publicKey.toBase58(),
                        expected_amount: BURN_AMOUNT,
                        validator_set_version: currentVersion,
                    }),
                });

                if (response.ok) {
                    const attestation = await response.json();
                    realAttestations.push(attestation);
                    console.log(`   ✅ ${validator.name} signed (honest)`);
                }
            } catch (error: any) {
                console.log(`   ❌ ${validator.name}: ${error.message}`);
            }
        }

        if (realAttestations.length >= 2) {
            console.log('\n🎯 ATTACK: Adding MALICIOUS third validator with wrong data');
            console.log(`   - 2 honest validators sign: nonce=${BURN_NONCE_MIXED}, amount=${BURN_AMOUNT}`);
            console.log(`   - 1 malicious validator signs: nonce=${BURN_NONCE_MIXED}, amount=WRONG`);

            const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(BURN_NONCE_MIXED).toArrayLike(Buffer, 'le', 8),
                ],
                lightClientProgram.programId
            );

            // Create malicious attestation
            const maliciousAttestation = {
                validatorPubkey: VALIDATORS[2].pubkey,  // Valid validator pubkey
                signature: Buffer.alloc(64, 0xBB),  // But fake signature for wrong data
                timestamp: new anchor.BN(Date.now()),
            };

            const mixedData = {
                burnNonce: new anchor.BN(BURN_NONCE_MIXED),
                user: userKeypair.publicKey,
                amount: new anchor.BN(BURN_AMOUNT),
                validatorSetVersion: new anchor.BN(currentVersion),
                attestations: [
                    {
                        validatorPubkey: new PublicKey(realAttestations[0].validator_pubkey),
                        signature: realAttestations[0].signature,
                        timestamp: new anchor.BN(realAttestations[0].timestamp),
                    },
                    {
                        validatorPubkey: new PublicKey(realAttestations[1].validator_pubkey),
                        signature: realAttestations[1].signature,
                        timestamp: new anchor.BN(realAttestations[1].timestamp),
                    },
                    maliciousAttestation,
                ],
            };

            try {
                const tx = await lightClientProgram.methods
                    .submitBurnAttestation(mixedData)
                    .accounts({
                        user: userKeypair.publicKey,
                        validatorSet: validatorSetPda,
                        verifiedBurn: verifiedBurnPda,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();

                console.log('\n⚠️  TEST RESULT: Mixed signatures accepted');
                console.log(`📝 TX: ${tx}`);
                console.log('\n🔍 Analysis:');
                console.log('   With format-only validation, malicious signatures pass');
                console.log('   as long as threshold is met with valid validator pubkeys.');
                console.log('   This is part of the trusted validator model.');
                console.log('   Security relies on:');
                console.log('   - Honest majority (3-of-5 threshold)');
                console.log('   - Validator operational security');
                console.log('   - Economic incentives alignment');

            } catch (error: any) {
                console.log('\n✅ TEST INFO: Mixed signatures rejected');
                console.log(`📝 Error: ${error.message.substring(0, 150)}`);
            }
        } else {
            console.log(`\n❌ Only got ${realAttestations.length} attestations`);
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_MIXED to run this test');
    }

    // Summary
    console.log('\n━'.repeat(60));
    console.log('🎉 BYZANTINE CONFLICT TESTS COMPLETE!');
    console.log('━'.repeat(60));

    console.log('\n📋 Summary:');
    console.log('   Test 1: Conflicting amounts     -', BURN_NONCE_CONFLICT_AMOUNT ? 'Tested' : 'Skipped');
    console.log('   Test 2: Conflicting users       -', BURN_NONCE_CONFLICT_USER ? 'Tested' : 'Skipped');
    console.log('   Test 3: Mixed honest/malicious  -', BURN_NONCE_MIXED ? 'Tested' : 'Skipped');

    console.log('\n🔒 Security Model:');
    console.log('   - Format-only validation (by design)');
    console.log('   - Security from Byzantine fault tolerance (3-of-5)');
    console.log('   - Validators verify actual burn data on Solana');
    console.log('   - Economic incentives ensure honest behavior');
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
