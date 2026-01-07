import axios from 'axios';
import { PublicKey } from '@solana/web3.js';

/**
 * Test: Nonce Behavior Analysis
 *
 * Purpose: Verify that nonces are just identifiers, not sequential requirements
 *
 * Tests:
 * 1. Non-contiguous nonces (20, 21, 25, 32) should all work
 * 2. Missing nonce (e.g., 999999) should be rejected with "Burn not found"
 */

const VALIDATORS = [
    { name: 'Validator 3', url: 'http://74.50.76.62:10001' },
    { name: 'Validator 4', url: 'http://149.50.116.21:8080' },
    { name: 'Validator 5', url: 'http://64.20.49.142:8080' },
];

// Use a validator that's likely online
const TEST_VALIDATOR = VALIDATORS[0];

// Known existing burns with non-contiguous nonces (from mainnet)
const EXISTING_BURNS = [
    { nonce: 50, amount: 10000 }, // 0.01 XENCAT
    { nonce: 51, amount: 10000 },
    { nonce: 52, amount: 10000 },
    // Skip 53, 54, etc.
    { nonce: 60, amount: 10000 },
    { nonce: 91, amount: 10000 },
];

// Nonce that definitely doesn't exist
const MISSING_NONCE = 999999999;

// Test user (doesn't matter for this test, we're testing nonce behavior)
const TEST_USER = new PublicKey('6oQbeffgkGXhX9CxRvskiR47ViKSs59Mn2y4ZgSHR8oW');

async function testNonceBehavior() {
    console.log('🧪 Testing Nonce Behavior\n');
    console.log('=' .repeat(80));
    console.log('Objective: Verify nonces are identifiers, not sequential requirements');
    console.log('=' .repeat(80));
    console.log();

    let passCount = 0;
    let failCount = 0;

    // Test 1: Non-contiguous nonces should work
    console.log('📋 Test 1: Non-Contiguous Nonces');
    console.log('Testing nonces:', EXISTING_BURNS.map(b => b.nonce).join(', '));
    console.log('(Note: These are not sequential - gaps exist between them)');
    console.log();

    for (const burn of EXISTING_BURNS) {
        try {
            const response = await axios.post(`${TEST_VALIDATOR.url}/attest-burn`, {
                burn_nonce: burn.nonce,
                user: TEST_USER.toBase58(),
                expected_amount: burn.amount,
                validator_set_version: 1,
            }, {
                timeout: 10000,
                validateStatus: () => true, // Accept all status codes
            });

            if (response.status === 200) {
                console.log(`✅ Nonce ${burn.nonce}: ACCEPTED (Status: ${response.status})`);
                passCount++;
            } else if (response.status === 400 && response.data.error?.includes('mismatch')) {
                // User or amount mismatch is expected (we used a test user)
                console.log(`✅ Nonce ${burn.nonce}: FOUND (but user/amount mismatch - expected)`);
                passCount++;
            } else if (response.status === 404) {
                console.log(`❌ Nonce ${burn.nonce}: NOT FOUND (Status: ${response.status})`);
                console.log(`   Error: ${response.data.error || 'Unknown'}`);
                failCount++;
            } else {
                console.log(`⚠️  Nonce ${burn.nonce}: Unexpected status ${response.status}`);
                console.log(`   Response:`, response.data);
            }
        } catch (error: any) {
            if (error.code === 'ECONNREFUSED') {
                console.log(`❌ Validator offline: ${TEST_VALIDATOR.name}`);
                console.log('   Please use a different validator or ensure validator is running');
                return;
            }
            console.log(`❌ Nonce ${burn.nonce}: Error - ${error.message}`);
            failCount++;
        }
    }

    console.log();
    console.log('-'.repeat(80));
    console.log(`Test 1 Result: ${passCount}/${EXISTING_BURNS.length} nonces accessible`);
    console.log();

    // Test 2: Missing nonce should be rejected
    console.log('📋 Test 2: Missing Nonce Rejection');
    console.log(`Testing nonce: ${MISSING_NONCE} (does not exist on Solana)`);
    console.log();

    try {
        const response = await axios.post(`${TEST_VALIDATOR.url}/attest-burn`, {
            burn_nonce: MISSING_NONCE,
            user: TEST_USER.toBase58(),
            expected_amount: 10000,
            validator_set_version: 1,
        }, {
            timeout: 10000,
            validateStatus: () => true,
        });

        if (response.status === 404 || response.data.error?.includes('not found')) {
            console.log(`✅ Missing nonce correctly rejected`);
            console.log(`   Status: ${response.status}`);
            console.log(`   Error: ${response.data.error || 'Burn not found'}`);
            console.log();
            console.log('✅ Test 2: PASSED');
        } else {
            console.log(`❌ Missing nonce NOT rejected properly`);
            console.log(`   Status: ${response.status}`);
            console.log(`   Response:`, response.data);
            console.log();
            console.log('❌ Test 2: FAILED');
            failCount++;
        }
    } catch (error: any) {
        console.log(`❌ Test 2: Error - ${error.message}`);
        failCount++;
    }

    // Summary
    console.log();
    console.log('=' .repeat(80));
    console.log('📊 Summary');
    console.log('=' .repeat(80));

    if (passCount === EXISTING_BURNS.length && failCount === 0) {
        console.log('✅ ALL TESTS PASSED');
        console.log();
        console.log('Findings:');
        console.log('1. ✅ Non-contiguous nonces work correctly');
        console.log('2. ✅ Nonces are just identifiers, not sequential requirements');
        console.log('3. ✅ Missing nonces are properly rejected');
        console.log('4. ✅ Validators can access burns in any order');
        console.log();
        console.log('Conclusion: Nonce system is working as designed.');
    } else {
        console.log(`⚠️  ${failCount} test(s) failed or unexpected results`);
        console.log();
        console.log('Review the output above for details.');
    }
    console.log('=' .repeat(80));
}

// Run test
testNonceBehavior().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
