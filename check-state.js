const anchor = require('@coral-xyz/anchor');
const fs = require('fs');

async function checkLightClient() {
    console.log('\n🔍 Checking Light Client State...\n');
    
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    
    const programId = new anchor.web3.PublicKey('BXBZtvFfCtCapQgqFTxGQ9hgJTQZUoHFzBXD2V3ys5C5');
    const idl = JSON.parse(fs.readFileSync('./target/idl/solana_light_client_x1.json'));
    const program = new anchor.Program(idl, programId, provider);
    
    const [lightClientState] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('light_client_state')],
        programId
    );
    
    const [validatorSet] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('validator_set')],
        programId
    );
    
    try {
        const state = await program.account.lightClientState.fetch(lightClientState);
        
        console.log('📊 Light Client State:');
        console.log('   Address:', lightClientState.toString());
        console.log('   Authority:', state.authority.toString());
        console.log('   Fee Receiver:', state.feeReceiver.toString());
        console.log('   Verification Fee:', state.verificationFee.toString(), 'lamports');
        console.log('   Validator Count:', state.validatorCount);
        console.log('   Total Stake:', state.totalStake.toString());
        console.log('   Last Update Slot:', state.lastUpdateSlot.toString());
        console.log();
        
        const validators = await program.account.validatorSet.fetch(validatorSet);
        console.log('📋 Validator Set:');
        console.log('   Address:', validatorSet.toString());
        console.log('   Validators Stored:', validators.validators.length);
        console.log();
        
        console.log('✅ Light client is operational!\n');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

checkLightClient().catch(console.error);
