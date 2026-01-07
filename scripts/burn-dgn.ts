import 'dotenv/config';
import * as anchor from '@coral-xyz/anchor';
import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    SystemProgram,
    TransactionInstruction,
} from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    getAccount,
} from '@solana/spl-token';
import bs58 from 'bs58';

const CONFIG = {
    SOLANA_RPC: 'https://api.mainnet-beta.solana.com',
    DGN_MINT: new PublicKey('Fd8TNp5GhhTk6Uq6utMvK13vfQdLN1yUUHCnapWvpump'),
    BURN_PROGRAM: new PublicKey('2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp'),
    BURN_AMOUNT: 1_000_000, // 1 DGN (6 decimals)
};

async function main() {
    console.log('\n🔥 BURNING DGN ON SOLANA\n');

    // Load user keypair
    const privateKeyEnv = process.env.USER_PRIVATE_KEY;
    if (!privateKeyEnv) {
        throw new Error('USER_PRIVATE_KEY required!');
    }

    let userKeypair: Keypair;
    try {
        const privateKeyArray = JSON.parse(privateKeyEnv);
        userKeypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
    } catch {
        userKeypair = Keypair.fromSecretKey(bs58.decode(privateKeyEnv));
    }

    console.log(`👤 User: ${userKeypair.publicKey.toBase58()}`);
    console.log(`🔥 Amount: ${CONFIG.BURN_AMOUNT / 1_000_000} DGN\n`);

    const connection = new Connection(CONFIG.SOLANA_RPC, 'confirmed');

    // Check balance
    const userTokenAccount = await getAssociatedTokenAddress(
        CONFIG.DGN_MINT,
        userKeypair.publicKey
    );

    try {
        const accountInfo = await getAccount(connection, userTokenAccount);
        const balance = Number(accountInfo.amount) / 1_000_000;
        console.log(`💰 Current balance: ${balance.toFixed(6)} DGN`);
    } catch (err) {
        console.log('⚠️  No DGN token account found');
        throw new Error('Please fund your account with DGN first');
    }

    // Get current nonce
    const [globalStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('global_state')],
        CONFIG.BURN_PROGRAM
    );

    const globalStateAccount = await connection.getAccountInfo(globalStatePda);
    if (!globalStateAccount) {
        throw new Error('Burn program not initialized!');
    }

    const currentNonce = globalStateAccount.data.readBigUInt64LE(8);
    console.log(`📍 Burn nonce will be: ${currentNonce}\n`);

    // Build transaction
    const nonceBuffer = Buffer.alloc(8);
    nonceBuffer.writeBigUInt64LE(currentNonce);
    const [burnRecordPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('burn_record'), nonceBuffer],
        CONFIG.BURN_PROGRAM
    );

    const burnInstruction = new TransactionInstruction({
        programId: CONFIG.BURN_PROGRAM,
        keys: [
            { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: globalStatePda, isSigner: false, isWritable: true },
            { pubkey: burnRecordPda, isSigner: false, isWritable: true },
            { pubkey: CONFIG.DGN_MINT, isSigner: false, isWritable: true },
            { pubkey: userTokenAccount, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([
            Buffer.from([33, 48, 36, 182, 68, 82, 120, 188]), // burn_xencat discriminator
            Buffer.from(new anchor.BN(CONFIG.BURN_AMOUNT).toArray('le', 8)),
        ]),
    });

    const transaction = new Transaction().add(burnInstruction);
    transaction.feePayer = userKeypair.publicKey;

    console.log('📤 Sending transaction...');
    const signature = await connection.sendTransaction(transaction, [userKeypair], {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
    });

    console.log(`📝 Signature: ${signature}`);
    console.log(`🔗 Solscan: https://solscan.io/tx/${signature}\n`);

    console.log('⏳ Confirming...\n');
    await connection.confirmTransaction(signature, 'confirmed');

    console.log('✅ BURN CONFIRMED!');
    console.log(`📍 Burn Nonce: ${currentNonce}\n`);
    console.log(`🔗 Use this nonce to test DGN attestation:`);
    console.log(`   BURN_NONCE=${currentNonce} npx ts-node scripts/test-dgn-attestation.ts`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('\n❌ Error:', err);
        process.exit(1);
    });
