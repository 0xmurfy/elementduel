# Elemental Duel

A Web3 PvP battle game on Base Chain (Sepolia) where players compete in a best-of-three elemental duel. Players stake ETH and battle using elemental moves in a commit-reveal scheme.

## Game Rules

- Each player commits three moves upfront
- Each move is one of four elements:
  - 🔥 Fire (beats Air)
  - 💧 Water (beats Fire)
  - 🌍 Earth (beats Water)
  - 💨 Air (beats Earth)
- First player to win 2 rounds wins the game
- Winner takes 98% of the total stake (2% platform fee)
- In case of a tie (1-1-1), both players get their stake back

## How to Play

1. Connect your MetaMask wallet (Base Sepolia network)
2. Create a game:
   - Set your stake amount
   - Click "Create Game"
   - Share the game link with your opponent
3. Join a game:
   - Use a shared game link or enter Game ID
   - Match the stake amount
4. Battle:
   - Select your three moves
   - Commit your moves
   - Wait for opponent to commit
   - Reveal your moves
   - Wait for the result!

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Smart Contract

The game runs on a Solidity smart contract deployed to Base Sepolia:
- Contract Address: `0x56f9d5cb76e854167891cbce3635eceff`
- Network: Base Sepolia (Chain ID: 84532)

## Technologies

- Next.js 14
- TypeScript
- Ethers.js
- Solidity
- Hardhat
- TailwindCSS

## License

MIT
