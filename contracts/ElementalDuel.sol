// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ElementalDuel is ReentrancyGuard, Pausable, Ownable {
    // Constants
    uint256 public constant PLATFORM_FEE_PERCENTAGE = 2; // 2% fee
    uint256 public constant ROUNDS_TO_WIN = 2;
    uint256 public constant TOTAL_MOVES = 3;
    uint256 public constant REVEAL_TIMEOUT = 1 days;

    // Enums
    enum Element {
        Fire,    // Beats Air
        Water,   // Beats Fire
        Earth,   // Beats Water
        Air      // Beats Earth
    }

    enum GameState {
        Created,        // Game created, waiting for player 2
        MovesCommitted, // Both players committed moves
        MovesRevealed,  // Both players revealed moves
        Finished       // Game is finished
    }

    // Structs
    struct Move {
        Element element;
        bool isRevealed;
    }

    struct Game {
        address player1;
        address player2;
        uint256 stake;
        uint256 totalPrize;
        GameState state;
        bytes32[TOTAL_MOVES] player1Commitments;
        bytes32[TOTAL_MOVES] player2Commitments;
        Move[TOTAL_MOVES] player1Moves;
        Move[TOTAL_MOVES] player2Moves;
        uint256 lastActionTimestamp;
        uint256 player1Wins;
        uint256 player2Wins;
        bool isInitialized;
    }

    // State variables
    mapping(uint256 => Game) public games;
    uint256 public nextGameId;

    // Events
    event GameCreated(uint256 indexed gameId, address indexed player1, uint256 stake);
    event PlayerJoined(uint256 indexed gameId, address indexed player2);
    event MovesCommitted(uint256 indexed gameId, address indexed player);
    event MovesRevealed(uint256 indexed gameId, address indexed player);
    event RoundResult(uint256 indexed gameId, uint256 roundIndex, address winner);
    event GameFinished(uint256 indexed gameId, address indexed winner, uint256 prize);

    constructor() {
        _transferOwnership(msg.sender);
    }

    // Create a new game with stake
    function createGame() external payable whenNotPaused nonReentrant returns (uint256) {
        require(msg.value > 0, "Stake must be greater than 0");
        
        uint256 gameId = nextGameId++;
        Game storage game = games[gameId];
        
        game.player1 = msg.sender;
        game.stake = msg.value;
        game.state = GameState.Created;
        game.isInitialized = true;
        
        emit GameCreated(gameId, msg.sender, msg.value);
        return gameId;
    }

    // Join an existing game
    function joinGame(uint256 gameId) external payable whenNotPaused nonReentrant {
        Game storage game = games[gameId];
        require(game.isInitialized, "Game does not exist");
        require(game.state == GameState.Created, "Game already started");
        require(msg.sender != game.player1, "Cannot join your own game");
        require(msg.value == game.stake, "Must match the stake amount");

        game.player2 = msg.sender;
        game.totalPrize = game.stake * 2;
        game.lastActionTimestamp = block.timestamp;
        
        emit PlayerJoined(gameId, msg.sender);
    }

    // Commit moves
    function commitMoves(uint256 gameId, bytes32[TOTAL_MOVES] calldata moveHashes) external whenNotPaused {
        Game storage game = games[gameId];
        require(game.state == GameState.Created, "Invalid game state");
        require(msg.sender == game.player1 || msg.sender == game.player2, "Not a player");
        
        if (msg.sender == game.player1) {
            require(game.player1Commitments[0] == bytes32(0), "Moves already committed");
            game.player1Commitments = moveHashes;
        } else {
            require(game.player2Commitments[0] == bytes32(0), "Moves already committed");
            game.player2Commitments = moveHashes;
        }

        emit MovesCommitted(gameId, msg.sender);

        // If both players have committed, change state
        if (game.player1Commitments[0] != bytes32(0) && game.player2Commitments[0] != bytes32(0)) {
            game.state = GameState.MovesCommitted;
            game.lastActionTimestamp = block.timestamp;
        }
    }

    // Reveal moves
    function revealMoves(
        uint256 gameId,
        Element[TOTAL_MOVES] calldata elements,
        bytes32[TOTAL_MOVES] calldata salts
    ) external whenNotPaused {
        Game storage game = games[gameId];
        require(game.state == GameState.MovesCommitted, "Not in reveal phase");
        require(msg.sender == game.player1 || msg.sender == game.player2, "Not a player");

        // Verify and store moves
        bytes32[TOTAL_MOVES] storage commitments = msg.sender == game.player1 ? 
            game.player1Commitments : game.player2Commitments;
        Move[TOTAL_MOVES] storage moves = msg.sender == game.player1 ? 
            game.player1Moves : game.player2Moves;

        for (uint256 i = 0; i < TOTAL_MOVES; i++) {
            require(!moves[i].isRevealed, "Moves already revealed");
            
            // Verify move matches commitment
            bytes32 moveHash = keccak256(abi.encodePacked(elements[i], salts[i]));
            require(moveHash == commitments[i], "Invalid move revelation");

            // Store revealed move
            moves[i].element = elements[i];
            moves[i].isRevealed = true;
        }

        emit MovesRevealed(gameId, msg.sender);

        // If both players have revealed, resolve the game
        if (areAllMovesRevealed(game)) {
            resolveGame(gameId);
        }
    }

    // Internal function to check if all moves are revealed
    function areAllMovesRevealed(Game storage game) internal view returns (bool) {
        for (uint256 i = 0; i < TOTAL_MOVES; i++) {
            if (!game.player1Moves[i].isRevealed || !game.player2Moves[i].isRevealed) {
                return false;
            }
        }
        return true;
    }

    // Internal function to resolve the game
    function resolveGame(uint256 gameId) internal {
        Game storage game = games[gameId];
        
        // Resolve each round
        for (uint256 i = 0; i < TOTAL_MOVES; i++) {
            address roundWinner = determineRoundWinner(
                game.player1,
                game.player2,
                game.player1Moves[i].element,
                game.player2Moves[i].element
            );

            if (roundWinner == game.player1) {
                game.player1Wins++;
            } else if (roundWinner == game.player2) {
                game.player2Wins++;
            }

            emit RoundResult(gameId, i, roundWinner);

            // Check if we have a winner
            if (game.player1Wins == ROUNDS_TO_WIN) {
                endGame(gameId, game.player1);
                return;
            } else if (game.player2Wins == ROUNDS_TO_WIN) {
                endGame(gameId, game.player2);
                return;
            }
        }

        // If we get here and no one has won, it's a tie
        if (game.player1Wins == game.player2Wins) {
            refundPlayers(gameId);
        } else {
            // Winner is the one with more wins
            endGame(gameId, game.player1Wins > game.player2Wins ? game.player1 : game.player2);
        }
    }

    // Internal function to determine round winner
    function determineRoundWinner(
        address player1,
        address player2,
        Element element1,
        Element element2
    ) internal pure returns (address) {
        if (element1 == element2) {
            return address(0); // Tie
        }

        // Element relationships:
        // Fire beats Air
        // Water beats Fire
        // Earth beats Water
        // Air beats Earth
        
        bool player1Wins = (
            (element1 == Element.Fire && element2 == Element.Air) ||
            (element1 == Element.Water && element2 == Element.Fire) ||
            (element1 == Element.Earth && element2 == Element.Water) ||
            (element1 == Element.Air && element2 == Element.Earth)
        );

        return player1Wins ? player1 : player2;
    }

    // Internal function to end the game
    function endGame(uint256 gameId, address winner) internal {
        Game storage game = games[gameId];
        game.state = GameState.Finished;
        
        uint256 fee = (game.totalPrize * PLATFORM_FEE_PERCENTAGE) / 100;
        uint256 winnerPrize = game.totalPrize - fee;
        
        // Transfer prize to winner
        (bool success, ) = winner.call{value: winnerPrize}("");
        require(success, "Prize transfer failed");
        
        // Transfer fee to contract owner
        (success, ) = owner().call{value: fee}("");
        require(success, "Fee transfer failed");
        
        emit GameFinished(gameId, winner, winnerPrize);
    }

    // Internal function to refund players in case of a tie
    function refundPlayers(uint256 gameId) internal {
        Game storage game = games[gameId];
        game.state = GameState.Finished;
        
        // Return stakes to both players
        (bool success1, ) = game.player1.call{value: game.stake}("");
        require(success1, "Player 1 refund failed");
        
        (bool success2, ) = game.player2.call{value: game.stake}("");
        require(success2, "Player 2 refund failed");
        
        emit GameFinished(gameId, address(0), 0);
    }

    // Timeout handling
    function claimTimeout(uint256 gameId) external whenNotPaused {
        Game storage game = games[gameId];
        require(game.state == GameState.MovesCommitted, "Not in reveal phase");
        require(block.timestamp > game.lastActionTimestamp + REVEAL_TIMEOUT, "Timeout not reached");
        
        // If neither player revealed, refund both
        if (!game.player1Moves[0].isRevealed && !game.player2Moves[0].isRevealed) {
            refundPlayers(gameId);
        } else if (!game.player1Moves[0].isRevealed) {
            // If player 1 didn't reveal, player 2 wins
            endGame(gameId, game.player2);
        } else {
            // If player 2 didn't reveal, player 1 wins
            endGame(gameId, game.player1);
        }
    }

    // View functions
    function getGameState(uint256 gameId) external view returns (
        address player1,
        address player2,
        uint256 stake,
        GameState state,
        uint256 player1Wins,
        uint256 player2Wins
    ) {
        Game storage game = games[gameId];
        return (
            game.player1,
            game.player2,
            game.stake,
            game.state,
            game.player1Wins,
            game.player2Wins
        );
    }

    // Admin functions
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
} 