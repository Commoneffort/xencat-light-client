const anchor = require('@coral-xyz/anchor');
const fs = require('fs');

async function checkMintProgram() {
    console.log('\n🔍 Checking Mint Program State...\n');
    
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    
    const programId = new anchor.web3.PublicKey('8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk');
    const idl = JSON.parse(fs.readFileSync('./target/idl/xencat_mint_x1.json'));
    const program = new anchor.Program(idl, programId, provider);
    
    const [mintProgramState] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('mint_program_state')],
        programId
    );
    
    try {
        const state = await program.account.mintProgramState.fetch(mintProgramState);
        
        console.log('📊 Mint Program State:');
        console.log('   Address:', mintProgramState.toString());
        console.log('   Authority:', state.authority.toString());
        console.log('   Light Client:', state.lightClientProgram.toString());
        console.log('   XENCAT Mint:', state.xencatMint.toString());
        console.log('   Total Minted:', state.totalMinted.toString());
        console.log('   Total Burns Processed:', state.totalBurnsProcessed.toString());
        console.log();
        console.log('✅ Mint program is initialized!\n');
        
    } catch (error) {
        console.log('⚠️  Mint program NOT initialized');
        console.log('   This is expected - needs initialization');
        console.log('   Error:', error.message);
        console.log();
    }
}

checkMintProgram().catch(console.error);
