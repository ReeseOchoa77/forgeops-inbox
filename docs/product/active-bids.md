# Active Bids (product)

Internal model: `BidCandidate`. Architecture: [bidding-active-bids.md](../architecture/bidding-active-bids.md).

## What users see

Nav label **Active Bids**. The page lists permanent opportunities that are `OPEN` or `QUOTED`.

Users can create a Bid without a mailbox or Job number. Convert to Job is an explicit review dialog (creates a real Job; the Candidate remains `CONVERTED`).

## Inbox

The **Active Bid** chip lists emails that **belong to** an OPEN/QUOTED Candidate, not every Bid Opportunity classification.

Sent **Quote** is a different chip (Sent context only).

## Quotes

Green / Quoted appearance requires a **finite quote amount**. A Quote email or durable evidence without a price is still evidence (With Quote filter) but is not the priced visual.

## Documents

Linked email attachments only. Direct upload onto an Active Bid is **not implemented**.
