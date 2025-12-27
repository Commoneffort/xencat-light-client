import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    const x1Rpc = 'https://rpc.mainnet.x1.xyz';
    const connection = new Connection(x1Rpc, 'confirmed');

    // Load admin keypair
    const adminPrivateKey = process.env.USER_PRIVATE_KEY;
    if (!adminPrivateKey) {
        throw new Error('USER_PRIVATE_KEY required in .env');
    }

    let adminKeypair: Keypair;
    try {
        const privateKeyArray = JSON.parse(adminPrivateKey);
        adminKeypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
    } catch {
        adminKeypair = Keypair.fromSecretKey(bs58.decode(adminPrivateKey));
    }

    console.log('👤 Admin:', adminKeypair.publicKey.toBase58());

    // Load program ID from target/deploy
    const idlPath = path.join(__dirname, '../target/idl/solana_light_client_x1.json');
    const idlData = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
    const programId = new PublicKey(idlData.metadata.address);

    console.log('📝 Program ID:', programId.toBase58());

    // Load IDL from file with custom confirmation options
    const provider = new anchor.AnchorProvider(
        connection,
        new anchor.Wallet(adminKeypair),
        {
            commitment: 'confirmed',
            skipPreflight: true,
            preflightCommitment: 'confirmed'
        }
    );
    anchor.setProvider(provider);

    const program = new anchor.Program(
        idlData as anchor.Idl,
        programId,
        provider
    );

    // Get validator set PDA
    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('x1_validator_set')],
        programId
    );

    console.log('📝 Validator Set PDA:', validatorSetPda.toBase58());

    // Check admin balance
    const balance = await connection.getBalance(adminKeypair.publicKey);
    console.log('💰 Admin balance:', balance / 1e9, 'XNT');
    if (balance < 0.01 * 1e9) {
        throw new Error('Insufficient balance for initialization');
    }

    // Check if already initialized
    try {
        const existingValidatorSet: any = await program.account.x1ValidatorSet.fetch(validatorSetPda);
        console.log('\n⚠️  Validator set already initialized!');
        console.log('   Threshold:', existingValidatorSet.threshold);
        console.log('   Validators:', existingValidatorSet.validators.length);
        existingValidatorSet.validators.forEach((v: any, i: number) => {
            console.log(`   ${i + 1}. ${v.name} (${v.pubkey.toBase58()})`);
        });
        return;
    } catch (e) {
        // Not initialized yet, continue
    }

    console.log('\n🔧 Initializing validator set...\n');

    // Initialize with 2 of 3 threshold - send and confirm manually
    const txSignature = await program.methods
        .initializeValidatorSet(2)
        .accounts({
            admin: adminKeypair.publicKey,
            validatorSet: validatorSetPda,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });

    console.log('📤 Transaction sent:', txSignature);
    console.log('⏳ Confirming transaction (may take 60+ seconds on mainnet)...');

    // Manual confirmation with retries
    let confirmed = false;
    for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        try {
            const status = await connection.getSignatureStatus(txSignature);
            if (status?.value?.confirmationStatus === 'confirmed' || status?.value?.confirmationStatus === 'finalized') {
                confirmed = true;
                console.log('✅ Transaction confirmed!');
                break;
            }
            if (status?.value?.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
            }
            console.log(`   Attempt ${i + 1}/20: ${status?.value?.confirmationStatus || 'pending'}...`);
        } catch (e: any) {
            console.log(`   Attempt ${i + 1}/20: checking...`);
        }
    }

    if (!confirmed) {
        console.log('⚠️  Transaction not confirmed within 60 seconds');
        console.log('   Check status later with: solana confirm', txSignature);
        throw new Error('Transaction confirmation timeout');
    }

    console.log('📝 Transaction:', txSignature);

    // Fetch and display
    const validatorSet: any = await program.account.x1ValidatorSet.fetch(validatorSetPda);
    console.log('\n📊 Validator Set:');
    console.log('   Threshold:', validatorSet.threshold);
    console.log('   Validators:', validatorSet.validators.length);
    validatorSet.validators.forEach((v: any, i: number) => {
        console.log(`   ${i + 1}. ${v.name}`);
        console.log(`      Pubkey: ${v.pubkey.toBase58()}`);
        console.log(`      API: ${v.attestationApi}`);
        console.log(`      Active: ${v.active}`);
    });

    console.log('\n✅ Setup complete!');
    console.log('\nNext steps:');
    console.log('1. Deploy attestation service on each validator');
    console.log('2. Update API URLs in the contract if needed');
    console.log('3. Run E2E test: npm run test:x1-attestation');
}

main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('\n❌ Error:');
        console.error(err);
        process.exit(1);
    });
