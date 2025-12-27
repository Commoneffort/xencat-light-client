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
    console.log('🔍 VALIDATOR INTEGRITY TESTS');
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

    // TEST 7.1: Same Validator Three Times
    console.log('━'.repeat(60));
    console.log('TEST 7.1: Same Validator Three Times');
    console.log('━'.repeat(60));

    const BURN_NONCE_7_1 = parseInt(process.env.BURN_NONCE_7_1 || '0');

    if (BURN_NONCE_7_1 > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_7_1}`);
        console.log('⏳ Waiting 20 seconds for finality...\n');
        await new Promise(resolve => setTimeout(resolve, 20000));

        // Get one attestation from V3
        console.log('📡 Collecting attestation from V3...');
        let attestation = null;

        try {
            const response = await fetch(`${VALIDATORS[0].api}/attest-burn`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    burn_nonce: BURN_NONCE_7_1,
                    user: userKeypair.publicKey.toBase58(),
                    expected_amount: BURN_AMOUNT,
                    validator_set_version: currentVersion,
                }),
            });

            if (response.ok) {
                attestation = await response.json();
                console.log(`   ✅ ${VALIDATORS[0].name} signed`);
            } else {
                console.log(`   ❌ ${VALIDATORS[0].name} failed`);
            }
        } catch (error: any) {
            console.log(`   ❌ ${VALIDATORS[0].name}: ${error.message}`);
        }

        if (attestation) {
            console.log('\n📋 Creating duplicate: [V3, V3, V3]');

            const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(BURN_NONCE_7_1).toArrayLike(Buffer, 'le', 8),
                ],
                lightClientProgram.programId
            );

            // Use same attestation 3 times
            const duplicatedAttestations = [
                attestation,  // V3
                attestation,  // V3 again
                attestation,  // V3 again
            ];

            const attestationData = {
                burnNonce: new anchor.BN(BURN_NONCE_7_1),
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

                console.log('\n❌ TEST FAILED: Same validator 3 times was accepted!');
                console.log(`📝 TX: ${tx}`);

            } catch (error: any) {
                console.log('\n✅ TEST PASSED: Same validator 3 times rejected!');

                if (error.message.includes('DuplicateValidator') || error.message.includes('0x1001')) {
                    console.log('🔒 Reason: DuplicateValidator error');
                } else {
                    console.log(`📝 Error: ${error.message.substring(0, 100)}`);
                }
            }
        } else {
            console.log('\n❌ Could not collect attestation for test');
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_7_1 to run Test 7.1');
    }

    // TEST 8.1: Unknown Validator
    console.log('\n━'.repeat(60));
    console.log('TEST 8.1: Unknown Validator (Not in Set)');
    console.log('━'.repeat(60));

    const BURN_NONCE_8_1 = parseInt(process.env.BURN_NONCE_8_1 || '0');

    if (BURN_NONCE_8_1 > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_8_1}`);

        // Generate a fake validator keypair not in the set
        const fakeValidator = Keypair.generate();
        console.log(`🔍 Fake Validator: ${fakeValidator.publicKey.toBase58()}`);
        console.log('   (Not in validator set)');

        const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('verified_burn_v2'),
                userKeypair.publicKey.toBuffer(),
                new anchor.BN(BURN_NONCE_8_1).toArrayLike(Buffer, 'le', 8),
            ],
            lightClientProgram.programId
        );

        console.log('\n📋 Creating fake attestations from unknown validator...');

        // Create fake attestations (all from unknown validator)
        const fakeAttestations = [
            {
                validatorPubkey: fakeValidator.publicKey,
                signature: new Array(64).fill(1),  // Fake signature
                timestamp: new anchor.BN(Date.now() / 1000),
            },
            {
                validatorPubkey: fakeValidator.publicKey,
                signature: new Array(64).fill(2),  // Fake signature
                timestamp: new anchor.BN(Date.now() / 1000),
            },
            {
                validatorPubkey: fakeValidator.publicKey,
                signature: new Array(64).fill(3),  // Fake signature
                timestamp: new anchor.BN(Date.now() / 1000),
            },
        ];

        const attestationData = {
            burnNonce: new anchor.BN(BURN_NONCE_8_1),
            user: userKeypair.publicKey,
            amount: new anchor.BN(BURN_AMOUNT),
            validatorSetVersion: new anchor.BN(currentVersion),
            attestations: fakeAttestations,
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

            console.log('\n❌ TEST FAILED: Unknown validator was accepted!');
            console.log(`📝 TX: ${tx}`);

        } catch (error: any) {
            console.log('\n✅ TEST PASSED: Unknown validator rejected!');

            if (error.message.includes('ValidatorNotInSet') ||
                error.message.includes('UnknownValidator') ||
                error.message.includes('0x1002')) {
                console.log('🔒 Reason: ValidatorNotInSet error');
            } else {
                console.log(`📝 Error: ${error.message.substring(0, 100)}`);
            }
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_8_1 to run Test 8.1');
    }

    // TEST 8.2: Mix of Valid and Unknown Validators
    console.log('\n━'.repeat(60));
    console.log('TEST 8.2: Mix of Valid and Unknown Validators');
    console.log('━'.repeat(60));

    const BURN_NONCE_8_2 = parseInt(process.env.BURN_NONCE_8_2 || '0');

    if (BURN_NONCE_8_2 > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_8_2}`);
        console.log('⏳ Waiting 20 seconds for finality...\n');
        await new Promise(resolve => setTimeout(resolve, 20000));

        // Get 2 valid attestations
        console.log('📡 Collecting 2 valid attestations...');
        const validAttestations = [];

        for (let i = 0; i < 2; i++) {
            try {
                const response = await fetch(`${VALIDATORS[i].api}/attest-burn`, {
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
                    validAttestations.push(attestation);
                    console.log(`   ✅ ${VALIDATORS[i].name} signed`);
                }
            } catch (error: any) {
                console.log(`   ❌ ${VALIDATORS[i].name}: ${error.message}`);
            }
        }

        if (validAttestations.length === 2) {
            // Add one fake validator
            const fakeValidator = Keypair.generate();
            console.log(`\n📋 Adding fake validator: ${fakeValidator.publicKey.toBase58()}`);
            console.log('   Creating array: [V3, V4, Unknown]');

            const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(BURN_NONCE_8_2).toArrayLike(Buffer, 'le', 8),
                ],
                lightClientProgram.programId
            );

            const mixedAttestations = [
                {
                    validatorPubkey: new PublicKey(validAttestations[0].validator_pubkey),
                    signature: validAttestations[0].signature,
                    timestamp: new anchor.BN(validAttestations[0].timestamp),
                },
                {
                    validatorPubkey: new PublicKey(validAttestations[1].validator_pubkey),
                    signature: validAttestations[1].signature,
                    timestamp: new anchor.BN(validAttestations[1].timestamp),
                },
                {
                    validatorPubkey: fakeValidator.publicKey,
                    signature: new Array(64).fill(99),  // Fake signature
                    timestamp: new anchor.BN(Date.now() / 1000),
                },
            ];

            const attestationData = {
                burnNonce: new anchor.BN(BURN_NONCE_8_2),
                user: userKeypair.publicKey,
                amount: new anchor.BN(BURN_AMOUNT),
                validatorSetVersion: new anchor.BN(currentVersion),
                attestations: mixedAttestations,
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

                console.log('\n❌ TEST FAILED: Mixed valid/unknown validators accepted!');
                console.log(`📝 TX: ${tx}`);

            } catch (error: any) {
                console.log('\n✅ TEST PASSED: Mixed validators rejected!');

                if (error.message.includes('ValidatorNotInSet') ||
                    error.message.includes('UnknownValidator') ||
                    error.message.includes('0x1002')) {
                    console.log('🔒 Reason: ValidatorNotInSet error (detected unknown validator)');
                } else {
                    console.log(`📝 Error: ${error.message.substring(0, 100)}`);
                }
            }
        } else {
            console.log(`\n❌ Only got ${validAttestations.length} valid attestations, need 2`);
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_8_2 to run Test 8.2');
    }

    console.log('\n━'.repeat(60));
    console.log('🎉 VALIDATOR INTEGRITY TESTS COMPLETE!');
    console.log('━'.repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
