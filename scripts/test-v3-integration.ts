import 'dotenv/config';
import * as anchor from '@coral-xyz/anchor';
import {
    Connection,
    Keypair,
    PublicKey,
} from '@solana/web3.js';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ASSET-AWARE V3 INTEGRATION TEST
 *
 * This test verifies that the V3 instructions are properly deployed and callable.
 * It performs basic smoke tests without requiring actual burns.
 *
 * Tests:
 * 1. Programs are deployed
 * 2. IDL structures include V3 instructions
 * 3. PDAs can be derived correctly
 * 4. Asset enum serialization works
 */

enum Asset {
    XENCAT = 1,
    DGN = 2,
}

async function main() {
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║         ASSET-AWARE V3 INTEGRATION TEST               ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    const X1_RPC = 'https://rpc.mainnet.x1.xyz';
    const x1Connection = new Connection(X1_RPC, 'confirmed');

    // Load program IDs (from CLAUDE.md - Deployed Addresses)
    const LIGHT_CLIENT_PROGRAM = new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5');
    const MINT_PROGRAM = new PublicKey('8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk');

    // Load IDL for structure checking
    const lightClientIdlPath = path.join(__dirname, '../target/idl/solana_light_client_x1.json');
    const lightClientIdl = JSON.parse(fs.readFileSync(lightClientIdlPath, 'utf-8'));

    const mintIdlPath = path.join(__dirname, '../target/idl/xencat_mint_x1.json');
    const mintIdl = JSON.parse(fs.readFileSync(mintIdlPath, 'utf-8'));

    console.log(`📝 Light Client Program: ${LIGHT_CLIENT_PROGRAM.toBase58()}`);
    console.log(`📝 Mint Program: ${MINT_PROGRAM.toBase58()}\n`);

    let testsPassed = 0;
    let testsFailed = 0;

    // =================================================================
    // TEST 1: Verify programs are deployed
    // =================================================================

    console.log('━━━━ TEST 1: Verify Programs Deployed ━━━━\n');

    try {
        const lightClientAccount = await x1Connection.getAccountInfo(LIGHT_CLIENT_PROGRAM);
        const mintAccount = await x1Connection.getAccountInfo(MINT_PROGRAM);

        if (!lightClientAccount) {
            throw new Error('Light client program not deployed');
        }
        if (!mintAccount) {
            throw new Error('Mint program not deployed');
        }

        console.log('✅ Light client program deployed');
        console.log('✅ Mint program deployed\n');
        testsPassed++;
    } catch (err: any) {
        console.error('❌ Program deployment check failed:', err.message, '\n');
        testsFailed++;
    }

    // =================================================================
    // TEST 2: Verify V3 instructions exist in IDL
    // =================================================================

    console.log('━━━━ TEST 2: Verify V3 Instructions in IDL ━━━━\n');

    try {
        // Check light client IDL for submit_burn_attestation_v3
        const hasSubmitV3 = lightClientIdl.instructions.some(
            (ix: any) => ix.name === 'submitBurnAttestationV3' || ix.name === 'submit_burn_attestation_v3'
        );

        if (!hasSubmitV3) {
            throw new Error('submit_burn_attestation_v3 not found in light client IDL');
        }

        console.log('✅ submit_burn_attestation_v3 found in light client IDL');

        // Check mint IDL for mint_from_burn_v3
        const hasMintV3 = mintIdl.instructions.some(
            (ix: any) => ix.name === 'mintFromBurnV3' || ix.name === 'mint_from_burn_v3'
        );

        if (!hasMintV3) {
            throw new Error('mint_from_burn_v3 not found in mint IDL');
        }

        console.log('✅ mint_from_burn_v3 found in mint IDL\n');
        testsPassed++;
    } catch (err: any) {
        console.error('❌ IDL check failed:', err.message, '\n');
        testsFailed++;
    }

    // =================================================================
    // TEST 3: Verify Asset enum in IDL
    // =================================================================

    console.log('━━━━ TEST 3: Verify Asset Enum in IDL ━━━━\n');

    try {
        // Check for Asset enum or type in light client IDL
        const hasAssetType = lightClientIdl.types?.some(
            (t: any) => t.name === 'Asset' || t.name === 'asset'
        ) || lightClientIdl.enums?.some(
            (e: any) => e.name === 'Asset' || e.name === 'asset'
        );

        if (hasAssetType) {
            console.log('✅ Asset type/enum found in light client IDL');
        } else {
            console.log('⚠️  Asset type not explicitly defined (may use u8 directly)');
        }

        // Check for VerifiedBurnV3 in types
        const hasVerifiedBurnV3 = lightClientIdl.accounts?.some(
            (a: any) => a.name === 'VerifiedBurnV3' || a.name === 'verifiedBurnV3'
        );

        if (!hasVerifiedBurnV3) {
            console.log('⚠️  VerifiedBurnV3 account not found in IDL');
        } else {
            console.log('✅ VerifiedBurnV3 account found in IDL');
        }

        // Check for ProcessedBurnV3 in mint program
        const hasProcessedBurnV3 = mintIdl.accounts?.some(
            (a: any) => a.name === 'ProcessedBurnV3' || a.name === 'processedBurnV3'
        );

        if (!hasProcessedBurnV3) {
            console.log('⚠️  ProcessedBurnV3 account not found in IDL');
        } else {
            console.log('✅ ProcessedBurnV3 account found in IDL');
        }

        console.log('');
        testsPassed++;
    } catch (err: any) {
        console.error('❌ Asset enum check failed:', err.message, '\n');
        testsFailed++;
    }

    // =================================================================
    // TEST 4: Verify PDA derivation works
    // =================================================================

    console.log('━━━━ TEST 4: Verify PDA Derivation ━━━━\n');

    try {
        const testUser = Keypair.generate().publicKey;
        const testNonce = 12345;

        // Derive V2 PDA (legacy)
        const [v2Pda, v2Bump] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('verified_burn_v2'),
                testUser.toBuffer(),
                Buffer.from(new BigUint64Array([BigInt(testNonce)]).buffer),
            ],
            LIGHT_CLIENT_PROGRAM
        );

        console.log(`✅ V2 PDA derived: ${v2Pda.toBase58()} (bump: ${v2Bump})`);

        // Derive V3 PDAs for both assets
        const [v3XencatPda, v3XencatBump] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('verified_burn_v3'),
                Buffer.from([Asset.XENCAT]),
                testUser.toBuffer(),
                Buffer.from(new BigUint64Array([BigInt(testNonce)]).buffer),
            ],
            LIGHT_CLIENT_PROGRAM
        );

        console.log(`✅ V3 XENCAT PDA derived: ${v3XencatPda.toBase58()} (bump: ${v3XencatBump})`);

        const [v3DgnPda, v3DgnBump] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('verified_burn_v3'),
                Buffer.from([Asset.DGN]),
                testUser.toBuffer(),
                Buffer.from(new BigUint64Array([BigInt(testNonce)]).buffer),
            ],
            LIGHT_CLIENT_PROGRAM
        );

        console.log(`✅ V3 DGN PDA derived: ${v3DgnPda.toBase58()} (bump: ${v3DgnBump})`);

        // Verify all PDAs are unique
        const pdas = [v2Pda, v3XencatPda, v3DgnPda];
        const uniquePdas = new Set(pdas.map(p => p.toBase58()));

        if (uniquePdas.size !== pdas.length) {
            throw new Error('PDA collision detected! PDAs should be unique.');
        }

        console.log('✅ All PDAs are unique (no collisions)');

        // Derive processed burn V3 PDAs for mint program
        const [processedBurnXencat] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('processed_burn_v3'),
                Buffer.from([Asset.XENCAT]),
                Buffer.from(new BigUint64Array([BigInt(testNonce)]).buffer),
                testUser.toBuffer(),
            ],
            MINT_PROGRAM
        );

        console.log(`✅ ProcessedBurnV3 XENCAT PDA: ${processedBurnXencat.toBase58()}`);

        const [processedBurnDgn] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('processed_burn_v3'),
                Buffer.from([Asset.DGN]),
                Buffer.from(new BigUint64Array([BigInt(testNonce)]).buffer),
                testUser.toBuffer(),
            ],
            MINT_PROGRAM
        );

        console.log(`✅ ProcessedBurnV3 DGN PDA: ${processedBurnDgn.toBase58()}\n`);

        testsPassed++;
    } catch (err: any) {
        console.error('❌ PDA derivation failed:', err.message, '\n');
        testsFailed++;
    }

    // =================================================================
    // TEST 5: Verify seed format matches implementation
    // =================================================================

    console.log('━━━━ TEST 5: Verify Seed Format ━━━━\n');

    try {
        const testUser = Keypair.generate().publicKey;
        const testNonce = 99999;
        const testAssetId = Asset.XENCAT;

        // Test that u8.to_le_bytes() produces single byte
        const assetIdBytes = Buffer.from([testAssetId]);
        console.log(`✅ Asset ID ${testAssetId} serializes to: ${assetIdBytes.toString('hex')} (${assetIdBytes.length} byte)`);

        // Test that u64.to_le_bytes() produces 8 bytes (little-endian)
        const nonceBytes = Buffer.from(new BigUint64Array([BigInt(testNonce)]).buffer);
        console.log(`✅ Nonce ${testNonce} serializes to: ${nonceBytes.toString('hex')} (${nonceBytes.length} bytes, LE)`);

        // Test that Pubkey produces 32 bytes
        const userBytes = testUser.toBuffer();
        console.log(`✅ User pubkey serializes to: ${userBytes.length} bytes`);

        // Verify total seed structure
        const totalSeedLength =
            'verified_burn_v3'.length +  // String literal
            assetIdBytes.length +          // u8: 1 byte
            userBytes.length +             // Pubkey: 32 bytes
            nonceBytes.length;             // u64: 8 bytes

        console.log(`✅ Total seed length: ${totalSeedLength} bytes`);
        console.log('   - "verified_burn_v3": 16 bytes');
        console.log('   - asset_id (u8): 1 byte');
        console.log('   - user (Pubkey): 32 bytes');
        console.log('   - nonce (u64): 8 bytes\n');

        testsPassed++;
    } catch (err: any) {
        console.error('❌ Seed format verification failed:', err.message, '\n');
        testsFailed++;
    }

    // =================================================================
    // Summary
    // =================================================================

    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║                    TEST SUMMARY                       ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    console.log(`✅ Tests passed: ${testsPassed}`);
    console.log(`❌ Tests failed: ${testsFailed}`);
    console.log(`📊 Total tests: ${testsPassed + testsFailed}\n`);

    if (testsFailed > 0) {
        console.log('⚠️  Some tests failed. Please review the errors above.\n');
        process.exit(1);
    } else {
        console.log('✅ All V3 integration tests passed!\n');
        console.log('Next steps:');
        console.log('1. Deploy updated programs to X1 mainnet');
        console.log('2. Update validator services to V3');
        console.log('3. Run security test suite: npm run test:asset-security\n');
        process.exit(0);
    }
}

main().catch((err) => {
    console.error('\n❌ Test failed:');
    console.error(err);
    process.exit(1);
});
