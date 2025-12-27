import 'dotenv/config';
import * as anchor from '@coral-xyz/anchor';
import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction
} from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    getAccount
} from '@solana/spl-token';
import { expect } from 'chai';
import { generateBurnProof } from '../sdk/proof-generator/src/index';
import bs58 from 'bs58';
import { serialize } from 'borsh';

console.log(`
╔════════════════════════════════════════╗
║  🚀 RAW TRANSACTION E2E TEST           ║
║                                        ║
║  Burns REAL tokens on Solana MAINNET  ║
║  Mints on X1 TESTNET (safe)            ║
╚════════════════════════════════════════╝
`);

const CONFIG = {
    SOLANA_RPC: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
    XENCAT_MINT_MAINNET: new PublicKey('7UN8WkBumTUCofVPXCPjNWQ6msQhzrg9tFQRP48Nmw5V'),
    BURN_PROGRAM_MAINNET: new PublicKey('2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp'),
    X1_RPC: process.env.X1_RPC || 'https://rpc.testnet.x1.xyz',
    LIGHT_CLIENT_X1: new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5'),
    MINT_PROGRAM_X1: new PublicKey('8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk'),
    XENCAT_MINT_X1: new PublicKey('DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb'),
    MIN_BURN_AMOUNT: 10_000,
    SAFETY_DELAY_MS: 3000,
    MIN_CONFIRMATIONS: 32,
    COMMITMENT: 'finalized' as const,
};

// Borsh schema for BurnProof
class ValidatorVote {
    validatorIdentity: Uint8Array;
    stake: bigint;
    signature: Uint8Array;

    constructor(props: { validatorIdentity: Uint8Array; stake: bigint; signature: Uint8Array }) {
        this.validatorIdentity = props.validatorIdentity;
        this.stake = props.stake;
        this.signature = props.signature;
    }
}

class BurnProof {
    burnNonce: bigint;
    user: Uint8Array;
    amount: bigint;
    burnRecordData: Uint8Array;
    slot: bigint;
    blockHash: Uint8Array;
    validatorVotes: ValidatorVote[];
    merkleProof: Uint8Array[]; // SECURITY CRITICAL: Merkle proof
    stateRoot: Uint8Array;

    constructor(props: any) {
        this.burnNonce = props.burnNonce;
        this.user = props.user;
        this.amount = props.amount;
        this.burnRecordData = props.burnRecordData;
        this.slot = props.slot;
        this.blockHash = props.blockHash;
        this.validatorVotes = props.validatorVotes;
        this.merkleProof = props.merkleProof;
        this.stateRoot = props.stateRoot;
    }
}

const validatorVoteSchema = new Map([
    [ValidatorVote, {
        kind: 'struct',
        fields: [
            ['validatorIdentity', [32]],
            ['stake', 'u64'],
            ['signature', [64]],
        ]
    }]
]);

const burnProofSchema = new Map<any, any>([
    [BurnProof, {
        kind: 'struct',
        fields: [
            ['burnNonce', 'u64'],
            ['user', [32]],
            ['amount', 'u64'],
            ['burnRecordData', ['u8']],
            ['slot', 'u64'],
            ['blockHash', [32]],
            ['validatorVotes', [ValidatorVote]],
            ['merkleProof', [[32]]], // SECURITY CRITICAL
            ['stateRoot', [32]],
        ]
    }],
    ...validatorVoteSchema
]);

