/**
 * Check ValidatorConfig Status
 *
 * This script displays the current validator configuration on X1 testnet.
 */

import * as anchor from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';
import { SolanaLightClientX1 } from '../target/types/solana_light_client_x1';
import fs from 'fs';

const X1_RPC = process.env.X1_RPC || 'https://rpc.testnet.x1.xyz';
const LIGHT_CLIENT_PROGRAM_ID = new PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5');

async function main() {
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║  📊 VALIDATOR CONFIG STATUS                       ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    // Setup connection
    const connection = new Connection(X1_RPC, 'confirmed');
    console.log(`🌐 X1 RPC: ${X1_RPC}\n`);

    // Setup provider (minimal - just need to read accounts)
    const wallet = anchor.AnchorProvider.env().wallet;
    const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: 'confirmed',
    });
    anchor.setProvider(provider);

    // Load program
    const idl = JSON.parse(
        fs.readFileSync('target/idl/solana_light_client_x1.json', 'utf-8')
    );
    const program = new Program(
        idl,
        LIGHT_CLIENT_PROGRAM_ID,
        provider
    ) as Program<SolanaLightClientX1>;

    // Derive ValidatorConfig PDA
    const [validatorConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('validator_config')],
        program.programId
    );

    console.log(`📍 ValidatorConfig PDA: ${validatorConfigPda.toBase58()}\n`);

    try {
        // Fetch ValidatorConfig
        const config = await program.account.validatorConfig.fetch(validatorConfigPda);

        console.log('═══════════════════════════════════════════════════════');
        console.log('ValidatorConfig Details');
        console.log('═══════════════════════════════════════════════════════\n');

        console.log(`Current Epoch: ${config.currentEpoch.toString()}`);
        console.log(`Last Update: ${new Date(config.lastUpdate.toNumber() * 1000).toISOString()}`);
        console.log(`Total Tracked Stake: ${(parseFloat(config.totalTrackedStake.toString()) / 1e9).toFixed(2)} SOL\n`);

        console.log('PRIMARY VALIDATORS (Top 3 by stake):\n');
        config.primaryValidators.forEach((validator, idx) => {
            const stakeSOL = parseFloat(validator.stake.toString()) / 1e9;
            console.log(`  ${idx + 1}. ${validator.identity.toBase58()}`);
            console.log(`     Stake: ${stakeSOL.toLocaleString()} SOL\n`);
        });

        console.log('FALLBACK VALIDATORS (Validators 4-7):\n');
        config.fallbackValidators.forEach((validator, idx) => {
            const stakeSOL = parseFloat(validator.stake.toString()) / 1e9;
            console.log(`  ${idx + 4}. ${validator.identity.toBase58()}`);
            console.log(`     Stake: ${stakeSOL.toLocaleString()} SOL\n`);
        });

        const primaryStake = config.primaryValidators.reduce(
            (sum, v) => sum + parseFloat(v.stake.toString()),
            0
        );
        const fallbackStake = config.fallbackValidators.reduce(
            (sum, v) => sum + parseFloat(v.stake.toString()),
            0
        );

        console.log('═══════════════════════════════════════════════════════');
        console.log('Stake Summary');
        console.log('═══════════════════════════════════════════════════════\n');
        console.log(`Primary Stake:  ${(primaryStake / 1e9).toFixed(2)} SOL`);
        console.log(`Fallback Stake: ${(fallbackStake / 1e9).toFixed(2)} SOL`);
        console.log(`Total Stake:    ${((primaryStake + fallbackStake) / 1e9).toFixed(2)} SOL\n`);

        console.log('✅ ValidatorConfig is healthy!\n');
    } catch (error: any) {
        console.error('❌ Failed to fetch ValidatorConfig:');
        console.error(error.message);

        if (error.message.includes('Account does not exist')) {
            console.log('\n⚠️  ValidatorConfig has not been initialized yet.');
            console.log('   Run: npx ts-node scripts/close-and-reinitialize.ts\n');
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
