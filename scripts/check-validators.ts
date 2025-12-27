import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';

async function main() {
    const connection = new Connection('https://rpc.testnet.x1.xyz', 'confirmed');

    const adminPrivateKey = process.env.USER_PRIVATE_KEY;
    let adminKeypair: Keypair;
    try {
        const privateKeyArray = JSON.parse(adminPrivateKey!);
        adminKeypair = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
    } catch {
        adminKeypair = Keypair.fromSecretKey(bs58.decode(adminPrivateKey!));
    }

    const idlPath = path.join(__dirname, '../target/idl/solana_light_client_x1.json');
    const idlData = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
    const programId = new PublicKey(idlData.metadata.address);

    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(adminKeypair), {});
    const program = new anchor.Program(idlData as anchor.Idl, programId, provider);

    const [validatorSetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('x1_validator_set')],
        programId
    );

    const validatorSet: any = await program.account.x1ValidatorSet.fetch(validatorSetPda);
    console.log('📊 Current validators in contract:');
    console.log('   Threshold:', validatorSet.threshold);
    console.log('');
    validatorSet.validators.forEach((v: any, i: number) => {
        console.log(`   ${i+1}. ${v.pubkey.toBase58()}`);
        console.log(`      Name: ${v.name}`);
        console.log(`      API: ${v.attestationApi}`);
        console.log(`      Active: ${v.active}`);
        console.log('');
    });

    console.log('✅ Expected validators:');
    console.log('   1. 9oa7NAscCZ1kCQFZJng9gfwvDzrEvyWgx4F244PHmHPH');
    console.log('   2. 5NfpgFCwrYzcgJkda9bRJvccycLUo3dvVQsVAK2W43Um');
    console.log('   3. 8byEUEZ2sMfP6RPX9VD8JCvCQK3F5FG2LytcR9TkVWag');
}

main();
