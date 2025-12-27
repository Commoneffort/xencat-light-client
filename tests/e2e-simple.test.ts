import 'dotenv/config';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    getAccount
} from '@solana/spl-token';
import { expect } from 'chai';
import { generateBurnProof } from '../sdk/proof-generator/src/index';
import bs58 from 'bs58';

console.log(`
╔════════════════════════════════════════╗
║  ⚠️  MAINNET TESTING WARNING ⚠️         ║
║                                        ║
║  This test burns REAL tokens on        ║
║  Solana MAINNET. Use small amounts!    ║
║                                        ║
║  Recommended: 0.01-0.1 XENCAT max      ║
║                                        ║
║  Minting happens on X1 TESTNET (safe)  ║
╚════════════════════════════════════════╝
`);

// ============================================================================
// CONFIGURATION - MAINNET BURN → X1 TESTNET MINT
// ============================================================================

const CONFIG = {
    // SOLANA MAINNET
    SOLANA_RPC: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
    XENCAT_MINT_MAINNET: new PublicKey('7UN8WkBumTUCofVPXCPjNWQ6msQhzrg9tFQRP48Nmw5V'),
    BURN_PROGRAM_MAINNET: new PublicKey('2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp'),

    // X1 TESTNET
    X1_RPC: process.env.X1_RPC || 'https://rpc.testnet.x1.xyz',
    LIGHT_CLIENT_X1: new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5'),
    MINT_PROGRAM_X1: new PublicKey('8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk'),
    XENCAT_MINT_X1: new PublicKey('DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb'),

    // SAFETY LIMITS
    MIN_BURN_AMOUNT: 10_000, // 0.01 XENCAT
    SAFETY_DELAY_MS: 3000,

    // FINALITY
    MIN_CONFIRMATIONS: 32,
    COMMITMENT: 'finalized' as const,
};

