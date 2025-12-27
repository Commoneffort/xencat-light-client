# Solana Validator Vote Signatures - Research

## Goal
Extract Ed25519 signatures from Solana validators who signed a specific block.

## Solana Block Structure

### Key Fields in `getBlock` Response

```typescript
{
  blockhash: string,
  previousBlockhash: string,
  parentSlot: number,
  transactions: Array<TransactionResponse>,
  rewards: Array<{
    pubkey: string,        // Validator vote account
    lamports: number,      // Reward amount
    postBalance: number,
    rewardType: "Voting" | "Fee" | "Rent" | "Staking",
    commission?: number
  }>,
  blockTime: number,
  blockHeight: number
}
```

**Problem**: `rewards` shows WHO voted, but NOT their signatures

## Where Are Vote Signatures?

### Option 1: Vote Program Transactions

Validators submit vote transactions to the Vote Program (Vote111111111111111111111111111111111111111).

Each vote transaction contains:
- VoteAccount (PDA)
- Ed25519 signature from validator identity
- Slots being voted on
- Hash being voted on

**To extract**:
```typescript
const block = await connection.getBlock(slot, {
  maxSupportedTransactionVersion: 0,
  transactionDetails: 'full'
});

// Filter for vote program transactions
const voteTransactions = block.transactions.filter(tx => {
  return tx.transaction.message.accountKeys.some(key =>
    key.equals(VOTE_PROGRAM_ID)
  );
});

// Each transaction has a signature
voteTransactions.forEach(tx => {
  const signature = tx.transaction.signatures[0]; // Validator's Ed25519 signature
  const voteAccount = /* extract from accounts */;
  // Map voteAccount -> validator identity
});
```

### Option 2: Block Metadata (getBlockProduction)

```typescript
const blockProduction = await connection.getBlockProduction({
  range: { firstSlot: slot, lastSlot: slot }
});
```

**Problem**: Only shows validator identities, not signatures.

### Option 3: Confirmed Votes (getVoteAccounts + getSignaturesForAddress)

```typescript
// Get all vote accounts
const voteAccounts = await connection.getVoteAccounts();

// For each vote account, get recent signatures
for (const voteAccount of voteAccounts.current) {
  const signatures = await connection.getSignaturesForAddress(
    new PublicKey(voteAccount.votePubkey),
    { limit: 10 }
  );

  // Check if any signature corresponds to our slot
  const voteForSlot = signatures.find(sig => /* check slot */);
}
```

**Problem**: Rate limiting (100K+ vote accounts)

## RECOMMENDED APPROACH

### Extract Votes from Block Transactions

**Step-by-step**:

1. **Fetch block with full transaction details**
```typescript
const block = await connection.getBlock(slot, {
  maxSupportedTransactionVersion: 0,
  transactionDetails: 'full',
  rewards: true
});
```

2. **Filter vote transactions**
```typescript
const VOTE_PROGRAM_ID = new PublicKey('Vote111111111111111111111111111111111111111');

const voteTransactions = block.transactions.filter(tx => {
  const accountKeys = tx.transaction.message.staticAccountKeys ||
                      tx.transaction.message.accountKeys;
  return accountKeys.some(key => key.equals(VOTE_PROGRAM_ID));
});
```

3. **Extract validator signatures**
```typescript
const validatorVotes = [];

for (const voteTx of voteTransactions) {
  // First signature is from validator identity
  const signature = voteTx.transaction.signatures[0];

  // Vote account is usually account[1]
  const voteAccountPubkey = voteTx.transaction.message.accountKeys[1];

  // Fetch vote account data to get validator identity
  const voteAccountInfo = await connection.getAccountInfo(voteAccountPubkey);
  const voteState = parseVoteAccount(voteAccountInfo.data);

  validatorVotes.push({
    validatorIdentity: voteState.nodePubkey,
    voteAccount: voteAccountPubkey,
    signature: signature,
    stake: /* lookup from getVoteAccounts */
  });
}
```

4. **Map to stake amounts**
```typescript
const voteAccounts = await connection.getVoteAccounts();

const validatorStakeMap = new Map();
for (const va of voteAccounts.current) {
  validatorStakeMap.set(va.votePubkey, {
    identity: va.nodePubkey,
    stake: va.activatedStake
  });
}

// Enrich votes with stake
validatorVotes.forEach(vote => {
  const stakeInfo = validatorStakeMap.get(vote.voteAccount.toBase58());
  vote.stake = stakeInfo.stake;
});
```

## Vote Account Structure

```rust
// From solana-program/vote/state
pub struct VoteState {
    pub node_pubkey: Pubkey,        // Validator identity (what we need!)
    pub authorized_withdrawer: Pubkey,
    pub commission: u8,
    pub votes: VecDeque<Lockout>,
    pub root_slot: Option<Slot>,
    // ... more fields
}
```

