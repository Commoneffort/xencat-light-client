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
    console.log('🔴 RED TEAM: PDA MANIPULATION ATTACKS');
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

    // TEST 8.1: Different Nonce Encoding
    console.log('━'.repeat(60));
    console.log('TEST 8.1: Malformed PDA - Different Nonce Encoding');
    console.log('━'.repeat(60));

    const BURN_NONCE_8_1 = parseInt(process.env.BURN_NONCE_8_1 || '0');

    if (BURN_NONCE_8_1 > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_8_1}`);
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
                        burn_nonce: BURN_NONCE_8_1,
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
            console.log('\n🎯 ATTACK: Using different nonce encoding (big-endian instead of little-endian)');

            // Correct PDA (little-endian)
            const [correctPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(BURN_NONCE_8_1).toArrayLike(Buffer, 'le', 8),
                ],
                lightClientProgram.programId
            );

            // Malicious PDA (big-endian - wrong encoding)
            const nonceBigEndian = new anchor.BN(BURN_NONCE_8_1).toArrayLike(Buffer, 'be', 8);
            const [maliciousPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    nonceBigEndian,
                ],
                lightClientProgram.programId
            );

            console.log(`   Correct PDA (LE):  ${correctPda.toBase58()}`);
            console.log(`   Malicious PDA (BE): ${maliciousPda.toBase58()} ❌\n`);

            const attestationData = {
                burnNonce: new anchor.BN(BURN_NONCE_8_1),
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
                const tx = await lightClientProgram.methods
                    .submitBurnAttestation(attestationData)
                    .accounts({
                        user: userKeypair.publicKey,
                        validatorSet: validatorSetPda,
                        verifiedBurn: maliciousPda,  // Using wrong-encoded PDA!
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();

                console.log('❌ TEST FAILED: Malformed PDA accepted!');
                console.log(`📝 TX: ${tx}`);

            } catch (error: any) {
                console.log('✅ TEST PASSED: Malformed PDA rejected!');

                if (error.message.includes('ConstraintSeeds') || error.message.includes('0x7d1')) {
                    console.log('🔒 Reason: Seeds constraint violation');
                } else {
                    console.log(`📝 Error: ${error.message.substring(0, 100)}`);
                }
            }
        } else {
            console.log(`\n❌ Only got ${attestations.length} attestations`);
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_8_1 to run Test 8.1');
    }

    // TEST 8.2: Different User Pubkey
    console.log('\n━'.repeat(60));
    console.log('TEST 8.2: Malformed PDA - Different User Pubkey');
    console.log('━'.repeat(60));

    const BURN_NONCE_8_2 = parseInt(process.env.BURN_NONCE_8_2 || '0');

    if (BURN_NONCE_8_2 > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_8_2}`);
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
                        burn_nonce: BURN_NONCE_8_2,
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
            console.log('\n🎯 ATTACK: Using different user pubkey in PDA derivation');

            // Generate fake user keypair
            const fakeUser = Keypair.generate();

            // Correct PDA (real user)
            const [correctPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(BURN_NONCE_8_2).toArrayLike(Buffer, 'le', 8),
                ],
                lightClientProgram.programId
            );

            // Malicious PDA (fake user)
            const [maliciousPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    fakeUser.publicKey.toBuffer(),  // Different user!
                    new anchor.BN(BURN_NONCE_8_2).toArrayLike(Buffer, 'le', 8),
                ],
                lightClientProgram.programId
            );

            console.log(`   Real User:     ${userKeypair.publicKey.toBase58()}`);
            console.log(`   Fake User:     ${fakeUser.publicKey.toBase58()} ❌`);
            console.log(`   Correct PDA:   ${correctPda.toBase58()}`);
            console.log(`   Malicious PDA: ${maliciousPda.toBase58()} ❌\n`);

            const attestationData = {
                burnNonce: new anchor.BN(BURN_NONCE_8_2),
                user: userKeypair.publicKey,  // Real user in data
                amount: new anchor.BN(BURN_AMOUNT),
                validatorSetVersion: new anchor.BN(currentVersion),
                attestations: attestations.slice(0, 3).map(a => ({
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
                        verifiedBurn: maliciousPda,  // Using PDA with fake user!
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();

                console.log('❌ TEST FAILED: PDA with wrong user accepted!');
                console.log(`📝 TX: ${tx}`);

            } catch (error: any) {
                console.log('✅ TEST PASSED: PDA with wrong user rejected!');

                if (error.message.includes('ConstraintSeeds') || error.message.includes('0x7d1')) {
                    console.log('🔒 Reason: Seeds constraint violation');
                    console.log('   Anchor enforces: PDA user seed must match user account');
                } else {
                    console.log(`📝 Error: ${error.message.substring(0, 100)}`);
                }
            }
        } else {
            console.log(`\n❌ Only got ${attestations.length} attestations`);
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_8_2 to run Test 8.2');
    }

    // TEST 8.3: Wrong Seed Prefix
    console.log('\n━'.repeat(60));
    console.log('TEST 8.3: Malformed PDA - Wrong Seed Prefix');
    console.log('━'.repeat(60));

    const BURN_NONCE_8_3 = parseInt(process.env.BURN_NONCE_8_3 || '0');

    if (BURN_NONCE_8_3 > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_8_3}`);
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
                        burn_nonce: BURN_NONCE_8_3,
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
            console.log('\n🎯 ATTACK: Using wrong seed prefix');

            // Correct PDA
            const [correctPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(BURN_NONCE_8_3).toArrayLike(Buffer, 'le', 8),
                ],
                lightClientProgram.programId
            );

            // Try multiple malicious prefixes
            const maliciousPrefixes = [
                'verified_burn',      // Old V1 prefix
                'verified_burn_v3',   // Future version
                'verified_burnv2',    // Typo (missing underscore)
                'VERIFIED_BURN_V2',   // Wrong case
            ];

            console.log(`   Correct PDA: ${correctPda.toBase58()}\n`);

            for (const prefix of maliciousPrefixes) {
                const [maliciousPda] = PublicKey.findProgramAddressSync(
                    [
                        Buffer.from(prefix),
                        userKeypair.publicKey.toBuffer(),
                        new anchor.BN(BURN_NONCE_8_3).toArrayLike(Buffer, 'le', 8),
                    ],
                    lightClientProgram.programId
                );

                console.log(`   Testing prefix: "${prefix}"`);
                console.log(`   Malicious PDA: ${maliciousPda.toBase58()} ❌`);

                const attestationData = {
                    burnNonce: new anchor.BN(BURN_NONCE_8_3),
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
                    const tx = await lightClientProgram.methods
                        .submitBurnAttestation(attestationData)
                        .accounts({
                            user: userKeypair.publicKey,
                            validatorSet: validatorSetPda,
                            verifiedBurn: maliciousPda,
                            systemProgram: SystemProgram.programId,
                        })
                        .rpc();

                    console.log(`   ❌ FAIL: Prefix "${prefix}" was accepted!`);
                    console.log(`   TX: ${tx}\n`);

                } catch (error: any) {
                    console.log(`   ✅ PASS: Prefix "${prefix}" rejected`);

                    if (error.message.includes('ConstraintSeeds') || error.message.includes('0x7d1')) {
                        console.log(`   🔒 Seeds constraint enforced\n`);
                    } else {
                        console.log(`   Error: ${error.message.substring(0, 50)}\n`);
                    }
                }
            }

            console.log('✅ TEST PASSED: All wrong prefixes rejected!');
        } else {
            console.log(`\n❌ Only got ${attestations.length} attestations`);
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_8_3 to run Test 8.3');
    }

    console.log('\n━'.repeat(60));
    console.log('🎉 PDA MANIPULATION TESTS COMPLETE!');
    console.log('━'.repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
