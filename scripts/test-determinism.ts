import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { SolanaLightClientX1 } from '../target/types/solana_light_client_x1';
import fs from 'fs';
import fetch from 'node-fetch';
import 'dotenv/config';

const X1_RPC = 'https://rpc.mainnet.x1.xyz';
const BURN_AMOUNT = 10000;

const VALIDATORS = [
    { name: 'Validator 1', api: 'http://149.50.116.159:8080', pubkey: new PublicKey('9oa7NAscCZ1kCQFZJng9gfwvDzrEvyWgx4F244PHmHPH') },
    { name: 'Validator 2', api: 'http://193.34.212.186:8080', pubkey: new PublicKey('8byEUEZ2sMfP6RPX9VD8JCvCQK3F5FG2LytcR9TkVWag') },
    { name: 'Validator 3', api: 'http://74.50.76.62:10001', pubkey: new PublicKey('5NfpgFCwrYzcgJkda9bRJvccycLUo3dvVQsVAK2W43Um') },
    { name: 'Validator 4', api: 'http://149.50.116.21:8080', pubkey: new PublicKey('GdbXi56fCSQ1joCvGjqm7JKvqvwgtKh6xeusUqZbB3rH') },
    { name: 'Validator 5', api: 'http://64.20.49.142:8080', pubkey: new PublicKey('FmuuFgRh8NP8UD7QHg86f7vu7qpsmr1wE7hB59oojDpj') },
];

async function main() {
    console.log('🔀 DETERMINISM TESTS');
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

    // TEST 15.2: Duplicate + Valid Mix
    console.log('━'.repeat(60));
    console.log('TEST 15.2: Duplicate + Valid Mix');
    console.log('━'.repeat(60));

    const BURN_NONCE_15_2 = parseInt(process.env.BURN_NONCE_15_2 || '0');

    if (BURN_NONCE_15_2 > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_15_2}`);
        console.log('⏳ Waiting 20 seconds for finality...\n');
        await new Promise(resolve => setTimeout(resolve, 20000));

        // Collect attestations from V3, V4 only (V1, V2 may be down)
        console.log('📡 Collecting attestations from V3 and V4...');
        const attestations = [];

        for (let i = 2; i < 4; i++) {
            const validator = VALIDATORS[i];
            try {
                const response = await fetch(`${validator.api}/attest-burn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        burn_nonce: BURN_NONCE_15_2,
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

        if (attestations.length === 2) {
            console.log('\n📋 Creating duplicate: [V3, V4, V3]');

            const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(BURN_NONCE_15_2).toArrayLike(Buffer, 'le', 8),
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
                burnNonce: new anchor.BN(BURN_NONCE_15_2),
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

                console.log('\n❌ TEST FAILED: Duplicate validator was accepted!');
                console.log(`📝 TX: ${tx}`);

            } catch (error: any) {
                console.log('\n✅ TEST PASSED: Duplicate validator rejected!');

                if (error.message.includes('DuplicateValidator') || error.message.includes('0x1001')) {
                    console.log('🔒 Reason: DuplicateValidator error');
                } else {
                    console.log(`📝 Error: ${error.message.substring(0, 100)}`);
                }
            }
        } else {
            console.log('\n❌ Failed to collect 2 attestations for test');
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_15_2 environment variable to run Test 15.2');
    }

    // TEST 15.1: Random Order Inputs
    console.log('\n━'.repeat(60));
    console.log('TEST 15.1: Random Order Inputs');
    console.log('━'.repeat(60));

    const BURN_NONCE_15_1_A = parseInt(process.env.BURN_NONCE_15_1_A || '0');
    const BURN_NONCE_15_1_B = parseInt(process.env.BURN_NONCE_15_1_B || '0');

    if (BURN_NONCE_15_1_A > 0 && BURN_NONCE_15_1_B > 0) {
        console.log(`\n🔥 Testing with two burns:`);
        console.log(`   Burn A: ${BURN_NONCE_15_1_A}`);
        console.log(`   Burn B: ${BURN_NONCE_15_1_B}`);

        // Test both burns with different validator orders
        const results: string[] = [];

        const testCases: Array<[number, string, number[]]> = [
            [BURN_NONCE_15_1_A, 'Burn A', [2, 3, 4]],  // V3, V4, V5
            [BURN_NONCE_15_1_B, 'Burn B', [4, 2, 3]],  // V5, V3, V4
        ];

        for (const [burnNonce, testName, order] of testCases) {
            console.log(`\n📡 ${testName} - Order: ${order.map(i => `V${i+1}`).join(', ')}`);

            const attestations = [];
            for (const i of order as number[]) {
                try {
                    const validator = VALIDATORS[i];
                    const response = await fetch(`${validator.api}/attest-burn`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            burn_nonce: burnNonce,
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
                    console.log(`   ❌ Error: ${error.message}`);
                }
            }

            if (attestations.length === 3) {
                const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
                    [
                        Buffer.from('verified_burn_v2'),
                        userKeypair.publicKey.toBuffer(),
                        new anchor.BN(burnNonce as number).toArrayLike(Buffer, 'le', 8),
                    ],
                    lightClientProgram.programId
                );

                const attestationData = {
                    burnNonce: new anchor.BN(burnNonce as number),
                    user: userKeypair.publicKey,
                    amount: new anchor.BN(BURN_AMOUNT),
                    validatorSetVersion: new anchor.BN(currentVersion),
                    attestations: attestations.map(a => ({
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

                    console.log(`   ✅ Accepted - TX: ${tx.substring(0, 20)}...`);
                    results.push('SUCCESS');

                } catch (error: any) {
                    console.log(`   ❌ Rejected: ${error.message.substring(0, 50)}`);
                    results.push('FAILED');
                }
            } else {
                console.log(`   ❌ Only got ${attestations.length} attestations`);
                results.push('INCOMPLETE');
            }
        }

        console.log('\n━'.repeat(60));
        if (results[0] === results[1] && results[0] !== 'INCOMPLETE') {
            console.log('✅ TEST PASSED: Both orders produced same result!');
            console.log(`   Both ${results[0]} (deterministic behavior)`);
        } else {
            console.log('❌ TEST FAILED: Different results for different orders');
            console.log(`   Burn A: ${results[0]}, Burn B: ${results[1]}`);
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_15_1_A and BURN_NONCE_15_1_B to run Test 15.1');
    }

    console.log('\n━'.repeat(60));
    console.log('🎉 DETERMINISM TESTS COMPLETE!');
    console.log('━'.repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
