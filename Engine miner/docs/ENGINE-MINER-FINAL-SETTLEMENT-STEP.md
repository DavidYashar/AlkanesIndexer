# Engine miner Final Settlement Step

Date: 2026-05-25

Purpose: define the missing last-mile settlement step that turns a correct paid claim into a real Alkanes mint for the winning miner.

## Core Question

Where does the token contract address enter the process?

Answer:

- the token contract address matters at settlement time, not at puzzle-submission time
- the winning miner should not directly own public mint authority against the Engine token contract
- instead, a privileged settlement path should call the token contract only after the fee payment and signed claim are validated

## Contracts Involved

### EngineToken

- Alkane that represents the Engine token supply
- capped at 21,000,000 total units
- should expose owner-gated mint only

### ClaimManager

- validates claim receipts and replay protection
- validates that the claim fee path was satisfied
- holds a dedicated settlement auth token path needed to mint EngineToken
- should consume one auth-token unit per successful settlement so authority never flows to the miner payout output

### TreasuryManager

- records claim-fee revenue
- tracks treasury allocation and buyback budget
- does not itself decide puzzle winners

## Why The Miner Should Not Mint Directly

The standard owned-token pattern is owner-gated.

In the current codebase, the owned-token template mints only after `only_owner()` passes, and ownership is represented by an auth token rather than by unrestricted public calls.

Practical meaning:

- if miners could call the token contract mint function directly, they could bypass the Engine miner backend and the claim-fee rules
- therefore the public miner flow must not be “user calls EngineToken.mint directly”
- instead, the miner proves they won, pays the fee, and the privileged claim-settlement path performs the mint

## Recommended Settlement Sequence

### Step 1: Puzzle submission

- the backend receives correct answers
- candidates are ordered by backend receive time in milliseconds

### Step 2: Provisional winner reservation

- the first eligible correct candidate gets a 2-minute reservation
- the backend checks whether the funding wallet can cover the fee path

### Step 3: Fee-payment transaction

- the provisional winner sends the claim fee transaction
- the backend accepts or rejects the fee-payment txid

### Step 4: Settlement transaction construction

- after fee acceptance, the settlement operator builds the privileged Alkanes transaction
- this transaction targets the `ClaimManager` AlkaneId, not the user-facing EngineToken mint entry directly
- this transaction also supplies exactly one ClaimManager self-auth token unit as a required alkane input; in the current design that auth token uses the same block/tx coordinates as the ClaimManager itself

### Step 5: ClaimManager execution

- ClaimManager verifies the signed receipt and replay state
- ClaimManager consumes one self-auth token unit and uses that authority to call EngineToken mint logic
- ClaimManager mints exactly 1,000 Engine to the miner payout address

### Step 6: Final state visibility

- the Bitcoin transaction confirms
- Alkanes-aware indexers process the settlement call
- the miner balance becomes visible through Subfrost, UniSat, or other indexed state providers

## Two Practical Operational Modes

### Mode A: Two-transaction operational v1

- transaction 1: miner fee payment
- transaction 2: privileged settlement transaction from the settlement operator

Pros:

- easiest way to build the missing last mile with the current scaffold
- easiest place to insert provider adapters and fallback logic

Cons:

- two-step operational flow
- requires backend or operator coordination

### Mode B: Single-transaction future optimization

- the miner submits one Bitcoin transaction that both pays the treasury and carries the claim call
- ClaimManager verifies the fee payment and claim receipt in the same transaction context

Pros:

- cleaner user flow
- fewer moving pieces

Cons:

- more complex transaction builder and contract validation path
- not what the current scaffold already implements today

## Recommended Next Implementation

Implement Mode A first.

Why:

- it matches the current reality that `/v1/claims/submit` still behaves like a relay handoff rather than a full on-chain builder
- it lets the backend validate payment before privileged minting
- it is easier to operate across signet and mainnet with hosted providers

## Provider Interaction In The Final Step

### Bitcoin provider

- validates the fee-payment txid
- broadcasts the privileged settlement tx if the settlement builder uses provider-backed broadcast

### Alkanes indexed-state provider

- confirms that the settlement tx executed and updated balances as expected

## Non-Goal

- do not expose unrestricted direct mint access against EngineToken to winning miners