describe('🌉 Bridge E2E Test', () => {

    let solanaConnection: Connection;
    let x1Connection: Connection;
    let userKeypair: Keypair;

    before(async () => {
        console.log('\n🔧 Setting up test environment...\n');

        // Load user keypair
        const privateKeyEnv = process.env.USER_PRIVATE_KEY;
        if (!privateKeyEnv) {
            throw new Error('USER_PRIVATE_KEY environment variable required!');
        }

        try {
            const privateKeyArray = JSON.parse(privateKeyEnv);
            userKeypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
        } catch {
            userKeypair = Keypair.fromSecretKey(bs58.decode(privateKeyEnv));
        }

        console.log(`👤 User: ${userKeypair.publicKey.toBase58()}\n`);

        // Solana connection
        solanaConnection = new Connection(CONFIG.SOLANA_RPC, {
            commitment: CONFIG.COMMITMENT,
        });

        // X1 connection
        x1Connection = new Connection(CONFIG.X1_RPC, {
            commitment: 'confirmed',
        });

        console.log(`🌐 Solana MAINNET: ${CONFIG.SOLANA_RPC}`);
        console.log(`🧪 X1 TESTNET: ${CONFIG.X1_RPC}\n`);
    });

    it('🔥 Complete Bridge Flow', async function() {
        this.timeout(120000);

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🚀 COMPLETE BRIDGE TEST');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // ====================================================================
        // STEP 1: CHECK BALANCE
        // ====================================================================

        console.log('1️⃣  Checking Solana MAINNET balance...');

        const solanaTokenAccount = await getAssociatedTokenAddress(
            CONFIG.XENCAT_MINT_MAINNET,
            userKeypair.publicKey
        );

        let solanaBalance;
        try {
            const tokenAccount = await getAccount(solanaConnection, solanaTokenAccount);
            solanaBalance = Number(tokenAccount.amount);
        } catch (error) {
            throw new Error(
                `No XENCAT token account found!\n` +
                `Please fund ${solanaTokenAccount.toBase58()} with XENCAT tokens.`
            );
        }

        console.log(`   💰 Solana Balance: ${solanaBalance / 1_000_000} XENCAT`);

        const burnAmount = CONFIG.MIN_BURN_AMOUNT;

        if (solanaBalance < burnAmount) {
            throw new Error(
                `Insufficient balance! Need ${burnAmount / 1_000_000} XENCAT`
            );
        }

        console.log(`   🔥 Will burn: ${burnAmount / 1_000_000} XENCAT\n`);

        // ====================================================================
        // STEP 2: BURN ON SOLANA
        // ====================================================================

        console.log('2️⃣  Burning on Solana MAINNET...');
        console.log(`   ⚠️  Press Ctrl+C now to cancel...`);

        await new Promise(resolve => setTimeout(resolve, CONFIG.SAFETY_DELAY_MS));

        // Get burn program
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

        // Get PDAs
        const [globalStatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from('global_state')],
            CONFIG.BURN_PROGRAM_MAINNET
        );

        let currentNonce: anchor.BN;
        try {
            const globalState: any = await burnProgram.account.globalState.fetch(globalStatePda);
            currentNonce = globalState.nonceCounter;
        } catch {
            currentNonce = new anchor.BN(0);
        }

        const nextNonce = currentNonce;

        // Burn record PDA uses only the nonce counter
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

        console.log(`   ✅ Burn TX: https://solscan.io/tx/${burnTx}`);

        // ====================================================================
        // STEP 3: WAIT FOR FINALITY
        // ====================================================================

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
        console.log(`   📍 Burn slot: ${burnSlot}`);

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

        // ====================================================================
        // STEP 4: GENERATE PROOF
        // ====================================================================

        console.log('4️⃣  Generating proof...');

        const proof = await generateBurnProof({
            solanaRpc: CONFIG.SOLANA_RPC,
            burnNonce: Number(nextNonce),
            burnProgramId: CONFIG.BURN_PROGRAM_MAINNET.toBase58(),
            userAddress: userKeypair.publicKey.toBase58(),
            validatorCount: 7, // Light client requires minimum 5 validators
            onProgress: (msg) => console.log(`   ${msg}`)
        });

        console.log(`   ✅ Proof generated!`);
        console.log(`   📊 Validators: ${proof.validatorVotes.length}`);
        console.log(`   📊 Signature length: ${proof.validatorVotes[0]?.signature?.length || 'unknown'}`);

        // ====================================================================
        // STEP 5: MINT ON X1
        // ====================================================================

        console.log('\n5️⃣  Minting on X1 TESTNET...');

        const x1Provider = new anchor.AnchorProvider(
            x1Connection,
            new anchor.Wallet(userKeypair),
            { commitment: 'confirmed' }
        );

        // Get X1 PDAs
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

        // Check if token account exists
        let x1AccountExists = false;
        let balanceBefore = 0;
        try {
            const tokenAccount = await getAccount(x1Connection, x1TokenAccount);
            balanceBefore = Number(tokenAccount.amount);
            x1AccountExists = true;
        } catch {
            console.log(`   🔧 Will create X1 token account`);
        }

        // Load mint program IDL and add missing BurnProof type
        const mintIdl = require('../target/idl/xencat_mint_x1.json');
        const lightClientIdl = require('../target/idl/solana_light_client_x1.json');

        // Manually add BurnProof and ValidatorVote types from light client to mint IDL
        if (!mintIdl.types) {
            mintIdl.types = [];
        }

        const burnProofType = lightClientIdl.types.find((t: any) => t.name === 'BurnProof');
        const validatorVoteType = lightClientIdl.types.find((t: any) => t.name === 'ValidatorVote');

        if (burnProofType && !mintIdl.types.find((t: any) => t.name === 'BurnProof')) {
            mintIdl.types.push(burnProofType);
        }
        if (validatorVoteType && !mintIdl.types.find((t: any) => t.name === 'ValidatorVote')) {
            mintIdl.types.push(validatorVoteType);
        }

        const mintProgram = new anchor.Program(mintIdl, CONFIG.MINT_PROGRAM_X1, x1Provider);

        // Get fee receivers from state
        const mintState: any = await mintProgram.account.mintState.fetch(mintStatePda);
        const lightClientState = await x1Connection.getAccountInfo(lightClientStatePda);

        // Parse light client state to get fee receiver (first 32 bytes after discriminator + authority)
        let lightClientFeeReceiver = mintState.feeReceiver; // Fallback

        const preInstructions: TransactionInstruction[] = [];

        if (!x1AccountExists) {
            preInstructions.push(
                createAssociatedTokenAccountInstruction(
                    userKeypair.publicKey,
                    x1TokenAccount,
                    userKeypair.publicKey,
                    CONFIG.XENCAT_MINT_X1
                )
            );
        }

        // Convert proof data - ensure all numbers are BN objects for Anchor
        // and all byte arrays are plain number arrays (not Uint8Array or Buffer)
        const toBN = (val: any): anchor.BN => {
            if (val instanceof anchor.BN) return val;
            if (typeof val === 'bigint') return new anchor.BN(val.toString());
            if (typeof val === 'object' && 'toNumber' in val) return new anchor.BN(val.toNumber());
            return new anchor.BN(val);
        };

        const toByteArray = (val: any): number[] => {
            if (Buffer.isBuffer(val)) return Array.from(val);
            if (val instanceof Uint8Array) return Array.from(val);
            if (Array.isArray(val)) return val;
            return Array.from(new Uint8Array(val));
        };

        const proofData = {
            burnNonce: toBN(proof.burnNonce),
            user: new PublicKey(proof.user),
            amount: toBN(proof.amount),
            burnRecordData: Buffer.from(proof.burnRecordData), // Blob type needs Buffer
            slot: toBN(proof.slot),
            blockHash: Buffer.from(proof.blockHash), // Try Buffer for fixed array
            validatorVotes: proof.validatorVotes.map((v: any) => ({
                validatorIdentity: new PublicKey(v.validatorIdentity),
                stake: toBN(v.stake),
                signature: Buffer.from(v.signature), // Try Buffer for fixed array [u8; 64]
            })),
            merkleProof: proof.merkleProof.map((p: any) => Buffer.from(p)),
            stateRoot: Buffer.from(proof.stateRoot), // Try Buffer for fixed array
        };

        console.log('🔍 Debug - Proof data to send:');
        console.log(`  burnNonce: ${proofData.burnNonce}`);
        console.log(`  validatorVotes count: ${proofData.validatorVotes.length}`);
        console.log(`  validatorVotes[0].signature type: ${Array.isArray(proofData.validatorVotes[0].signature) ? 'array' : typeof proofData.validatorVotes[0].signature}`);
        console.log(`  validatorVotes[0].signature length: ${proofData.validatorVotes[0].signature.length}`);
        console.log(`  merkleProof length: ${proofData.merkleProof.length}`);

        // Call mint
        const mintTx = await mintProgram.methods
            .mintFromBurn(
                toBN(proof.burnNonce),
                proofData
            )
            .accounts({
                mintState: mintStatePda,
                xencatMint: CONFIG.XENCAT_MINT_X1,
                processedBurn: processedBurnPda,
                userTokenAccount: x1TokenAccount,
                user: userKeypair.publicKey,
                mintFeeReceiver: mintState.feeReceiver,
                lightClientProgram: CONFIG.LIGHT_CLIENT_X1,
                lightClientState: lightClientStatePda,
                validatorSet: validatorSetPda,
                lightClientFeeReceiver: lightClientFeeReceiver,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .preInstructions(preInstructions)
            .rpc();

        console.log(`   ✅ Mint TX: https://explorer.x1.xyz/tx/${mintTx}?cluster=testnet`);

        // ====================================================================
        // STEP 6: VERIFY
        // ====================================================================

        console.log('\n6️⃣  Verifying...');

        const tokenAccount = await getAccount(x1Connection, x1TokenAccount);
        const balanceAfter = Number(tokenAccount.amount);
        const minted = balanceAfter - balanceBefore;

        console.log(`   💰 Minted: ${minted / 1_000_000} XENCAT`);

        expect(minted).to.equal(burnAmount);

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🎉 BRIDGE SUCCESS!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    });
});
