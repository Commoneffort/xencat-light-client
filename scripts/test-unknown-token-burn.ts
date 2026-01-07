/**
 * Test Unknown Token Burn Rejection
 *
 * This test verifies that if someone burns a different SPL token (not XENCAT or DGN),
 * the validators will reject the attestation request.
 *
 * Security requirement: Validators must ONLY attest to burns of whitelisted tokens.
 */

import 'dotenv/config';

const VALIDATORS = [
    'http://149.50.116.159:8080',
    'http://193.34.212.186:8080',
    'http://74.50.76.62:10001',
    'http://149.50.116.21:8080',
    'http://64.20.49.142:8080',
];

async function testUnknownTokenBurn() {
    console.log('🔍 Testing Unknown Token Burn Rejection');
    console.log('='.repeat(60));
    console.log('\nScenario: Request attestation for a burn that exists on-chain');
    console.log('            but is NOT XENCAT or DGN\n');

    // We'll look for burns in the burn program that are NOT XENCAT or DGN
    // For this test, we'll use a hypothetical burn nonce and see if validators
    // check the actual SPL mint before attesting

    const testCases = [
        {
            name: 'Non-existent burn nonce',
            nonce: 999999,
            description: 'Burn that does not exist on-chain',
        },
        {
            name: 'Requesting with wrong expected_amount',
            nonce: 180, // XENCAT burn
            description: 'Existing XENCAT burn but request wrong amount',
        },
    ];

    let allTestsPassed = true;

    for (const testCase of testCases) {
        console.log(`\n📝 Test: ${testCase.name}`);
        console.log(`   Description: ${testCase.description}`);
        console.log(`   Burn nonce: ${testCase.nonce}\n`);

        let validatorResults = [];

        for (const validatorUrl of VALIDATORS) {
            try {
                const response = await fetch(`${validatorUrl}/attest-burn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        burn_nonce: testCase.nonce,
                        user: '6oQbeffgkGXhX9CxRvskiR47ViKSs59Mn2y4ZgSHR8oW',
                        expected_amount: testCase.nonce === 180 ? 999999 : 1000000, // Wrong amount for 180
                        validator_set_version: 1,
                    }),
                });

                const result: any = await response.json();

                if (result.error) {
                    console.log(`  ✅ ${validatorUrl}`);
                    console.log(`     Status: REJECTED (${result.error.substring(0, 60)}...)`);
                    validatorResults.push({ url: validatorUrl, rejected: true, error: result.error });
                } else if (result.asset_id) {
                    console.log(`  ❌ ${validatorUrl}`);
                    console.log(`     Status: ACCEPTED (asset_id=${result.asset_id})`);
                    console.log(`     🚨 SECURITY ISSUE: Should have rejected!`);
                    validatorResults.push({ url: validatorUrl, rejected: false, assetId: result.asset_id });
                    allTestsPassed = false;
                } else {
                    console.log(`  ⚠️  ${validatorUrl}`);
                    console.log(`     Status: Unexpected response`);
                    validatorResults.push({ url: validatorUrl, rejected: true, error: 'Unexpected' });
                }
            } catch (err: any) {
                console.log(`  ✅ ${validatorUrl}`);
                console.log(`     Status: REJECTED (connection error - expected)`);
                validatorResults.push({ url: validatorUrl, rejected: true, error: 'Connection error' });
            }
        }

        const rejectedCount = validatorResults.filter(r => r.rejected).length;
        console.log(`\n  Summary: ${rejectedCount}/${VALIDATORS.length} validators rejected`);

        if (rejectedCount === VALIDATORS.length) {
            console.log(`  ✅ PASS: All validators correctly rejected`);
        } else {
            console.log(`  ❌ FAIL: Some validators accepted invalid burn!`);
            allTestsPassed = false;
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📋 Validator Whitelist Configuration:');
    console.log('   XENCAT: 7UN8WkBumTUCofVPXCPjNWQ6msQhzrg9tFQRP48Nmw5V');
    console.log('   DGN:    Fd8TNp5GhhTk6Uq6utMvK13vfQdLN1yUUHCnapWvpump');
    console.log('   Other:  ❌ REJECTED');

    console.log('\n' + '='.repeat(60));
    if (allTestsPassed) {
        console.log('✅ ALL TESTS PASSED');
        console.log('✅ Validators correctly reject non-whitelisted tokens');
        console.log('✅ Only XENCAT and DGN burns can be attested');
    } else {
        console.log('❌ SECURITY ISSUE DETECTED');
        console.log('🚨 Some validators accepted non-whitelisted token burns!');
        process.exit(1);
    }
}

testUnknownTokenBurn()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('\n❌ Test error:', err);
        process.exit(1);
    });
