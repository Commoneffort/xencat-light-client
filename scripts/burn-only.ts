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
    XENCAT_MINT: new PublicKey('7UN8WkBumTUCofVPXCPjNWQ6msQhzrg9tFQRP48Nmw5V'),
    BURN_PROGRAM: new PublicKey('2ktujS2t9SRXE9cA4UVQJyDFH9genNR4GngfmGffjKkp'),
    BURN_AMOUNT: 10_000, // 0.00001 XENCAT
};

async function main() {
    console.log('\n🔥 BURNING XENCAT ON SOLANA\n');

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
    console.log(`🔥 Amount: ${CONFIG.BURN_AMOUNT / 1_000_000} XENCAT\n`);

    const connection = new Connection(CONFIG.SOLANA_RPC, 'confirmed');

    // Check balance
    const userTokenAccount = await getAssociatedTokenAddress(
        CONFIG.XENCAT_MINT,
        userKeypair.publicKey
    );

    const accountInfo = await getAccount(connection, userTokenAccount);
    const balance = accountInfo.amount;
    console.log(`💰 Current balance: ${Number(balance) / 1_000_000} XENCAT`);

    if (balance < BigInt(CONFIG.BURN_AMOUNT)) {
        throw new Error(`Insufficient balance!`);
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

    const burnIx = new TransactionInstruction({
        programId: CONFIG.BURN_PROGRAM,
        keys: [
            { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: globalStatePda, isSigner: false, isWritable: true },
            { pubkey: burnRecordPda, isSigner: false, isWritable: true },
            { pubkey: CONFIG.XENCAT_MINT, isSigner: false, isWritable: true },
            { pubkey: userTokenAccount, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([
            Buffer.from([33, 48, 36, 182, 68, 82, 120, 188]), // burn_xencat discriminator
            Buffer.from(new anchor.BN(CONFIG.BURN_AMOUNT).toArray('le', 8)),
        ]),
    });

    const transaction = new Transaction().add(burnIx);

    console.log(`📤 Sending transaction...`);
    const signature = await connection.sendTransaction(transaction, [userKeypair]);

    console.log(`📝 Signature: ${signature}`);
    console.log(`🔗 Solscan: https://solscan.io/tx/${signature}\n`);

    console.log(`⏳ Confirming...`);
    const confirmation = await connection.confirmTransaction(signature, 'finalized');

    if (confirmation.value.err) {
        throw new Error('Burn failed!');
    }

    console.log(`\n✅ BURN CONFIRMED!`);
    console.log(`📍 Burn Nonce: ${currentNonce}`);
    console.log(`\n🔗 Use this nonce to test the bridge:`);
    console.log(`   BURN_NONCE=${currentNonce} npm run test:x1-attestation\n`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('\n❌ Error:');
        console.error(error);
        process.exit(1);
    });
