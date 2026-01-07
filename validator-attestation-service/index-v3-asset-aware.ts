import express from 'express';
import { Connection, PublicKey, Keypair, ParsedTransactionWithMeta, ParsedInstruction, PartiallyDecodedInstruction } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import 'dotenv/config';

const app = express();
app.use(express.json());

// Configuration
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const BURN_PROGRAM_ID = new PublicKey('2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const VALIDATOR_PRIVATE_KEY = process.env.VALIDATOR_PRIVATE_KEY; // Your validator key
const PORT = process.env.PORT || 8080;
const FINALITY_SLOTS = 32; // Wait 32 slots for finality

if (!VALIDATOR_PRIVATE_KEY) {
    throw new Error('VALIDATOR_PRIVATE_KEY required');
}

// Load validator keypair
let validatorKeypair: Keypair;
try {
    const privateKeyArray = JSON.parse(VALIDATOR_PRIVATE_KEY);
    validatorKeypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
} catch {
    validatorKeypair = Keypair.fromSecretKey(bs58.decode(VALIDATOR_PRIVATE_KEY));
}

console.log('🔑 Validator Public Key:', validatorKeypair.publicKey.toBase58());

const solanaConnection = new Connection(SOLANA_RPC, 'confirmed');

// ============================================================================
// SECTION 6.1: Asset Registry (Authoritative)
// ============================================================================

enum Asset {
    XENCAT = 1,
    DGN = 2,
}

// Asset mint addresses (Solana SPL tokens)
const XENCAT_MINT = new PublicKey('7UN8WkBumTUCofVPXCPjNWQ6msQhzrg9tFQRP48Nmw5V');
const DGN_MINT = new PublicKey('Fd8TNp5GhhTk6Uq6utMvK13vfQdLN1yUUHCnapWvpump');

// Asset Registry: Maps SPL mint address → asset_id
const ASSET_BY_MINT: Record<string, Asset> = {
    [XENCAT_MINT.toBase58()]: Asset.XENCAT,
    [DGN_MINT.toBase58()]: Asset.DGN,
};

// Reverse mapping: asset_id → mint address (for logging)
const MINT_BY_ASSET: Record<Asset, PublicKey> = {
    [Asset.XENCAT]: XENCAT_MINT,
    [Asset.DGN]: DGN_MINT,
};

// Asset names for logging
const ASSET_NAMES: Record<Asset, string> = {
    [Asset.XENCAT]: 'XENCAT',
    [Asset.DGN]: 'DGN',
};

// ============================================================================
// SECTION 6.2: Detect Burned SPL Mint
// ============================================================================

interface BurnDetectionResult {
    asset_id: Asset;
    mint: PublicKey;
    token_account: PublicKey;
}

/**
 * Detects which SPL token was burned by analyzing the burn transaction.
 *
 * Requirements (from spec):
 * - Fetch the burn transaction
 * - Parse inner instructions
 * - Locate exactly one SPL Token Burn instruction
 * - Extract burned mint address
 * - Map mint → asset_id
 * - Reject if unknown mint
 * - Reject if no burn found
 * - Reject if multiple burns found
 * - Reject Token-2022 burns (not supported)
 *
 * @param burnNonce The burn nonce to analyze
 * @returns { asset_id, mint, token_account } or null if invalid
 */
async function detectBurnedMint(burnNonce: number): Promise<BurnDetectionResult | null> {
    try {
        // 1. Get BurnRecord PDA address
        const [burnRecordPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('burn_record'),
                new anchor.BN(burnNonce).toArrayLike(Buffer, 'le', 8)
            ],
            BURN_PROGRAM_ID
        );

        // 2. Fetch signatures for this PDA (should be exactly 1 - the creation tx)
        const signatures = await solanaConnection.getSignaturesForAddress(
            burnRecordPda,
            { limit: 1 }
        );

        if (!signatures || signatures.length === 0) {
            console.log('❌ No transaction found for burn nonce', burnNonce);
            return null;
        }

        const txSignature = signatures[0].signature;
        console.log(`   🔍 Analyzing burn transaction: ${txSignature}`);

        // 3. Fetch full transaction with parsed instructions
        const tx: ParsedTransactionWithMeta | null = await solanaConnection.getParsedTransaction(
            txSignature,
            {
                maxSupportedTransactionVersion: 0,
                commitment: 'confirmed'
            }
        );

        if (!tx || !tx.meta) {
            console.log('❌ Transaction not found or has no metadata');
            return null;
        }

        // 4. Extract all SPL Token "burn" instructions
        const burnInstructions: Array<{
            mint: PublicKey;
            account: PublicKey;
            amount: string;
        }> = [];

        // Check both top-level and inner instructions
        const allInstructions = [
            ...tx.transaction.message.instructions,
            ...(tx.meta.innerInstructions?.flatMap(inner => inner.instructions) || [])
        ];

        for (const ix of allInstructions) {
            // Type guard: check if this is a parsed instruction
            if ('parsed' in ix && ix.parsed) {
                const parsed = ix.parsed as any;

                // Check if this is a SPL Token Program instruction
                if (
                    ix.program === 'spl-token' &&
                    parsed.type === 'burn' &&
                    parsed.info
                ) {
                    const mint = new PublicKey(parsed.info.mint);
                    const account = new PublicKey(parsed.info.account);
                    const amount = parsed.info.amount || parsed.info.tokenAmount?.amount || '0';

                    burnInstructions.push({ mint, account, amount });

                    console.log(`   ✅ Found SPL Token burn:`);
                    console.log(`      Mint: ${mint.toBase58()}`);
                    console.log(`      Token Account: ${account.toBase58()}`);
                    console.log(`      Amount: ${amount}`);
                }
            }
        }

        // 5. Validate exactly one burn instruction
        if (burnInstructions.length === 0) {
            console.log('❌ No SPL Token burn instruction found in transaction');
            return null;
        }

        if (burnInstructions.length > 1) {
            console.log(`❌ Multiple burns found (${burnInstructions.length}). Expected exactly 1.`);
            return null;
        }

        const burnIx = burnInstructions[0];

        // 6. Map mint → asset_id via registry
        const mintAddress = burnIx.mint.toBase58();
        const asset_id = ASSET_BY_MINT[mintAddress];

        if (asset_id === undefined) {
            console.log(`❌ Unknown SPL mint: ${mintAddress}`);
            console.log(`   Supported mints:`);
            Object.entries(ASSET_BY_MINT).forEach(([mint, id]) => {
                console.log(`      ${ASSET_NAMES[id]}: ${mint}`);
            });
            return null;
        }

        console.log(`   ✅ Identified asset: ${ASSET_NAMES[asset_id]} (asset_id=${asset_id})`);

        return {
            asset_id,
            mint: burnIx.mint,
            token_account: burnIx.account
        };

    } catch (error: any) {
        console.error('❌ Error detecting burned mint:', error.message);
        return null;
    }
}

