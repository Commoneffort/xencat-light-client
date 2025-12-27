const anchor = require('@coral-xyz/anchor');

async function verifyMintState() {
    console.log('\n🔍 Verifying Mint Program State...\n');

    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const programId = new anchor.web3.PublicKey('8kmoPKtLAjjzQRN5i4emUsmWeu3LM5yPWFrsqZVyekhk');

    const [mintState] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('mint_state')],
        programId
    );

    const [xencatMint] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('xencat_mint')],
        programId
    );

    try {
        // Check mint state account
        const stateAccount = await provider.connection.getAccountInfo(mintState);
        console.log('📊 Mint State Account:');
        console.log('   Address:', mintState.toString());
        console.log('   Exists:', stateAccount ? '✅ Yes' : '❌ No');
        if (stateAccount) {
            console.log('   Size:', stateAccount.data.length, 'bytes');
            console.log('   Owner:', stateAccount.owner.toString());
            console.log('   Lamports:', stateAccount.lamports);
        }
        console.log();

        // Check XENCAT mint account
        const mintAccount = await provider.connection.getAccountInfo(xencatMint);
        console.log('🪙 XENCAT Mint Account:');
        console.log('   Address:', xencatMint.toString());
        console.log('   Exists:', mintAccount ? '✅ Yes' : '❌ No');
        if (mintAccount) {
            console.log('   Size:', mintAccount.data.length, 'bytes');
            console.log('   Owner:', mintAccount.owner.toString());

            // Parse SPL token mint data (first 82 bytes)
            if (mintAccount.data.length >= 82) {
                const mintAuthority = new anchor.web3.PublicKey(mintAccount.data.slice(4, 36));
                const supply = mintAccount.data.readBigUInt64LE(36);
                const decimals = mintAccount.data[44];
                const isInitialized = mintAccount.data[45];

                console.log('   Mint Authority:', mintAuthority.toString());
                console.log('   Supply:', supply.toString());
                console.log('   Decimals:', decimals);
                console.log('   Initialized:', isInitialized ? '✅ Yes' : '❌ No');
            }
        }
        console.log();

        if (stateAccount && mintAccount) {
            console.log('✅ Mint program is fully initialized!\n');
            console.log('🎯 Ready for E2E testing\n');
        } else {
            console.log('⚠️  Mint program initialization incomplete\n');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

verifyMintState().catch(console.error);
