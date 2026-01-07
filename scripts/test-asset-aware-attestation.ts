import axios from 'axios';
import { PublicKey } from '@solana/web3.js';

/**
 * Test: Asset-Aware Attestation Validation
 *
 * Purpose: Verify validator service correctly detects burned SPL mints
 *          and enforces asset-aware attestations
 *
 * Tests:
 * 1. XENCAT burn → asset_id=1
 * 2. Unknown mint burn → rejection
 * 3. V3 attestation format includes asset_id
 */

const VALIDATORS = [
    { name: 'Validator 3', url: 'http://74.50.76.62:10001' },
    { name: 'Validator 4', url: 'http://149.50.116.21:8080' },
    { name: 'Validator 5', url: 'http://64.20.49.142:8080' },
];

// Use validator for testing
const TEST_VALIDATOR = VALIDATORS[0];

// Known XENCAT burns on mainnet
const XENCAT_TEST_BURNS = [
    { nonce: 50, amount: 10000, user: '6oQbeffgkGXhX9CxRvskiR47ViKSs59Mn2y4ZgSHR8oW' },
    { nonce: 91, amount: 10000, user: '6oQbeffgkGXhX9CxRvskiR47ViKSs59Mn2y4ZgSHR8oW' },
];

// Expected asset IDs
const ASSET_XENCAT = 1;
const ASSET_DGN = 2;