// ============================================================================
// Fetch burn record from Solana (unchanged)
// ============================================================================

async function fetchBurnRecord(burnNonce: number) {
    const [burnRecordPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('burn_record'),
            new anchor.BN(burnNonce).toArrayLike(Buffer, 'le', 8)
        ],
        BURN_PROGRAM_ID
    );

    const accountInfo: any = await solanaConnection.getAccountInfo(burnRecordPda);
    if (!accountInfo) {
        return null;
    }

    // Parse burn record (layout: user=32, amount=8, nonce=8, timestamp=8)
    const data = accountInfo.data;
    const user = new PublicKey(data.slice(8, 40)); // Skip 8-byte discriminator
    const amount = new anchor.BN(data.slice(40, 48), 'le').toNumber();
    const nonce = new anchor.BN(data.slice(48, 56), 'le').toNumber();
    const timestamp = new anchor.BN(data.slice(56, 64), 'le').toNumber();

    // Get the actual slot from when the account was created
    let slot = 0;
    try {
        const signatures = await solanaConnection.getSignaturesForAddress(burnRecordPda, { limit: 1 });
        if (signatures && signatures.length > 0) {
            slot = signatures[0].slot;
        }
    } catch (e) {
        console.error('Error fetching slot:', e);
        const currentSlot = await solanaConnection.getSlot('confirmed');
        slot = currentSlot - 100; // Assume it's old enough
    }

    return { user, amount, nonce, timestamp, slot };
}

