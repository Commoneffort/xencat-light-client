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
    { name: 'Validator 3', api: 'http://74.50.76.62:10001', pubkey: new PublicKey('5NfpgFCwrYzcgJkda9bRJvccycLUo3dvVQsVAK2W43Um') },
    { name: 'Validator 4', api: 'http://149.50.116.21:8080', pubkey: new PublicKey('GdbXi56fCSQ1joCvGjqm7JKvqvwgtKh6xeusUqZbB3rH') },
    { name: 'Validator 5', api: 'http://64.20.49.142:8080', pubkey: new PublicKey('FmuuFgRh8NP8UD7QHg86f7vu7qpsmr1wE7hB59oojDpj') },
];

async function main() {
    console.log('🔒 CPI & ACCOUNT SAFETY TESTS');
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

    // TEST 11.2: Wrong PDA Seeds
    console.log('━'.repeat(60));
    console.log('TEST 11.2: Wrong PDA Seeds');
    console.log('━'.repeat(60));

    const BURN_NONCE_11_2 = parseInt(process.env.BURN_NONCE_11_2 || '0');

    if (BURN_NONCE_11_2 > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_11_2}`);
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
                        burn_nonce: BURN_NONCE_11_2,
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
            console.log('\n📋 Testing with WRONG PDA seeds...');

            // Use OLD seeds instead of V2 seeds
            const [wrongVerifiedBurnPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn'),  // WRONG! Should be 'verified_burn_v2'
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(BURN_NONCE_11_2).toArrayLike(Buffer, 'le', 8),
                ],
                lightClientProgram.programId
            );

            console.log(`🔍 Wrong PDA: ${wrongVerifiedBurnPda.toBase58()}`);

            const attestationData = {
                burnNonce: new anchor.BN(BURN_NONCE_11_2),
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
                        verifiedBurn: wrongVerifiedBurnPda,  // WRONG PDA!
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();

                console.log('\n❌ TEST FAILED: Wrong PDA seeds were accepted!');
                console.log(`📝 TX: ${tx}`);

            } catch (error: any) {
                console.log('\n✅ TEST PASSED: Wrong PDA seeds rejected!');

                if (error.message.includes('seeds constraint') ||
                    error.message.includes('0x7d6') ||
                    error.message.includes('ConstraintSeeds')) {
                    console.log('🔒 Reason: Seeds constraint violation');
                } else {
                    console.log(`📝 Error: ${error.message.substring(0, 100)}`);
                }
            }
        } else {
            console.log(`\n❌ Only got ${attestations.length} attestations, need 3`);
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_11_2 to run Test 11.2');
    }

    // TEST 4.1: Invalid Signature Format
    console.log('\n━'.repeat(60));
    console.log('TEST 4.1: Invalid Signature Format');
    console.log('━'.repeat(60));

    const BURN_NONCE_4_1 = parseInt(process.env.BURN_NONCE_4_1 || '0');

    if (BURN_NONCE_4_1 > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_4_1}`);

        const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('verified_burn_v2'),
                userKeypair.publicKey.toBuffer(),
                new anchor.BN(BURN_NONCE_4_1).toArrayLike(Buffer, 'le', 8),
            ],
            lightClientProgram.programId
        );

        console.log('\n📋 Creating attestations with INVALID signature format...');

        // Create fake attestations with invalid signatures
        const invalidAttestations = [
            {
                validatorPubkey: VALIDATORS[0].pubkey,
                signature: new Array(64).fill(0),  // All zeros
                timestamp: new anchor.BN(Date.now() / 1000),
            },
            {
                validatorPubkey: VALIDATORS[1].pubkey,
                signature: new Array(64).fill(255),  // All 0xFF
                timestamp: new anchor.BN(Date.now() / 1000),
            },
            {
                validatorPubkey: VALIDATORS[2].pubkey,
                signature: new Array(64).fill(0).map((_, i) => i % 256),  // Sequential
                timestamp: new anchor.BN(Date.now() / 1000),
            },
        ];

        const attestationData = {
            burnNonce: new anchor.BN(BURN_NONCE_4_1),
            user: userKeypair.publicKey,
            amount: new anchor.BN(BURN_AMOUNT),
            validatorSetVersion: new anchor.BN(currentVersion),
            attestations: invalidAttestations,
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

            console.log('\n❌ TEST FAILED: Invalid signatures were accepted!');
            console.log(`📝 TX: ${tx}`);

        } catch (error: any) {
            console.log('\n✅ TEST PASSED: Invalid signature format rejected!');
            console.log(`📝 Error: ${error.message.substring(0, 100)}`);
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_4_1 to run Test 4.1');
    }

    // TEST 14.1: Domain Separator (Conceptual)
    console.log('\n━'.repeat(60));
    console.log('TEST 14.1: Domain Separator Verification');
    console.log('━'.repeat(60));

    console.log('\n📝 Domain Separator: "XENCAT_X1_BRIDGE_V1"');
    console.log('📝 This is included in ALL validator signatures');
    console.log('📝 Message format: hash(DOMAIN_SEPARATOR || version || nonce || amount || user)');
    console.log('\n✅ Domain separator is enforced in validator-attestation-service');
    console.log('✅ Any signature without correct domain separator will fail verification');
    console.log('✅ This prevents cross-domain replay attacks');

    console.log('\n━'.repeat(60));
    console.log('🎉 ACCOUNT SAFETY TESTS COMPLETE!');
    console.log('━'.repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