async function testAssetAwareAttestation() {
    console.log('🧪 Testing Asset-Aware Attestation Validation\n');
    console.log('=' .repeat(80));
    console.log('Objective: Verify validator correctly detects burned SPL mints');
    console.log('=' .repeat(80));
    console.log();

    let passCount = 0;
    let failCount = 0;

    // Test 1: XENCAT burn should return asset_id = 1
    console.log('📋 Test 1: XENCAT Burn Detection');
    console.log(`Testing nonce: ${XENCAT_TEST_BURNS[0].nonce}`);
    console.log();

    try {
        const burn = XENCAT_TEST_BURNS[0];
        const response = await axios.post(`${TEST_VALIDATOR.url}/attest-burn`, {
            burn_nonce: burn.nonce,
            user: burn.user,
            expected_amount: burn.amount,
            validator_set_version: 1,
        }, {
            timeout: 30000,
            validateStatus: () => true,
        });

        if (response.status === 200) {
            const attestation = response.data;

            console.log('✅ Attestation Response:');
            console.log(`   Status: ${response.status}`);
            console.log(`   asset_id: ${attestation.asset_id}`);
            console.log(`   asset_name: ${attestation.asset_name}`);
            console.log(`   burn_nonce: ${attestation.burn_nonce}`);
            console.log(`   amount: ${attestation.amount}`);
            console.log(`   user: ${attestation.user}`);
            console.log();

            // Verify asset_id is XENCAT
            if (attestation.asset_id === ASSET_XENCAT) {
                console.log(`✅ Test 1: PASSED - Correct asset_id (${ASSET_XENCAT} = XENCAT)`);
                passCount++;
            } else {
                console.log(`❌ Test 1: FAILED - Wrong asset_id`);
                console.log(`   Expected: ${ASSET_XENCAT} (XENCAT)`);
                console.log(`   Actual: ${attestation.asset_id}`);
                failCount++;
            }

            // Verify asset_id is included in response
            if ('asset_id' in attestation) {
                console.log('✅ Test 1a: PASSED - asset_id field present in V3 response');
                passCount++;
            } else {
                console.log('❌ Test 1a: FAILED - asset_id field missing');
                failCount++;
            }

        } else if (response.status === 400 && response.data.error?.includes('Unknown')) {
            console.log('❌ Test 1: FAILED - XENCAT burn rejected as unknown');
            console.log(`   Error: ${response.data.error}`);
            console.log('   This suggests the validator is not using the V3 asset-aware service');
            failCount += 2;
        } else {
            console.log(`❌ Test 1: FAILED - Unexpected response`);
            console.log(`   Status: ${response.status}`);
            console.log(`   Response:`, response.data);
            failCount += 2;
        }
    } catch (error: any) {
        if (error.code === 'ECONNREFUSED') {
            console.log(`❌ Validator offline: ${TEST_VALIDATOR.name}`);
            console.log('   Cannot test asset-aware attestation');
            return;
        }
        console.log(`❌ Test 1: Error - ${error.message}`);
        failCount += 2;
    }

    console.log();
    console.log('-'.repeat(80));
    console.log();

    // Test 2: V3 attestation format verification
    console.log('📋 Test 2: V3 Attestation Format Verification');
    console.log(`Testing with another XENCAT burn (nonce ${XENCAT_TEST_BURNS[1].nonce})`);
    console.log();

    try {
        const burn = XENCAT_TEST_BURNS[1];
        const response = await axios.post(`${TEST_VALIDATOR.url}/attest-burn`, {
            burn_nonce: burn.nonce,
            user: burn.user,
            expected_amount: burn.amount,
            validator_set_version: 1,
        }, {
            timeout: 30000,
            validateStatus: () => true,
        });

        if (response.status === 200) {
            const attestation = response.data;

            const requiredFields = [
                'asset_id',
                'burn_nonce',
                'user',
                'amount',
                'validator_set_version',
                'validator_pubkey',
                'signature',
                'timestamp'
            ];

            const missingFields = requiredFields.filter(field => !(field in attestation));

            if (missingFields.length === 0) {
                console.log('✅ Test 2: PASSED - All required V3 fields present');
                console.log('   Required fields:', requiredFields.join(', '));
                passCount++;
            } else {
                console.log('❌ Test 2: FAILED - Missing required fields');
                console.log('   Missing:', missingFields.join(', '));
                failCount++;
            }
        } else {
            console.log('❌ Test 2: FAILED - Could not get attestation');
            console.log(`   Status: ${response.status}`);
            failCount++;
        }
    } catch (error: any) {
        console.log(`❌ Test 2: Error - ${error.message}`);
        failCount++;
    }

    console.log();
    console.log('-'.repeat(80));
    console.log();

    // Test 3: Unknown mint rejection (would need to create a burn with unknown token)
    console.log('📋 Test 3: Unknown Mint Rejection');
    console.log('Note: This test requires burning an unknown SPL token on Solana');
    console.log('Skipping for now (would need test setup on Solana)');
    console.log();

    // Summary
    console.log('=' .repeat(80));
    console.log('📊 Summary');
    console.log('=' .repeat(80));

    const totalTests = passCount + failCount;
    console.log(`Tests Run: ${totalTests}`);
    console.log(`Passed: ${passCount}`);
    console.log(`Failed: ${failCount}`);
    console.log();

    if (failCount === 0 && passCount > 0) {
        console.log('✅ ALL TESTS PASSED');
        console.log();
        console.log('Findings:');
        console.log('1. ✅ Validator correctly identifies XENCAT burns (asset_id=1)');
        console.log('2. ✅ V3 attestation format includes asset_id field');
        console.log('3. ✅ Asset-aware attestation service is working');
        console.log();
        console.log('⚠️  Note: This validator appears to be running V3 (asset-aware) service');
        console.log('   Verify ALL 5 validators are updated to V3 before production use');
    } else if (passCount === 0) {
        console.log('❌ ALL TESTS FAILED');
        console.log();
        console.log('Likely cause:');
        console.log('- Validator is still running V2 (non-asset-aware) service');
        console.log('- Validator needs to be updated to index-v3-asset-aware.ts');
    } else {
        console.log(`⚠️  ${failCount} test(s) failed`);
        console.log();
        console.log('Review the output above for details.');
    }
    console.log('=' .repeat(80));
}

// Run test
testAssetAwareAttestation().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