**Deserialization** (TypeScript):
```typescript
import { deserialize } from 'borsh';

function parseVoteAccount(data: Buffer): VoteState {
  // Vote account data uses bincode (not borsh)
  // Use @solana/web3.js VoteAccount class instead
  const voteAccount = new VoteAccount(data);
  return {
    nodePubkey: voteAccount.nodePubkey,
    authorizedWithdrawer: voteAccount.authorizedWithdrawer,
    commission: voteAccount.commission,
    // ...
  };
}
```

**BETTER**: Use `@solana/web3.js` built-in:
```typescript
import { VoteAccount } from '@solana/web3.js';

const voteAccountData = await connection.getParsedAccountInfo(voteAccountPubkey);
const nodePubkey = voteAccountData.value.data.parsed.info.nodePubkey;
```

## What Validators Actually Sign

**Vote Instruction Data**:
```rust
pub enum VoteInstruction {
    Vote(Vote),
    // ...
}

pub struct Vote {
    pub slots: Vec<Slot>,          // Slots being voted on
    pub hash: Hash,                 // Bank hash (NOT blockhash!)
    pub timestamp: Option<UnixTimestamp>,
}
```

**Important**: Validators sign the TRANSACTION, not the block hash directly.

**Transaction structure**:
```
message = {
  header: { numRequiredSignatures, ... },
  accountKeys: [voteAccount, ...],
  recentBlockhash,
  instructions: [voteInstruction]
}

signature = Ed25519.sign(message, validatorPrivateKey)
```

## Verifying Validator Votes On-Chain (X1)

**Challenge**: We need to prove validator signed a specific block.

**Solution**: Extract vote instruction data from transaction.

```typescript
// In proof generator
const voteTx = await connection.getParsedTransaction(voteSignature);
const voteInstruction = voteTx.transaction.message.instructions.find(
  ix => ix.programId.equals(VOTE_PROGRAM_ID)
);

const voteData = parseVoteInstruction(voteInstruction.data);
// voteData.slots includes the slot being voted on
// voteData.hash is the bank hash
```

**On-chain verification** (X1):
```rust
// Reconstruct vote message
let vote_message = VoteMessage {
  vote_account: vote.vote_account,
  slots: vote.slots,
  hash: vote.hash,
  recent_blockhash: vote.recent_blockhash,
};

// Serialize
let serialized = vote_message.serialize();

// Verify Ed25519 signature
ed25519_verify(vote.signature, &serialized, &validator_identity)?;
```

## CRITICAL ISSUE: Bank Hash vs Block Hash

**Problem**: Validators sign the BANK HASH, not the blockhash.

**Bank Hash** = Hash of account state after executing all transactions
**Block Hash** = Hash of block header

These are DIFFERENT values.

**Impact on our bridge**:
- We can't use blockhash in Merkle proofs
- Need to use bank hash instead
- OR: Find consensus on blockhash separately

## ALTERNATIVE: Block Confirmation Data

Solana's block confirmation comes from:
1. Validators produce blocks
2. Other validators vote on blocks
3. Votes accumulate until 66%+ stake votes

**Block production proof**:
```typescript
const blockProduction = await connection.getBlockProduction({
  range: { firstSlot: slot, lastSlot: slot },
  identity: validatorIdentity
});

// Proves which validator produced the block
// But not who voted on it
```

## SIMPLIFIED APPROACH FOR BRIDGE

Instead of extracting vote signatures, we can:

1. **Use block confirmation as proof**
   - If block is finalized (32+ confirmations)
   - Then by definition 66%+ validators voted
   - Solana RPC won't return unfinalized blocks with commitment: 'finalized'

2. **Trust finality**
   - Finalized blocks can't be reverted
   - Safe to bridge from finalized state
   - No need to verify individual votes

3. **Add validator set checkpoints**
   - Post validator set Merkle root to X1
   - Users prove burn in finalized block
   - Simpler than vote signature verification

## RECOMMENDATION

**For production bridge**:
Use **Checkpointing** approach instead of vote signature extraction:

1. **Relayer posts validator set hash** every epoch (2 days)
2. **Users prove burn** in finalized block
3. **On-chain verifier** checks:
   - Block is finalized (via RPC commitment)
   - Burn Merkle proof valid
   - Validator set hash matches checkpoint

**Benefits**:
- ✅ Simpler than vote extraction
- ✅ Works with Solana's finality guarantees
- ✅ Amortizes cost (1 checkpoint per epoch)
- ✅ Trustless (finality = 66%+ votes by definition)

**Drawbacks**:
- Requires trusting Solana RPC for finality
- Can mitigate with multiple RPC providers

Should we pivot to checkpointing approach?
