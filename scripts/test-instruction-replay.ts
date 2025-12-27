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
    console.log('🔄 INSTRUCTION-LEVEL REPLAY TESTS');
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

    // TEST 12.1: Same TX, Different Accounts
    console.log('━'.repeat(60));
    console.log('TEST 12.1: Same TX, Different Accounts');
    console.log('━'.repeat(60));

    const BURN_NONCE_12_1_A = parseInt(process.env.BURN_NONCE_12_1_A || '0');
    const BURN_NONCE_12_1_B = parseInt(process.env.BURN_NONCE_12_1_B || '0');

    if (BURN_NONCE_12_1_A > 0 && BURN_NONCE_12_1_B > 0) {
        console.log(`\n🔥 Burn A: ${BURN_NONCE_12_1_A} (User A)`);
        console.log(`🔥 Burn B: ${BURN_NONCE_12_1_B} (Simulated as different user)`);
        console.log('\n⏳ Waiting 20 seconds for finality...\n');
        await new Promise(resolve => setTimeout(resolve, 20000));

        // Get attestations for Burn A
        console.log('📡 Collecting attestations for Burn A...');
        const attestations = [];

        for (const validator of VALIDATORS) {
            try {
                const response = await fetch(`${validator.api}/attest-burn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        burn_nonce: BURN_NONCE_12_1_A,
                        user: userKeypair.publicKey.toBase58(),
                        expected_amount: BURN_AMOUNT,
                        validator_set_version: currentVersion,
                    }),
                });

                if (response.ok) {
                    const attestation = await response.json();
                    attestations.push(attestation);
                    console.log(`   ✅ ${validator.name} signed Burn A`);
                }
            } catch (error: any) {
                console.log(`   ❌ ${validator.name}: ${error.message}`);
            }
        }

        if (attestations.length >= 3) {
            // First submit Burn A normally (should succeed)
            console.log('\n📋 Submitting Burn A normally...');

            const [verifiedBurnAPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(BURN_NONCE_12_1_A).toArrayLike(Buffer, 'le', 8),
                ],
                lightClientProgram.programId
            );

            const attestationDataA = {
                burnNonce: new anchor.BN(BURN_NONCE_12_1_A),
                user: userKeypair.publicKey,
                amount: new anchor.BN(BURN_AMOUNT),
                validatorSetVersion: new anchor.BN(currentVersion),
                attestations: attestations.slice(0, 3).map(a => ({
                    validatorPubkey: new PublicKey(a.validator_pubkey),
                    signature: a.signature,
                    timestamp: new anchor.BN(a.timestamp),
                })),
            };

            try {
                const txA = await lightClientProgram.methods
                    .submitBurnAttestation(attestationDataA)
                    .accounts({
                        user: userKeypair.publicKey,
                        validatorSet: validatorSetPda,
                        verifiedBurn: verifiedBurnAPda,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();

                console.log(`   ✅ Burn A submitted: ${txA.substring(0, 20)}...`);

                // Now try to replay with Burn B's nonce but same signatures
                console.log('\n📋 Attempting to replay with Burn B nonce...');
                console.log('   Using Burn A signatures with Burn B PDA');

                const [verifiedBurnBPda] = PublicKey.findProgramAddressSync(
                    [
                        Buffer.from('verified_burn_v2'),
                        userKeypair.publicKey.toBuffer(),
                        new anchor.BN(BURN_NONCE_12_1_B).toArrayLike(Buffer, 'le', 8),  // Different nonce!
                    ],
                    lightClientProgram.programId
                );

                const attestationDataB = {
                    burnNonce: new anchor.BN(BURN_NONCE_12_1_B),  // Different nonce!
                    user: userKeypair.publicKey,
                    amount: new anchor.BN(BURN_AMOUNT),
                    validatorSetVersion: new anchor.BN(currentVersion),
                    attestations: attestations.slice(0, 3).map(a => ({  // Same signatures!
                        validatorPubkey: new PublicKey(a.validator_pubkey),
                        signature: a.signature,
                        timestamp: new anchor.BN(a.timestamp),
                    })),
                };

                try {
                    const txB = await lightClientProgram.methods
                        .submitBurnAttestation(attestationDataB)
                        .accounts({
                            user: userKeypair.publicKey,
                            validatorSet: validatorSetPda,
                            verifiedBurn: verifiedBurnBPda,  // Different PDA!
                            systemProgram: SystemProgram.programId,
                        })
                        .rpc();

                    console.log('\n⚠️  TEST RESULT: Replay succeeded (expected given Test 4.2 finding)');
                    console.log(`📝 TX: ${txB.substring(0, 20)}...`);
                    console.log('🔍 This confirms cross-burn signature replay from Test 4.2');

                } catch (error: any) {
                    console.log('\n✅ TEST PASSED: Replay rejected!');
                    console.log(`📝 Error: ${error.message.substring(0, 100)}`);
                }

            } catch (error: any) {
                console.log(`\n❌ Burn A submission failed: ${error.message.substring(0, 100)}`);
            }
        } else {
            console.log(`\n❌ Only got ${attestations.length} attestations`);
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_12_1_A and BURN_NONCE_12_1_B to run Test 12.1');
    }

    // TEST 12.2: Same Accounts, Reordered Metas
    console.log('\n━'.repeat(60));
    console.log('TEST 12.2: Same Accounts, Reordered Metas');
    console.log('━'.repeat(60));

    const BURN_NONCE_12_2 = parseInt(process.env.BURN_NONCE_12_2 || '0');

    if (BURN_NONCE_12_2 > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_12_2}`);
        console.log('⏳ Waiting 20 seconds for finality...\n');
        await new Promise(resolve => setTimeout(resolve, 20000));

        console.log('📡 Collecting attestations...');
        const attestations = [];

        for (const validator of VALIDATORS) {
            try {
                const response = await fetch(`${validator.api}/attest-burn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        burn_nonce: BURN_NONCE_12_2,
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
            console.log('\n📋 Testing with REORDERED attestations...');
            console.log('   Original order: [V3, V4, V5]');
            console.log('   Reordered: [V5, V3, V4]');

            const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(BURN_NONCE_12_2).toArrayLike(Buffer, 'le', 8),
                ],
                lightClientProgram.programId
            );

            // Reorder attestations: [V3, V4, V5] -> [V5, V3, V4]
            const reorderedAttestations = [
                attestations[2],  // V5
                attestations[0],  // V3
                attestations[1],  // V4
            ];

            const attestationData = {
                burnNonce: new anchor.BN(BURN_NONCE_12_2),
                user: userKeypair.publicKey,
                amount: new anchor.BN(BURN_AMOUNT),
                validatorSetVersion: new anchor.BN(currentVersion),
                attestations: reorderedAttestations.map(a => ({
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

                console.log('\n✅ TEST PASSED: Reordered attestations accepted!');
                console.log(`📝 TX: ${tx.substring(0, 20)}...`);
                console.log('🔍 This is expected - validation is order-independent (Test 15.1)');

            } catch (error: any) {
                console.log('\n⚠️  TEST INFO: Reordered attestations rejected');
                console.log(`📝 Error: ${error.message.substring(0, 100)}`);
            }
        } else {
            console.log(`\n❌ Only got ${attestations.length} attestations`);
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_12_2 to run Test 12.2');
    }

    console.log('\n━'.repeat(60));
    console.log('🎉 INSTRUCTION-LEVEL REPLAY TESTS COMPLETE!');
    console.log('━'.repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