// ============================================================================
// SECTION 6.3: Asset-Aware Attestation Message
// ============================================================================

// Domain separator (must match on-chain constant)
const DOMAIN_SEPARATOR = 'XENCAT_X1_BRIDGE_V1';

/**
 * Create attestation message V3 (asset-aware)
 *
 * Old format (INSECURE):
 *   hash(DOMAIN_SEPARATOR || validator_set_version || burn_nonce || amount || user)
 *
 * New format (SECURE):
 *   hash(DOMAIN_SEPARATOR || asset_id || validator_set_version || burn_nonce || amount || user)
 *
 * This ensures:
 * - No cross-asset replay (different asset_id → different hash → different signature)
 * - No signature reuse (signatures are cryptographically bound to specific asset)
 * - Cryptographic isolation between assets
 */
function createAttestationMessageV3(
    asset_id: Asset,
    burnNonce: number,
    user: PublicKey,
    amount: number,
    validatorSetVersion: number
): Buffer {
    const messageData = Buffer.concat([
        Buffer.from(DOMAIN_SEPARATOR),                                            // Domain
        Buffer.from([asset_id]),                                                  // Asset ID (u8) ✅ NEW
        Buffer.from(new BigUint64Array([BigInt(validatorSetVersion)]).buffer),   // Version
        Buffer.from(new BigUint64Array([BigInt(burnNonce)]).buffer),             // Nonce
        Buffer.from(new BigUint64Array([BigInt(amount)]).buffer),                // Amount
        user.toBuffer(),                                                          // User
    ]);

    // Hash to match Solana's hash() function (SHA256)
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(messageData).digest();

    return hash;
}

// ============================================================================
// SECTION 6.4: Asset-Aware Attestation Endpoint
// ============================================================================