describe('🌉 Raw Transaction Bridge Test', () => {
    let solanaConnection: Connection;
    let x1Connection: Connection;
    let userKeypair: Keypair;

    before(async () => {
        console.log('\n🔧 Setting up...\n');

        const privateKeyEnv = process.env.USER_PRIVATE_KEY;
        if (!privateKeyEnv) {
            throw new Error('USER_PRIVATE_KEY required!');
        }

        try {
            const privateKeyArray = JSON.parse(privateKeyEnv);
            userKeypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
        } catch {
            userKeypair = Keypair.fromSecretKey(bs58.decode(privateKeyEnv));
        }

        console.log(`👤 User: ${userKeypair.publicKey.toBase58()}\n`);

        solanaConnection = new Connection(CONFIG.SOLANA_RPC, {
            commitment: CONFIG.COMMITMENT,
        });

        x1Connection = new Connection(CONFIG.X1_RPC, {
            commitment: 'confirmed',
        });

        console.log(`🌐 Solana: ${CONFIG.SOLANA_RPC}`);
        console.log(`🧪 X1: ${CONFIG.X1_RPC}\n`);
    });

    it('🔥 Complete Bridge with Raw Transaction', async function() {
        this.timeout(120000);

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🚀 STARTING BRIDGE TEST');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // ================================================================
        // STEP 1: CHECK BALANCE & BURN
        // ================================================================

        console.log('1️⃣  Checking balance...');

        const solanaTokenAccount = await getAssociatedTokenAddress(
            CONFIG.XENCAT_MINT_MAINNET,
            userKeypair.publicKey
        );

        let solanaBalance;
        try {
            const tokenAccount = await getAccount(solanaConnection, solanaTokenAccount);
            solanaBalance = Number(tokenAccount.amount);
        } catch (error) {
            throw new Error(`No XENCAT token account found!`);
        }

        console.log(`   💰 Balance: ${solanaBalance / 1_000_000} XENCAT`);

        const burnAmount = CONFIG.MIN_BURN_AMOUNT;

        if (solanaBalance < burnAmount) {
            throw new Error(`Insufficient balance!`);
        }

        console.log(`   🔥 Will burn: ${burnAmount / 1_000_000} XENCAT\n`);

        // ================================================================
        // STEP 2: BURN
        // ================================================================

        console.log('2️⃣  Burning on Solana...');
        console.log(`   ⚠️  Press Ctrl+C to cancel...`);

        await new Promise(resolve => setTimeout(resolve, CONFIG.SAFETY_DELAY_MS));

        const burnProgramIdl = {
            version: "0.1.0",
            name: "xencat_burn",
            instructions: [{
                name: "burnXencat",
                accounts: [
                    { name: "user", isMut: true, isSigner: true },
                    { name: "globalState", isMut: true, isSigner: false },
                    { name: "burnRecord", isMut: true, isSigner: false },
                    { name: "xencatMint", isMut: true, isSigner: false },
                    { name: "userTokenAccount", isMut: true, isSigner: false },
                    { name: "tokenProgram", isMut: false, isSigner: false },
                    { name: "systemProgram", isMut: false, isSigner: false },
                ],
                args: [{ name: "amount", type: "u64" }]
            }],
            accounts: [{
                name: "GlobalState",
                type: {
                    kind: "struct",
                    fields: [
                        { name: "nonceCounter", type: "u64" },
                        { name: "totalBurns", type: "u64" },
                        { name: "totalAmountBurned", type: "u64" },
                        { name: "bump", type: "u8" }
                    ]
                }
            }]
        };

        const provider = new anchor.AnchorProvider(
            solanaConnection,
            new anchor.Wallet(userKeypair),
            { commitment: CONFIG.COMMITMENT }
        );

        const burnProgram = new anchor.Program(
            burnProgramIdl as any,
            CONFIG.BURN_PROGRAM_MAINNET,
            provider
        );

        const [globalStatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from('global_state')],
            CONFIG.BURN_PROGRAM_MAINNET
        );

        let currentNonce: anchor.BN;
        try {
            const globalState = await burnProgram.account.globalState.fetch(globalStatePda) as any;
            currentNonce = globalState.nonceCounter;
        } catch {
            currentNonce = new anchor.BN(0);
        }

        const nextNonce = currentNonce;

        const [burnRecordPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('burn_record'),
                currentNonce.toArrayLike(Buffer, 'le', 8)
            ],
            CONFIG.BURN_PROGRAM_MAINNET
        );

        console.log(`   📝 Nonce: ${nextNonce.toString()}`);

        const burnTx = await burnProgram.methods
            .burnXencat(new anchor.BN(burnAmount))
            .accounts({
                user: userKeypair.publicKey,
                globalState: globalStatePda,
                burnRecord: burnRecordPda,
                xencatMint: CONFIG.XENCAT_MINT_MAINNET,
                userTokenAccount: solanaTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        console.log(`   ✅ TX: https://solscan.io/tx/${burnTx}`);

        // ================================================================
        // STEP 3: WAIT FOR FINALITY
        // ================================================================

        console.log('\n3️⃣  Waiting for finality...');

        const confirmation = await solanaConnection.confirmTransaction(
            burnTx,
            CONFIG.COMMITMENT
        );

        if (confirmation.value.err) {
            throw new Error(`Burn failed: ${confirmation.value.err}`);
        }

        const txDetails = await solanaConnection.getTransaction(burnTx, {
            commitment: CONFIG.COMMITMENT,
            maxSupportedTransactionVersion: 0
        });

        const burnSlot = txDetails!.slot;
        console.log(`   📍 Slot: ${burnSlot}`);

        let currentSlot = await solanaConnection.getSlot(CONFIG.COMMITMENT);
        let confirmations = currentSlot - burnSlot;

        if (confirmations < CONFIG.MIN_CONFIRMATIONS) {
            console.log(`   ⏳ Waiting for ${CONFIG.MIN_CONFIRMATIONS} confirmations...`);
            while (confirmations < CONFIG.MIN_CONFIRMATIONS) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                currentSlot = await solanaConnection.getSlot(CONFIG.COMMITMENT);
                confirmations = currentSlot - burnSlot;
            }
        }

        console.log(`   ✅ Finalized with ${confirmations}+ confirmations!\n`);

        // ================================================================
        // STEP 4: GENERATE PROOF
        // ================================================================

        console.log('4️⃣  Generating proof...');

        const proof = await generateBurnProof({
            solanaRpc: CONFIG.SOLANA_RPC,
            burnNonce: nextNonce.toNumber(),
            burnProgramId: CONFIG.BURN_PROGRAM_MAINNET.toBase58(),
            userAddress: userKeypair.publicKey.toBase58(),
            validatorCount: 3, // Minimum needed that fits in transaction
            onProgress: (msg) => console.log(`   ${msg}`)
        });

        console.log(`   ✅ Proof generated!`);
        console.log(`   📊 Validators: ${proof.validatorVotes.length}\n`);

        // ================================================================
        // STEP 5: MINT WITH RAW TRANSACTION
        // ================================================================

        console.log('5️⃣  Minting on X1 with raw transaction...');

        // Get PDAs
        const [lightClientStatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from('light_client_state')],
            CONFIG.LIGHT_CLIENT_X1
        );

        const [validatorSetPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('validator_set')],
            CONFIG.LIGHT_CLIENT_X1
        );

        const [mintStatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from('mint_state')],
            CONFIG.MINT_PROGRAM_X1
        );

        const [processedBurnPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('processed_burn'),
                nextNonce.toArrayLike(Buffer, 'le', 8)
            ],
            CONFIG.MINT_PROGRAM_X1
        );

        const x1TokenAccount = await getAssociatedTokenAddress(
            CONFIG.XENCAT_MINT_X1,
            userKeypair.publicKey
        );

        // Check if account exists
        let balanceBefore = 0;
        let accountExists = false;
        try {
            const tokenAccount = await getAccount(x1Connection, x1TokenAccount);
            balanceBefore = Number(tokenAccount.amount);
            accountExists = true;
        } catch {
            console.log(`   🔧 Creating X1 token account...`);
        }

        // Fetch mint state manually (no Anchor)
        const mintStateAccount = await x1Connection.getAccountInfo(mintStatePda);
        if (!mintStateAccount) {
            throw new Error('Mint state not found');
        }

        // Parse MintState manually (skip 8-byte discriminator)
        // MintState: authority (32) + xencat_mint (32) + fee_receiver (32) + mint_fee (8) + ...
        const mintStateData = mintStateAccount.data;
        let offset = 8; // Skip discriminator

        // Skip authority (32 bytes)
        offset += 32;
        // Skip xencat_mint (32 bytes)
        offset += 32;
        // Read fee_receiver (32 bytes)
        const feeReceiverBytes = mintStateData.slice(offset, offset + 32);
        const feeReceiver = new PublicKey(feeReceiverBytes);

        // Prepare proof for Borsh serialization
        const proofForBorsh = new BurnProof({
            burnNonce: BigInt(proof.burnNonce.toString()),
            user: new Uint8Array(new PublicKey(proof.user).toBytes()),
            amount: BigInt(proof.amount.toString()),
            burnRecordData: new Uint8Array(proof.burnRecordData),
            slot: BigInt(proof.slot.toString()),
            blockHash: new Uint8Array(proof.blockHash),
            validatorVotes: proof.validatorVotes.map((v: any) => new ValidatorVote({
                validatorIdentity: new Uint8Array(new PublicKey(v.validatorIdentity).toBytes()),
                stake: BigInt(v.stake.toString()),
                signature: new Uint8Array(v.signature),
            })),
            merkleProof: proof.merkleProof.map((p: any) => new Uint8Array(p)),
            stateRoot: new Uint8Array(proof.stateRoot),
        });

        console.log(`   🔐 Serializing proof with Borsh...`);

        // Serialize proof
        const proofBytes = serialize(burnProofSchema, proofForBorsh);

        console.log(`   📏 Proof size: ${proofBytes.length} bytes`);
        console.log(`   📏 Validator votes: ${proofForBorsh.validatorVotes.length}`);

        // Get instruction discriminator for mintFromBurn
        const discriminator = Buffer.from([247, 143, 234, 37, 166, 243, 159, 152]); // SHA256("global:mint_from_burn")[0..8]

        // Prepare instruction data: discriminator + burn_nonce + proof
        const nonceBytes = Buffer.alloc(8);
        nonceBytes.writeBigUInt64LE(BigInt(nextNonce.toString()));

        const instructionData = Buffer.concat([
            discriminator,
            nonceBytes,
            Buffer.from(proofBytes)
        ]);

        // Build transaction
        const transaction = new Transaction();

        // IMPORTANT: Request more compute units for Ed25519 signature verification
        // Ed25519-dalek verification is VERY expensive: ~250,000 CU per signature!
        // With 3 validators: 3 × 250,000 = 750,000 CU just for signatures
        // Plus Merkle verification and other logic = need ~1.2M CU total
        const {ComputeBudgetProgram} = await import('@solana/web3.js');
        transaction.add(
            ComputeBudgetProgram.setComputeUnitLimit({
                units: 1_400_000 // Request max 1.4M compute units
            })
        );

        // Create token account if needed (in separate transaction to reduce size)
        if (!accountExists) {
            console.log(`   📝 Creating token account in separate transaction...`);
            const createAccountTx = new Transaction().add(
                createAssociatedTokenAccountInstruction(
                    userKeypair.publicKey,
                    x1TokenAccount,
                    userKeypair.publicKey,
                    CONFIG.XENCAT_MINT_X1
                )
            );
            await sendAndConfirmTransaction(
                x1Connection,
                createAccountTx,
                [userKeypair],
                { commitment: 'confirmed' }
            );
            console.log(`   ✅ Token account created`);
            accountExists = true;
        }

        // Add mint instruction
        const mintInstruction = new TransactionInstruction({
            keys: [
                { pubkey: mintStatePda, isSigner: false, isWritable: true },
                { pubkey: CONFIG.XENCAT_MINT_X1, isSigner: false, isWritable: true },
                { pubkey: processedBurnPda, isSigner: false, isWritable: true },
                { pubkey: x1TokenAccount, isSigner: false, isWritable: true },
                { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true },
                { pubkey: feeReceiver, isSigner: false, isWritable: true },
                { pubkey: CONFIG.LIGHT_CLIENT_X1, isSigner: false, isWritable: false },
                { pubkey: lightClientStatePda, isSigner: false, isWritable: false },
                { pubkey: validatorSetPda, isSigner: false, isWritable: false },
                { pubkey: feeReceiver, isSigner: false, isWritable: true }, // lightClientFeeReceiver
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: CONFIG.MINT_PROGRAM_X1,
            data: instructionData,
        });

        transaction.add(mintInstruction);

        console.log(`   📤 Sending transaction...`);

        const signature = await sendAndConfirmTransaction(
            x1Connection,
            transaction,
            [userKeypair],
            { commitment: 'confirmed' }
        );

        console.log(`   ✅ TX: https://explorer.x1.xyz/tx/${signature}?cluster=testnet`);

        // ================================================================
        // STEP 6: VERIFY
        // ================================================================

        console.log('\n6️⃣  Verifying...');

        const tokenAccount = await getAccount(x1Connection, x1TokenAccount);
        const balanceAfter = Number(tokenAccount.amount);
        const minted = balanceAfter - balanceBefore;

        console.log(`   💰 Minted: ${minted / 1_000_000} XENCAT`);

        expect(minted).to.equal(burnAmount);

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🎉 COMPLETE BRIDGE SUCCESS!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    });
});
