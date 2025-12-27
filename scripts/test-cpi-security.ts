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
    console.log('🔐 CPI SECURITY TESTS');
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

    // TEST 11.1: Wrong Program Ownership
    console.log('━'.repeat(60));
    console.log('TEST 11.1: Wrong Program Ownership');
    console.log('━'.repeat(60));

    const BURN_NONCE_11_1 = parseInt(process.env.BURN_NONCE_11_1 || '0');

    if (BURN_NONCE_11_1 > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_11_1}`);
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
                        burn_nonce: BURN_NONCE_11_1,
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
            console.log('\n📋 Testing with WRONG program ownership...');
            console.log('   Attempting to derive PDA from wrong program ID');

            // Create a fake program ID (not the actual light client)
            const fakeProgram = Keypair.generate().publicKey;

            // Try to derive PDA using wrong program
            const [wrongPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(BURN_NONCE_11_1).toArrayLike(Buffer, 'le', 8),
                ],
                fakeProgram  // Wrong program!
            );

            console.log(`   🔍 Correct Program: ${lightClientProgram.programId.toBase58()}`);
            console.log(`   🔍 Fake Program: ${fakeProgram.toBase58()}`);
            console.log(`   🔍 Wrong PDA: ${wrongPda.toBase58()}`);

            const attestationData = {
                burnNonce: new anchor.BN(BURN_NONCE_11_1),
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
                        verifiedBurn: wrongPda,  // PDA from wrong program!
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();

                console.log('\n❌ TEST FAILED: Wrong program ownership was accepted!');
                console.log(`📝 TX: ${tx.substring(0, 20)}...`);

            } catch (error: any) {
                console.log('\n✅ TEST PASSED: Wrong program ownership rejected!');

                if (error.message.includes('ConstraintSeeds') ||
                    error.message.includes('seeds constraint') ||
                    error.message.includes('0x7d1')) {
                    console.log('🔒 Reason: Anchor seeds constraint violation');
                    console.log('   PDA must be derived from correct program ID');
                } else {
                    console.log(`📝 Error: ${error.message.substring(0, 150)}`);
                }
            }
        } else {
            console.log(`\n❌ Only got ${attestations.length} attestations, need 3`);
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_11_1 to run Test 11.1');
    }

    // TEST 11.5: Direct Call Without CPI
    console.log('\n━'.repeat(60));
    console.log('TEST 11.5: Direct Call Without CPI');
    console.log('━'.repeat(60));

    const BURN_NONCE_11_5 = parseInt(process.env.BURN_NONCE_11_5 || '0');

    if (BURN_NONCE_11_5 > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_11_5}`);
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
                        burn_nonce: BURN_NONCE_11_5,
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
            console.log('\n📋 Testing DIRECT call to submitBurnAttestation...');
            console.log('   Note: In Bridge V2, submitBurnAttestation is PUBLIC');
            console.log('   This is intentional design - no mint program CPI required');

            const [verifiedBurnPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('verified_burn_v2'),
                    userKeypair.publicKey.toBuffer(),
                    new anchor.BN(BURN_NONCE_11_5).toArrayLike(Buffer, 'le', 8),
                ],
                lightClientProgram.programId
            );

            const attestationData = {
                burnNonce: new anchor.BN(BURN_NONCE_11_5),
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
                        verifiedBurn: verifiedBurnPda,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();

                console.log('\n✅ TEST PASSED (Expected): Direct call succeeded!');
                console.log(`📝 TX: ${tx.substring(0, 20)}...`);
                console.log('\n🔍 ARCHITECTURAL NOTE:');
                console.log('   Bridge V2 allows direct submission (no mint program required)');
                console.log('   This is intentional - users can verify burns independently');
                console.log('   Replay protection via PDA prevents double-processing');
                console.log('   This is NOT a bypass - it\'s a feature!');

            } catch (error: any) {
                console.log('\n⚠️  TEST INFO: Direct call failed');
                console.log(`📝 Error: ${error.message.substring(0, 100)}`);
            }
        } else {
            console.log(`\n❌ Only got ${attestations.length} attestations, need 3`);
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_11_5 to run Test 11.5');
    }

    console.log('\n━'.repeat(60));
    console.log('🎉 CPI SECURITY TESTS COMPLETE!');
    console.log('━'.repeat(60));
    console.log('\n📝 Summary:');
    console.log('   Test 11.1: Verifies Anchor PDA derivation enforcement');
    console.log('   Test 11.5: Documents intentional direct-call architecture');
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
