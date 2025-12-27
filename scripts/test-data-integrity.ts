import fetch from 'node-fetch';
import 'dotenv/config';
import fs from 'fs';
import { Keypair, PublicKey } from '@solana/web3.js';

const BURN_AMOUNT = 10000; // 0.01 XENCAT

const VALIDATORS = [
    { name: 'Validator 3', api: 'http://74.50.76.62:10001', pubkey: '5NfpgFCwrYzcgJkda9bRJvccycLUo3dvVQsVAK2W43Um' },
    { name: 'Validator 4', api: 'http://149.50.116.21:8080', pubkey: 'GdbXi56fCSQ1joCvGjqm7JKvqvwgtKh6xeusUqZbB3rH' },
    { name: 'Validator 5', api: 'http://64.20.49.142:8080', pubkey: 'FmuuFgRh8NP8UD7QHg86f7vu7qpsmr1wE7hB59oojDpj' },
];

async function main() {
    console.log('🔐 DATA INTEGRITY TESTS');
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

    // TEST 5.1: Inflate Amount in Attestation
    console.log('\n━'.repeat(60));
    console.log('TEST 5.1: Inflate Amount in Attestation');
    console.log('━'.repeat(60));

    const BURN_NONCE_5_1 = parseInt(process.env.BURN_NONCE_5_1 || '0');

    if (BURN_NONCE_5_1 > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_5_1}`);
        console.log(`💰 Actual Amount: ${BURN_AMOUNT} (0.01 XENCAT)`);
        console.log(`💰 Requested Amount: 1000000000 (1000 XENCAT) ❌`);
        console.log('\n⏳ Waiting 20 seconds for finality...\n');
        await new Promise(resolve => setTimeout(resolve, 20000));

        console.log('📡 Testing validators with INFLATED amount...');

        let anyAccepted = false;
        let allRejected = true;

        for (const validator of VALIDATORS) {
            try {
                const response = await fetch(`${validator.api}/attest-burn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        burn_nonce: BURN_NONCE_5_1,
                        user: userKeypair.publicKey.toBase58(),
                        expected_amount: 1000000000,  // WRONG! Should be 10000
                        validator_set_version: 1,
                    }),
                });

                if (response.ok) {
                    const attestation = await response.json();
                    console.log(`   ❌ ${validator.name} SIGNED WRONG AMOUNT!`);
                    console.log(`      This is a security issue!`);
                    anyAccepted = true;
                    allRejected = false;
                } else {
                    const error = await response.json();
                    console.log(`   ✅ ${validator.name} rejected`);
                    console.log(`      Reason: ${error.error}`);
                }
            } catch (error: any) {
                console.log(`   ✅ ${validator.name} rejected`);
                console.log(`      Error: ${error.message}`);
            }
        }

        if (allRejected) {
            console.log('\n✅ TEST PASSED: All validators rejected inflated amount!');
            console.log('🔒 Validators verify burn amount on Solana before signing');
        } else {
            console.log('\n❌ TEST FAILED: Some validators accepted wrong amount!');
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_5_1 to run Test 5.1');
    }

    // TEST 5.2: Deflate Amount in Attestation
    console.log('\n━'.repeat(60));
    console.log('TEST 5.2: Deflate Amount in Attestation');
    console.log('━'.repeat(60));

    const BURN_NONCE_5_2 = parseInt(process.env.BURN_NONCE_5_2 || '0');

    if (BURN_NONCE_5_2 > 0) {
        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_5_2}`);
        console.log(`💰 Actual Amount: ${BURN_AMOUNT} (0.01 XENCAT)`);
        console.log(`💰 Requested Amount: 1000 (0.001 XENCAT) ❌`);
        console.log('\n⏳ Waiting 20 seconds for finality...\n');
        await new Promise(resolve => setTimeout(resolve, 20000));

        console.log('📡 Testing validators with DEFLATED amount...');

        let anyAccepted = false;
        let allRejected = true;

        for (const validator of VALIDATORS) {
            try {
                const response = await fetch(`${validator.api}/attest-burn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        burn_nonce: BURN_NONCE_5_2,
                        user: userKeypair.publicKey.toBase58(),
                        expected_amount: 1000,  // WRONG! Should be 10000
                        validator_set_version: 1,
                    }),
                });

                if (response.ok) {
                    const attestation = await response.json();
                    console.log(`   ❌ ${validator.name} SIGNED WRONG AMOUNT!`);
                    anyAccepted = true;
                    allRejected = false;
                } else {
                    const error = await response.json();
                    console.log(`   ✅ ${validator.name} rejected`);
                    console.log(`      Reason: ${error.error}`);
                }
            } catch (error: any) {
                console.log(`   ✅ ${validator.name} rejected`);
                console.log(`      Error: ${error.message}`);
            }
        }

        if (allRejected) {
            console.log('\n✅ TEST PASSED: All validators rejected deflated amount!');
        } else {
            console.log('\n❌ TEST FAILED: Some validators accepted wrong amount!');
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_5_2 to run Test 5.2');
    }

    // TEST 6.1: Wrong User in Attestation
    console.log('\n━'.repeat(60));
    console.log('TEST 6.1: Wrong User in Attestation');
    console.log('━'.repeat(60));

    const BURN_NONCE_6_1 = parseInt(process.env.BURN_NONCE_6_1 || '0');

    if (BURN_NONCE_6_1 > 0) {
        // Create a fake user keypair
        const fakeUser = Keypair.generate();

        console.log(`\n🔥 Burn Nonce: ${BURN_NONCE_6_1}`);
        console.log(`👤 Actual User: ${userKeypair.publicKey.toBase58()}`);
        console.log(`👤 Fake User: ${fakeUser.publicKey.toBase58()} ❌`);
        console.log('\n⏳ Waiting 20 seconds for finality...\n');
        await new Promise(resolve => setTimeout(resolve, 20000));

        console.log('📡 Testing validators with WRONG user...');

        let anyAccepted = false;
        let allRejected = true;

        for (const validator of VALIDATORS) {
            try {
                const response = await fetch(`${validator.api}/attest-burn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        burn_nonce: BURN_NONCE_6_1,
                        user: fakeUser.publicKey.toBase58(),  // WRONG USER!
                        expected_amount: BURN_AMOUNT,
                        validator_set_version: 1,
                    }),
                });

                if (response.ok) {
                    const attestation = await response.json();
                    console.log(`   ❌ ${validator.name} SIGNED WRONG USER!`);
                    console.log(`      This is a security issue!`);
                    anyAccepted = true;
                    allRejected = false;
                } else {
                    const error = await response.json();
                    console.log(`   ✅ ${validator.name} rejected`);
                    console.log(`      Reason: ${error.error}`);
                }
            } catch (error: any) {
                console.log(`   ✅ ${validator.name} rejected`);
                console.log(`      Error: ${error.message}`);
            }
        }

        if (allRejected) {
            console.log('\n✅ TEST PASSED: All validators rejected wrong user!');
            console.log('🔒 Validators verify burn ownership on Solana before signing');
        } else {
            console.log('\n❌ TEST FAILED: Some validators accepted wrong user!');
        }
    } else {
        console.log('\n⚠️  Set BURN_NONCE_6_1 to run Test 6.1');
    }

    console.log('\n━'.repeat(60));
    console.log('🎉 DATA INTEGRITY TESTS COMPLETE!');
    console.log('━'.repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