// API endpoint: POST /attest-burn (V3 - asset-aware)
app.post('/attest-burn', async (req, res) => {
    try {
        const { burn_nonce, user, expected_amount, validator_set_version } = req.body;

        if (!burn_nonce || !user || !expected_amount || validator_set_version === undefined) {
            return res.status(400).json({
                error: 'Missing required fields: burn_nonce, user, expected_amount, validator_set_version'
            });
        }

        console.log(`\n📥 Attestation request V3 (asset-aware) for burn ${burn_nonce}`);
        console.log(`   User: ${user}`);
        console.log(`   Expected amount: ${expected_amount}`);
        console.log(`   Validator set version: ${validator_set_version}`);

        // ✅ NEW: Step 1 - Detect which SPL token was burned
        const burnDetection = await detectBurnedMint(burn_nonce);

        if (!burnDetection) {
            console.log('❌ Burn detection failed - unknown or invalid SPL token burn');
            return res.status(400).json({
                error: 'Unknown or invalid SPL token burn',
                burn_nonce,
                message: 'This validator only attests to burns of supported assets (XENCAT, DGN)'
            });
        }

        const { asset_id, mint } = burnDetection;

        console.log(`   ✅ Burn asset identified: ${ASSET_NAMES[asset_id]}`);
        console.log(`   📄 Mint address: ${mint.toBase58()}`);

        // Step 2 - Fetch burn record from Solana
        const burnRecord = await fetchBurnRecord(burn_nonce);

        if (!burnRecord) {
            console.log('❌ Burn not found on Solana');
            return res.status(404).json({
                error: 'Burn not found on Solana',
                burn_nonce
            });
        }

        console.log(`✅ Burn found on Solana`);
        console.log(`   User: ${burnRecord.user.toBase58()}`);
        console.log(`   Amount: ${burnRecord.amount}`);
        console.log(`   Slot: ${burnRecord.slot}`);

        // Step 3 - Verify user matches
        if (burnRecord.user.toBase58() !== user) {
            console.log('❌ User mismatch');
            return res.status(400).json({
                error: 'User mismatch',
                expected: user,
                actual: burnRecord.user.toBase58()
            });
        }

        // Step 4 - Verify amount matches
        if (burnRecord.amount !== expected_amount) {
            console.log('❌ Amount mismatch');
            return res.status(400).json({
                error: 'Amount mismatch',
                expected: expected_amount,
                actual: burnRecord.amount
            });
        }

        // Step 5 - Check finality (32 slots)
        const currentSlot = await solanaConnection.getSlot('confirmed');
        const slotsSinceBurn = currentSlot - burnRecord.slot;

        if (slotsSinceBurn < FINALITY_SLOTS) {
            console.log(`⏳ Burn not yet finalized (${slotsSinceBurn}/${FINALITY_SLOTS} slots)`);
            return res.status(425).json({
                error: 'Burn not yet finalized',
                slots_since_burn: slotsSinceBurn,
                required_slots: FINALITY_SLOTS,
                retry_after_seconds: Math.ceil((FINALITY_SLOTS - slotsSinceBurn) * 0.4)
            });
        }

        console.log(`✅ Burn finalized (${slotsSinceBurn} slots ago)`);

        // ✅ NEW: Step 6 - Create and sign asset-aware attestation V3
        const message = createAttestationMessageV3(
            asset_id,                  // ✅ NEW: Include asset_id in hash
            burn_nonce,
            burnRecord.user,
            burnRecord.amount,
            validator_set_version
        );

        const signature = nacl.sign.detached(
            message,
            validatorKeypair.secretKey
        );

        // ✅ NEW: Include asset_id in response
        const attestation = {
            asset_id,                                          // ✅ NEW
            asset_name: ASSET_NAMES[asset_id],                 // ✅ NEW (for debugging)
            burn_nonce,
            user: burnRecord.user.toBase58(),
            amount: burnRecord.amount,
            validator_set_version,
            validator_pubkey: validatorKeypair.publicKey.toBase58(),
            signature: Array.from(signature),
            timestamp: Date.now(),
        };

        console.log(`✅ Attestation V3 signed (asset-aware)`);
        console.log(`   Asset: ${ASSET_NAMES[asset_id]} (asset_id=${asset_id})`);
        console.log(`   Version: ${validator_set_version}`);
        console.log(`📤 Returning attestation to user\n`);

        return res.json(attestation);

    } catch (error: any) {
        console.error('❌ Error:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        version: 'v3-asset-aware',
        supported_assets: Object.entries(ASSET_BY_MINT).map(([mint, asset_id]) => ({
            asset: ASSET_NAMES[asset_id],
            asset_id,
            mint
        })),
        validator: validatorKeypair.publicKey.toBase58(),
        solana_rpc: SOLANA_RPC
    });
});

app.listen(PORT, () => {
    console.log(`\n🚀 X1 Validator Attestation Service V3 (Asset-Aware)`);
    console.log(`   Listening on port ${PORT}`);
    console.log(`   Validator: ${validatorKeypair.publicKey.toBase58()}`);
    console.log(`   Solana RPC: ${SOLANA_RPC}`);
    console.log(`\n📋 Supported Assets:`);
    Object.entries(ASSET_BY_MINT).forEach(([mint, asset_id]) => {
        console.log(`   ${ASSET_NAMES[asset_id]} (asset_id=${asset_id}): ${mint}`);
    });
    console.log(`\n✅ Ready to sign asset-aware attestations!\n`);
});
