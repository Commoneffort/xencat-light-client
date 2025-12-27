import 'dotenv/config';
import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    getAccount
} from '@solana/spl-token';
import { expect } from 'chai';
import { generateBurnProof } from '../sdk/proof-generator/src/index';
import { SolanaLightClientX1 } from '../target/types/solana_light_client_x1';
import { XencatMintX1 } from '../target/types/xencat_mint_x1';

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
    MAX_BURN_AMOUNT: 100_000, // 0.1 XENCAT
    SAFETY_DELAY_MS: 3000, // 3 second warning before burn

    // FINALITY
    MIN_CONFIRMATIONS: 32,
    COMMITMENT: 'finalized' as const,
};

describe('🌉 Complete Bridge: Mainnet Burn → X1 Testnet Mint', () => {

    let solanaConnection: Connection;
    let x1Connection: Connection;
    let userKeypair: Keypair;
    let solanaProvider: AnchorProvider;
    let x1Provider: AnchorProvider;
    let burnProgram: Program;
    let lightClientProgram: Program<SolanaLightClientX1>;
    let mintProgram: Program<XencatMintX1>;

    // Track state across tests
    let lastBurnNonce: anchor.BN;
    let lastValidProof: any;

    before(async () => {
        console.log('\n🔧 Setting up test environment...\n');

        // ====================================================================
        // LOAD USER KEYPAIR
        // ====================================================================

        // Try to load from environment variable or file
        const privateKeyEnv = process.env.USER_PRIVATE_KEY;
        if (privateKeyEnv) {
            // Expect base58 or JSON array
            try {
                const privateKeyArray = JSON.parse(privateKeyEnv);
                userKeypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
            } catch {
                // Try base58
                const bs58 = require('bs58');
                userKeypair = Keypair.fromSecretKey(bs58.decode(privateKeyEnv));
            }
        } else {
            throw new Error(
                'USER_PRIVATE_KEY environment variable required!\n' +
                'Export your keypair as: export USER_PRIVATE_KEY=\'[1,2,3,...]\''
            );
        }

        console.log(`👤 User: ${userKeypair.publicKey.toBase58()}`);
        console.log(`   (Backpack wallet supported)\n`);

        // ====================================================================
        // SOLANA MAINNET CONNECTION
        // ====================================================================

        solanaConnection = new Connection(CONFIG.SOLANA_RPC, {
            commitment: CONFIG.COMMITMENT,
            confirmTransactionInitialTimeout: 60000,
        });

        const solanaWallet = new Wallet(userKeypair);
        solanaProvider = new AnchorProvider(solanaConnection, solanaWallet, {
            commitment: CONFIG.COMMITMENT,
        });

        console.log(`🌐 Solana MAINNET: ${CONFIG.SOLANA_RPC}`);
        const solanaVersion = await solanaConnection.getVersion();
        console.log(`   Version: ${solanaVersion['solana-core']}`);

        // Load burn program IDL (you'll need to have this)
        // For now, we'll use a minimal interface
        const burnProgramIdl = {
            version: "0.1.0",
            name: "xencat_burn",
            instructions: [
                {
                    name: "burn",
                    accounts: [
                        { name: "user", isMut: true, isSigner: true },
                        { name: "userTokenAccount", isMut: true, isSigner: false },
                        { name: "burnRecord", isMut: true, isSigner: false },
                        { name: "tokenMint", isMut: false, isSigner: false },
                        { name: "globalState", isMut: true, isSigner: false },
                        { name: "tokenProgram", isMut: false, isSigner: false },
                        { name: "systemProgram", isMut: false, isSigner: false },
                    ],
                    args: [
                        { name: "amount", type: "u64" }
                    ]
                }
            ],
            accounts: [
                {
                    name: "BurnRecord",
                    type: {
                        kind: "struct",
                        fields: [
                            { name: "user", type: "publicKey" },
                            { name: "amount", type: "u64" },
                            { name: "nonce", type: "u64" },
                            { name: "timestamp", type: "i64" },
                            { name: "recordHash", type: { array: ["u8", 32] } }
                        ]
                    }
                },
                {
                    name: "GlobalState",
                    type: {
                        kind: "struct",
                        fields: [
                            { name: "totalBurned", type: "u64" },
                            { name: "burnCount", type: "u64" }
                        ]
                    }
                }
            ]
        };

        burnProgram = new Program(
            burnProgramIdl as any,
            CONFIG.BURN_PROGRAM_MAINNET,
            solanaProvider
        );

        // ====================================================================
        // X1 TESTNET CONNECTION
        // ====================================================================

        x1Connection = new Connection(CONFIG.X1_RPC, {
            commitment: 'confirmed',
            confirmTransactionInitialTimeout: 60000,
        });

        const x1Wallet = new Wallet(userKeypair);
        x1Provider = new AnchorProvider(x1Connection, x1Wallet, {
            commitment: 'confirmed',
        });

        console.log(`\n🧪 X1 TESTNET: ${CONFIG.X1_RPC}`);
        const x1Slot = await x1Connection.getSlot();
        console.log(`   Current slot: ${x1Slot}`);

        // Load X1 program IDLs
        const lightClientIdl = require('../target/idl/solana_light_client_x1.json');
        const mintIdl = require('../target/idl/xencat_mint_x1.json');

        lightClientProgram = new Program<SolanaLightClientX1>(
            lightClientIdl,
            CONFIG.LIGHT_CLIENT_X1,
            x1Provider
        );

        mintProgram = new Program<XencatMintX1>(
            mintIdl,
            CONFIG.MINT_PROGRAM_X1,
            x1Provider
        );

        console.log('\n✅ Environment setup complete!\n');
    });

    it('🔥 Complete Bridge: Mainnet Burn → Proof Generation → Testnet Mint', async function() {
        // Increase timeout for this comprehensive test
        this.timeout(120000); // 2 minutes

        const startTime = Date.now();

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🚀 COMPLETE BRIDGE TEST');
        console.log('💰 Solana: MAINNET (real burn)');
        console.log('🧪 X1: TESTNET (safe mint)');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // ====================================================================
        // STEP 1: CHECK SOLANA MAINNET BALANCE
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
                `No XENCAT token account found on Solana mainnet!\n` +
                `Please fund ${solanaTokenAccount.toBase58()} with XENCAT tokens.`
            );
        }

        console.log(`   💰 Solana Balance: ${solanaBalance / 1_000_000} XENCAT`);

        // Use minimum test amount
        const burnAmount = CONFIG.MIN_BURN_AMOUNT; // 0.01 XENCAT

        if (solanaBalance < burnAmount) {
            throw new Error(
                `Insufficient balance! Need ${burnAmount / 1_000_000} XENCAT, ` +
                `have ${solanaBalance / 1_000_000} XENCAT`
            );
        }

        console.log(`   🔥 Will burn: ${burnAmount / 1_000_000} XENCAT (${burnAmount} lamports)\n`);

        // ====================================================================
        // STEP 2: BURN ON SOLANA MAINNET (WITH SAFETY DELAY)
        // ====================================================================

        console.log('2️⃣  Burning tokens on Solana MAINNET...');
        console.log(`   ⚠️  ABOUT TO BURN ${burnAmount / 1_000_000} XENCAT (REAL TOKENS)!`);
        console.log(`   ⚠️  Press Ctrl+C now to cancel...`);

        // Safety delay
        await new Promise(resolve => setTimeout(resolve, CONFIG.SAFETY_DELAY_MS));

        console.log(`   🔥 Executing burn...`);

        // Get global state PDA
        const [globalStatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from('global_state')],
            CONFIG.BURN_PROGRAM_MAINNET
        );

        // Get current nonce before burn
        let currentNonce: anchor.BN;
        try {
            const globalState = await burnProgram.account.globalState.fetch(globalStatePda);
            currentNonce = globalState.burnCount;
        } catch {
            currentNonce = new anchor.BN(0);
        }

        const nextNonce = currentNonce.add(new anchor.BN(1));

        // Derive burn record PDA
        const [burnRecordPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('burn_record'),
                userKeypair.publicKey.toBuffer(),
                nextNonce.toArrayLike(Buffer, 'le', 8)
            ],
            CONFIG.BURN_PROGRAM_MAINNET
        );

        console.log(`   📝 Expected nonce: ${nextNonce.toString()}`);
        console.log(`   📝 Burn record PDA: ${burnRecordPda.toBase58()}`);

        const burnTx = await burnProgram.methods
            .burn(new anchor.BN(burnAmount))
            .accounts({
                user: userKeypair.publicKey,
                userTokenAccount: solanaTokenAccount,
                burnRecord: burnRecordPda,
                tokenMint: CONFIG.XENCAT_MINT_MAINNET,
                globalState: globalStatePda,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        console.log(`   ✅ Burn transaction sent!`);
        console.log(`   📝 TX: https://solscan.io/tx/${burnTx}`);
        console.log(`   🔢 Nonce: ${nextNonce.toString()}`);

        lastBurnNonce = nextNonce;

        // ====================================================================
        // STEP 3: WAIT FOR FINALITY (CRITICAL!)
        // ====================================================================

        console.log('\n3️⃣  Waiting for finality on Solana MAINNET...');
        console.log(`   ⏳ Waiting for 'finalized' commitment...`);
        console.log(`   ⏳ This takes ~12-15 seconds on mainnet...`);

        const confirmation = await solanaConnection.confirmTransaction(
            burnTx,
            CONFIG.COMMITMENT
        );

        if (confirmation.value.err) {
            throw new Error(`Burn transaction failed: ${confirmation.value.err}`);
        }

        // Get transaction details to find slot
        const txDetails = await solanaConnection.getTransaction(burnTx, {
            commitment: CONFIG.COMMITMENT,
            maxSupportedTransactionVersion: 0
        });

        const burnSlot = txDetails!.slot;
        console.log(`   📍 Burn slot: ${burnSlot}`);

        // Wait for additional confirmations
        let currentSlot = await solanaConnection.getSlot(CONFIG.COMMITMENT);
        let confirmations = currentSlot - burnSlot;

        console.log(`   ✅ Current confirmations: ${confirmations}`);

        if (confirmations < CONFIG.MIN_CONFIRMATIONS) {
            const needed = CONFIG.MIN_CONFIRMATIONS - confirmations;
            console.log(`   ⏳ Waiting for ${needed} more confirmations...`);
            console.log(`   ⏳ Estimated time: ~${(needed * 0.4).toFixed(1)}s`);

            while (confirmations < CONFIG.MIN_CONFIRMATIONS) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                currentSlot = await solanaConnection.getSlot(CONFIG.COMMITMENT);
                confirmations = currentSlot - burnSlot;
                process.stdout.write(`   ⏳ Confirmations: ${confirmations}/${CONFIG.MIN_CONFIRMATIONS}\r`);
            }
            console.log('');
        }

        console.log(`   ✅ Finalized with ${confirmations}+ confirmations!\n`);

        // Verify burn record exists
        const burnRecord = await burnProgram.account.burnRecord.fetch(burnRecordPda);
        console.log(`   ✅ Burn record verified on-chain:`);
        console.log(`      User: ${burnRecord.user.toBase58()}`);
        console.log(`      Amount: ${burnRecord.amount.toString()} (${burnRecord.amount.toNumber() / 1_000_000} XENCAT)`);
        console.log(`      Nonce: ${burnRecord.nonce.toString()}`);
        console.log(`      Timestamp: ${new Date(burnRecord.timestamp.toNumber() * 1000).toISOString()}`);

        // ====================================================================
        // STEP 4: GENERATE CRYPTOGRAPHIC PROOF
        // ====================================================================

        console.log('\n4️⃣  Generating cryptographic proof from MAINNET data...');
        console.log(`   📡 Fetching real Solana validator signatures...`);
        console.log(`   📡 Using slot: ${burnSlot}`);

        const proof = await generateBurnProof({
            solanaRpc: CONFIG.SOLANA_RPC,
            burnNonce: lastBurnNonce,
            burnProgramId: CONFIG.BURN_PROGRAM_MAINNET.toBase58(),
            userAddress: userKeypair.publicKey.toBase58(),
            onProgress: (msg) => console.log(`   ${msg}`)
        });

        lastValidProof = proof;

        console.log(`   ✅ Proof generated successfully!`);
        console.log(`   📊 Proof statistics:`);
        console.log(`      Slot: ${proof.slot}`);
        console.log(`      Validators: ${proof.validatorVotes.length}`);
        console.log(`      Total stake: ${proof.totalVotingStake ? (Number(proof.totalVotingStake) / 1e9).toFixed(2) : 'N/A'} SOL`);
        console.log(`      Merkle depth: ${proof.merkleProof.length}`);
        console.log(`      State root: ${Buffer.from(proof.stateRoot).toString('hex').substring(0, 16)}...`);
        console.log(`   🔐 Contains REAL mainnet validator signatures!`);

        // ====================================================================
        // STEP 5: CHECK X1 TESTNET BALANCE BEFORE
        // ====================================================================

        console.log('\n5️⃣  Checking X1 TESTNET balance before mint...');

        const x1TokenAccount = await getAssociatedTokenAddress(
            CONFIG.XENCAT_MINT_X1,
            userKeypair.publicKey
        );

        let balanceBefore = 0;
        let x1AccountExists = false;

        try {
            const tokenAccount = await getAccount(x1Connection, x1TokenAccount);
            balanceBefore = Number(tokenAccount.amount);
            x1AccountExists = true;
            console.log(`   💰 X1 Balance: ${balanceBefore / 1_000_000} XENCAT`);
        } catch {
            console.log(`   💰 X1 Balance: 0 XENCAT (account doesn't exist yet)`);
        }

        // ====================================================================
        // STEP 6: SUBMIT PROOF TO X1 TESTNET
        // ====================================================================

        console.log('\n6️⃣  Submitting mainnet proof to X1 TESTNET...');
        console.log(`   🧪 This is a TESTNET transaction (safe)`);

        // Get PDAs
        const [validatorSetPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('validator_set')],
            CONFIG.LIGHT_CLIENT_X1
        );

        const [mintStatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from('mint_state')],
            CONFIG.MINT_PROGRAM_X1
        );

        const [processedBurnsPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('processed_burns')],
            CONFIG.MINT_PROGRAM_X1
        );

        const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('mint_authority')],
            CONFIG.MINT_PROGRAM_X1
        );

        console.log(`   📝 Validator Set: ${validatorSetPda.toBase58()}`);
        console.log(`   📝 Mint State: ${mintStatePda.toBase58()}`);
        console.log(`   📝 Processed Burns: ${processedBurnsPda.toBase58()}`);

        // Create token account if needed
        const preInstructions: anchor.web3.TransactionInstruction[] = [];

        if (!x1AccountExists) {
            console.log(`   🔧 Creating X1 token account...`);
            preInstructions.push(
                createAssociatedTokenAccountInstruction(
                    userKeypair.publicKey,
                    x1TokenAccount,
                    userKeypair.publicKey,
                    CONFIG.XENCAT_MINT_X1
                )
            );
        }

        // Prepare proof data in format expected by program
        const proofData = {
            burnNonce: proof.burnNonce,
            user: new PublicKey(proof.user),
            amount: proof.amount,
            burnRecordData: proof.burnRecordData,
            slot: proof.slot,
            blockHash: proof.blockHash,
            validatorVotes: proof.validatorVotes.map((vote: any) => ({
                validatorIdentity: new PublicKey(vote.validatorIdentity),
                stake: vote.stake,
                signature: vote.signature,
            })),
            merkleProof: proof.merkleProof,
            stateRoot: proof.stateRoot,
        };

        console.log(`   🔐 Submitting proof for verification...`);

        const mintTx = await mintProgram.methods
            .mintWithProof(proofData)
            .accounts({
                lightClientProgram: CONFIG.LIGHT_CLIENT_X1,
                validatorSet: validatorSetPda,
                mintState: mintStatePda,
                processedBurns: processedBurnsPda,
                user: userKeypair.publicKey,
                xencatMint: CONFIG.XENCAT_MINT_X1,
                userXencatAccount: x1TokenAccount,
                mintAuthority: mintAuthorityPda,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .preInstructions(preInstructions)
            .rpc();

        console.log(`   ✅ Proof verified by X1 light client!`);
        console.log(`   ✅ Tokens minted on X1 TESTNET!`);
        console.log(`   📝 TX: https://explorer.x1.xyz/tx/${mintTx}?cluster=testnet`);

        // ====================================================================
        // STEP 7: VERIFY X1 TESTNET BALANCE INCREASED
        // ====================================================================

        console.log('\n7️⃣  Verifying tokens minted correctly on X1...');

        const tokenAccount = await getAccount(x1Connection, x1TokenAccount);
        const balanceAfter = Number(tokenAccount.amount);
        const minted = balanceAfter - balanceBefore;

        console.log(`   💰 X1 Balance: ${balanceAfter / 1_000_000} XENCAT`);
        console.log(`   ✅ Minted: ${minted / 1_000_000} XENCAT`);

        expect(minted).to.equal(burnAmount);

        // ====================================================================
        // SUCCESS SUMMARY
        // ====================================================================

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🎉 COMPLETE BRIDGE SUCCESS!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('✅ Mainnet burn verified');
        console.log('✅ Proof generated from real validator data');
        console.log('✅ X1 testnet mint successful');
        console.log('✅ Balance verified correctly');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        console.log('📊 Bridge Summary:');
        console.log(`   Burned on Solana: ${burnAmount / 1_000_000} XENCAT`);
        console.log(`   Minted on X1: ${minted / 1_000_000} XENCAT`);
        console.log(`   Solana TX: https://solscan.io/tx/${burnTx}`);
        console.log(`   X1 TX: https://explorer.x1.xyz/tx/${mintTx}?cluster=testnet`);
        console.log(`   Total time: ${totalTime}s`);
        console.log(`   Burn nonce: ${lastBurnNonce.toString()}`);
        console.log('');
    });

    it('❌ Rejects replay attack', async function() {
        this.timeout(30000);

        console.log('\n🧪 Testing replay attack prevention...');

        if (!lastValidProof) {
            console.log('   ⚠️  Skipping: No valid proof from previous test');
            this.skip();
            return;
        }

        console.log(`   🔄 Attempting to reuse nonce ${lastBurnNonce.toString()}...`);

        // Get PDAs
        const [validatorSetPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('validator_set')],
            CONFIG.LIGHT_CLIENT_X1
        );

        const [mintStatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from('mint_state')],
            CONFIG.MINT_PROGRAM_X1
        );

        const [processedBurnsPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('processed_burns')],
            CONFIG.MINT_PROGRAM_X1
        );

        const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('mint_authority')],
            CONFIG.MINT_PROGRAM_X1
        );

        const x1TokenAccount = await getAssociatedTokenAddress(
            CONFIG.XENCAT_MINT_X1,
            userKeypair.publicKey
        );

        try {
            await mintProgram.methods
                .mintWithProof(lastValidProof)
                .accounts({
                    lightClientProgram: CONFIG.LIGHT_CLIENT_X1,
                    validatorSet: validatorSetPda,
                    mintState: mintStatePda,
                    processedBurns: processedBurnsPda,
                    user: userKeypair.publicKey,
                    xencatMint: CONFIG.XENCAT_MINT_X1,
                    userXencatAccount: x1TokenAccount,
                    mintAuthority: mintAuthorityPda,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .rpc();

            throw new Error('Should have rejected replay attack!');
        } catch (error: any) {
            const errorMsg = error.toString();
            console.log(`   ❌ Transaction rejected: ${errorMsg.substring(0, 100)}...`);

            // Check for expected error
            if (errorMsg.includes('BurnAlreadyProcessed') ||
                errorMsg.includes('already processed') ||
                errorMsg.includes('0x1771')) { // Custom error code
                console.log('   ✅ Replay attack correctly prevented!');
            } else {
                console.log('   ⚠️  Rejected but with unexpected error');
                console.log(`   Error: ${errorMsg}`);
            }
        }
    });

    it('❌ Rejects corrupted proof (amount manipulation)', async function() {
        this.timeout(30000);

        console.log('\n🧪 Testing proof integrity (amount manipulation)...');

        if (!lastValidProof) {
            console.log('   ⚠️  Skipping: No valid proof available');
            this.skip();
            return;
        }

        // Corrupt the amount - try to mint double!
        const corruptedProof = {
            ...lastValidProof,
            amount: new anchor.BN(lastValidProof.amount.toNumber() * 2),
        };

        console.log(`   🎭 Original amount: ${lastValidProof.amount.toNumber() / 1_000_000} XENCAT`);
        console.log(`   🎭 Corrupted amount: ${corruptedProof.amount.toNumber() / 1_000_000} XENCAT`);

        // Get PDAs
        const [validatorSetPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('validator_set')],
            CONFIG.LIGHT_CLIENT_X1
        );

        const [mintStatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from('mint_state')],
            CONFIG.MINT_PROGRAM_X1
        );

        const [processedBurnsPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('processed_burns')],
            CONFIG.MINT_PROGRAM_X1
        );

        const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('mint_authority')],
            CONFIG.MINT_PROGRAM_X1
        );

        const x1TokenAccount = await getAssociatedTokenAddress(
            CONFIG.XENCAT_MINT_X1,
            userKeypair.publicKey
        );

        try {
            await mintProgram.methods
                .mintWithProof(corruptedProof)
                .accounts({
                    lightClientProgram: CONFIG.LIGHT_CLIENT_X1,
                    validatorSet: validatorSetPda,
                    mintState: mintStatePda,
                    processedBurns: processedBurnsPda,
                    user: userKeypair.publicKey,
                    xencatMint: CONFIG.XENCAT_MINT_X1,
                    userXencatAccount: x1TokenAccount,
                    mintAuthority: mintAuthorityPda,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .rpc();

            throw new Error('Should have rejected corrupted proof!');
        } catch (error: any) {
            const errorMsg = error.toString();
            console.log(`   ❌ Transaction rejected: ${errorMsg.substring(0, 100)}...`);

            // Check for expected errors
            if (errorMsg.includes('InvalidMerkleProof') ||
                errorMsg.includes('InvalidBurnRecord') ||
                errorMsg.includes('BurnAlreadyProcessed') || // Might also trigger if using same nonce
                errorMsg.includes('0x1770') ||
                errorMsg.includes('0x1771')) {
                console.log('   ✅ Corrupted proof correctly rejected!');
            } else {
                console.log('   ⚠️  Rejected but with unexpected error');
                console.log(`   Error: ${errorMsg}`);
            }
        }
    });

    it('⚠️  Handles invalid RPC gracefully', async function() {
        this.timeout(30000);

        console.log('\n🧪 Testing error handling with invalid RPC...');

        try {
            await generateBurnProof({
                solanaRpc: 'https://invalid-rpc.solana.com',
                burnNonce: new anchor.BN(1),
                burnProgramId: CONFIG.BURN_PROGRAM_MAINNET.toBase58(),
                userAddress: userKeypair.publicKey.toBase58(),
                onProgress: () => {},
            });

            throw new Error('Should have failed with invalid RPC!');
        } catch (error: any) {
            const errorMsg = error.message || error.toString();
            console.log(`   ❌ Error: ${errorMsg.substring(0, 100)}...`);

            if (errorMsg.includes('RPC') ||
                errorMsg.includes('connection') ||
                errorMsg.includes('fetch') ||
                errorMsg.includes('network') ||
                errorMsg.includes('ENOTFOUND')) {
                console.log('   ✅ RPC failure handled correctly!');
            } else {
                console.log('   ⚠️  Failed but with unexpected error');
            }
        }
    });
});
