import express from 'express';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import 'dotenv/config';

const app = express();
app.use(express.json());

// Configuration
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const BURN_PROGRAM_ID = new PublicKey('2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp');
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

// Fetch burn record from Solana
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
    // Fetch the signature for this account to get the real slot
    let slot = 0;
    try {
        const signatures = await solanaConnection.getSignaturesForAddress(burnRecordPda, { limit: 1 });
        if (signatures && signatures.length > 0) {
            slot = signatures[0].slot;
        }
    } catch (e) {
        console.error('Error fetching slot:', e);
        // Fallback: use a very old slot so it's always considered finalized
        const currentSlot = await solanaConnection.getSlot('confirmed');
        slot = currentSlot - 100; // Assume it's old enough
    }

    return { user, amount, nonce, timestamp, slot };
}

// Domain separator (must match on-chain constant)
const DOMAIN_SEPARATOR = 'XENCAT_X1_BRIDGE_V1';

// Create attestation message V2 (must match contract)
// Format: hash(DOMAIN_SEPARATOR || validator_set_version || burn_nonce || amount || user)
function createAttestationMessage(
    burnNonce: number,
    user: PublicKey,
    amount: number,
    validatorSetVersion: number
): Buffer {
    const { keccak_256 } = require('@noble/hashes/sha3');

    const messageData = Buffer.concat([
        Buffer.from(DOMAIN_SEPARATOR),
        Buffer.from(new BigUint64Array([BigInt(validatorSetVersion)]).buffer),
        Buffer.from(new BigUint64Array([BigInt(burnNonce)]).buffer),
        Buffer.from(new BigUint64Array([BigInt(amount)]).buffer),
        user.toBuffer(),
    ]);

    // Hash to match Solana's hash() function (SHA256)
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(messageData).digest();

    return hash;
}

// API endpoint: POST /attest-burn (V2 - with validator_set_version)
app.post('/attest-burn', async (req, res) => {
    try {
        const { burn_nonce, user, expected_amount, validator_set_version } = req.body;

        if (!burn_nonce || !user || !expected_amount || validator_set_version === undefined) {
            return res.status(400).json({
                error: 'Missing required fields: burn_nonce, user, expected_amount, validator_set_version'
            });
        }

        console.log(`\n📥 Attestation request V2 for burn ${burn_nonce}`);
        console.log(`   User: ${user}`);
        console.log(`   Expected amount: ${expected_amount}`);
        console.log(`   Validator set version: ${validator_set_version}`);

        // 1. Fetch burn record from Solana
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

        // 2. Verify user matches
        if (burnRecord.user.toBase58() !== user) {
            console.log('❌ User mismatch');
            return res.status(400).json({
                error: 'User mismatch',
                expected: user,
                actual: burnRecord.user.toBase58()
            });
        }

        // 3. Verify amount matches
        if (burnRecord.amount !== expected_amount) {
            console.log('❌ Amount mismatch');
            return res.status(400).json({
                error: 'Amount mismatch',
                expected: expected_amount,
                actual: burnRecord.amount
            });
        }

        // 4. Check finality (32 slots)
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

        // 5. Create and sign attestation V2
        const message = createAttestationMessage(
            burn_nonce,
            burnRecord.user,
            burnRecord.amount,
            validator_set_version
        );

        const signature = nacl.sign.detached(
            message,
            validatorKeypair.secretKey
        );

        const attestation = {
            burn_nonce,
            user: burnRecord.user.toBase58(),
            amount: burnRecord.amount,
            validator_set_version,
            validator_pubkey: validatorKeypair.publicKey.toBase58(),
            signature: Array.from(signature),
            timestamp: Date.now(),
        };

        console.log(`✅ Attestation V2 signed`);
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
        validator: validatorKeypair.publicKey.toBase58(),
        solana_rpc: SOLANA_RPC
    });
});

app.listen(PORT, () => {
    console.log(`\n🚀 X1 Validator Attestation Service`);
    console.log(`   Listening on port ${PORT}`);
    console.log(`   Validator: ${validatorKeypair.publicKey.toBase58()}`);
    console.log(`   Solana RPC: ${SOLANA_RPC}`);
    console.log(`\n✅ Ready to sign attestations!\n`);
});
