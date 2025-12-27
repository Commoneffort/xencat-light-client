import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { SolanaLightClientX1 } from '../target/types/solana_light_client_x1';
import fs from 'fs';

// X1 Mainnet Configuration
const X1_RPC = 'https://rpc.mainnet.x1.xyz';

async function main() {
    console.log('🚀 Initializing X1 Validator Set V2 (Trustless Bridge)');
    console.log('━'.repeat(60));

    // Load deployer keypair
    const keypairPath = process.env.HOME + '/.config/solana/identity.json';
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
    const payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));

    console.log('👤 Payer:', payerKeypair.publicKey.toBase58());

    // Connect to X1
    const connection = new Connection(X1_RPC, 'confirmed');
    const provider = new anchor.AnchorProvider(
        connection,
        new anchor.Wallet(payerKeypair),
        { commitment: 'confirmed' }
    );
    anchor.setProvider(provider);

    // Load program
    const programId = new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5');
    const idl = JSON.parse(
        fs.readFileSync('./target/idl/solana_light_client_x1.json', 'utf-8')
    );
    const program = new Program(idl, programId, provider) as Program<SolanaLightClientX1>;

    // Derive validator set PDA V2
    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('x1_validator_set_v2')],
        program.programId
    );

    console.log('\n📝 Program ID:', program.programId.toBase58());
    console.log('📝 Validator Set PDA V2:', validatorSetPda.toBase58());

    // Check if already initialized
    try {
        const validatorSet = await program.account.x1ValidatorSet.fetch(validatorSetPda);
        console.log('\n⚠️  Validator set already initialized!');
        console.log('   Version:', validatorSet.version.toString());
        console.log('   Validators:', validatorSet.validators.length);
        console.log('   Threshold:', validatorSet.threshold);
        console.log('\n💡 If you want to reinitialize, you need to deploy with a new program ID');
        return;
    } catch (e) {
        // Not initialized yet - this is expected
        console.log('\n✅ Validator set not yet initialized - proceeding...');
    }

    // Initialize with 5 validators, 3-of-5 threshold
    const THRESHOLD = 3;

    console.log('\n📊 Initialization Parameters:');
    console.log('   Validators: 5');
    console.log('   Threshold: 3 of 5 (Byzantine fault tolerant)');
    console.log('   Initial Version: 1');
    console.log('\n🔑 Validator Public Keys:');
    console.log('   1. 9oa7NAscCZ1kCQFZJng9gfwvDzrEvyWgx4F244PHmHPH');
    console.log('   2. 8byEUEZ2sMfP6RPX9VD8JCvCQK3F5FG2LytcR9TkVWag');
    console.log('   3. 5NfpgFCwrYzcgJkda9bRJvccycLUo3dvVQsVAK2W43Um');
    console.log('   4. GdbXi56fCSQ1joCvGjqm7JKvqvwgtKh6xeusUqZbB3rH');
    console.log('   5. FmuuFgRh8NP8UD7QHg86f7vu7qpsmr1wE7hB59oojDpj');

    // Send transaction
    console.log('\n📤 Sending initialization transaction...');

    try {
        const tx = await program.methods
            .initializeValidatorSet(THRESHOLD)
            .accounts({
                payer: payerKeypair.publicKey,
                validatorSet: validatorSetPda,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .rpc();

        console.log('\n✅ VALIDATOR SET INITIALIZED!');
        console.log('📝 Transaction:', tx);
        console.log('🔗 Explorer:', `https://explorer.x1.xyz/tx/${tx}`);

        // Fetch and display initialized state
        console.log('\n⏳ Fetching initialized state...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        const validatorSet = await program.account.x1ValidatorSet.fetch(validatorSetPda);

        console.log('\n📊 Validator Set State:');
        console.log('   Version:', validatorSet.version.toString());
        console.log('   Validators:', validatorSet.validators.length);
        console.log('   Threshold:', validatorSet.threshold);
        console.log('   PDA Bump:', validatorSet.bump);

        console.log('\n🎉 BRIDGE V2 READY!');
        console.log('\n📋 Next Steps:');
        console.log('   1. Deploy mint program (if not already)');
        console.log('   2. Run E2E test: npm run test:bridge-v2');
        console.log('   3. Old bridge at x1_validator_set is deprecated');

    } catch (error: any) {
        console.error('\n❌ Initialization failed!');
        console.error(error);

        if (error.logs) {
            console.log('\n📜 Program Logs:');
            error.logs.forEach((log: string) => console.log('   ', log));
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
