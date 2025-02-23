// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract BlockDuel is ReentrancyGuard, Pausable, Ownable {
    // Constants
    uint256 public constant GAME_FEE_PERCENTAGE = 2; // 2% fee
    uint256 public constant UNITS_PER_PLAYER = 3;
    uint256 public constant REVEAL_TIMEOUT = 5 minutes;
    
    // Structs
    struct BattleUnit {
        uint256 health;
        uint256 attack;
        uint256 defense;
        uint256 energy;
        bool isAlive;
    }

    struct Game {
        address player1;
        address player2;
        uint256 stake;
        uint256 totalPrize;
        GameState state;
        uint256 currentRound;
        mapping(uint256 => bytes32) moveCommitments;
        mapping(uint256 => Move) revealedMoves;
        uint256 lastActionTimestamp;
        BattleUnit[UNITS_PER_PLAYER] player1Units;
        BattleUnit[UNITS_PER_PLAYER] player2Units;
        bool isInitialized;
    }

    enum GameState {
        Created,
        Started,
        CommitPhase,
        RevealPhase,
        Finished
    }

    enum MoveType {
        Attack,
        Defend,
        Bluff
    }

    struct Move {
        MoveType moveType;
        uint256 targetUnit;
        uint256 sourceUnit;
        uint256 energyCost;
        bool isRevealed;
    }

    // State variables
    mapping(uint256 => Game) public games;
    uint256 public nextGameId;
    
    // Events
    event GameCreated(uint256 indexed gameId, address indexed player1, uint256 stake);
    event PlayerJoined(uint256 indexed gameId, address indexed player2);
    event MoveCommitted(uint256 indexed gameId, address indexed player);
    event MoveRevealed(uint256 indexed gameId, address indexed player, MoveType moveType);
    event GameFinished(uint256 indexed gameId, address indexed winner, uint256 prize);
    event UnitDamaged(uint256 indexed gameId, uint256 unitId, uint256 newHealth);

    constructor() {
        _transferOwnership(msg.sender);
    }

    // Game creation
    function createGame() external payable whenNotPaused nonReentrant returns (uint256) {
        require(msg.value > 0, "Stake must be greater than 0");
        
        uint256 gameId = nextGameId++;
        Game storage game = games[gameId];
        
        game.player1 = msg.sender;
        game.stake = msg.value;
        game.state = GameState.Created;
        game.isInitialized = true;
        
        // Initialize player 1's units
        for (uint256 i = 0; i < UNITS_PER_PLAYER; i++) {
            game.player1Units[i] = BattleUnit({
                health: 100,
                attack: 20,
                defense: 10,
                energy: 100,
                isAlive: true
            });
        }
        
        emit GameCreated(gameId, msg.sender, msg.value);
        return gameId;
    }

    // Join game
    function joinGame(uint256 gameId) external payable whenNotPaused nonReentrant {
        Game storage game = games[gameId];
        require(game.isInitialized, "Game does not exist");
        require(game.state == GameState.Created, "Game already started");
        require(msg.sender != game.player1, "Cannot join your own game");
        require(msg.value == game.stake, "Must match the stake amount");

        game.player2 = msg.sender;
        game.totalPrize = game.stake * 2;
        game.state = GameState.CommitPhase;
        
        // Initialize player 2's units
        for (uint256 i = 0; i < UNITS_PER_PLAYER; i++) {
            game.player2Units[i] = BattleUnit({
                health: 100,
                attack: 20,
                defense: 10,
                energy: 100,
                isAlive: true
            });
        }

        game.lastActionTimestamp = block.timestamp;
        emit PlayerJoined(gameId, msg.sender);
    }

    // Commit move
    function commitMove(uint256 gameId, bytes32 moveHash) external whenNotPaused {
        Game storage game = games[gameId];
        require(game.state == GameState.CommitPhase, "Not in commit phase");
        require(msg.sender == game.player1 || msg.sender == game.player2, "Not a player");
        
        uint256 playerIndex = msg.sender == game.player1 ? 0 : 1;
        require(game.moveCommitments[playerIndex] == bytes32(0), "Move already committed");
        
        game.moveCommitments[playerIndex] = moveHash;
        emit MoveCommitted(gameId, msg.sender);

        // If both players have committed, move to reveal phase
        if (game.moveCommitments[0] != bytes32(0) && game.moveCommitments[1] != bytes32(0)) {
            game.state = GameState.RevealPhase;
            game.lastActionTimestamp = block.timestamp;
        }
    }

    // Reveal move
    function revealMove(
        uint256 gameId,
        MoveType moveType,
        uint256 targetUnit,
        uint256 sourceUnit,
        uint256 energyCost,
        bytes32 salt
    ) external whenNotPaused {
        Game storage game = games[gameId];
        require(game.state == GameState.RevealPhase, "Not in reveal phase");
        require(msg.sender == game.player1 || msg.sender == game.player2, "Not a player");
        
        uint256 playerIndex = msg.sender == game.player1 ? 0 : 1;
        require(!game.revealedMoves[playerIndex].isRevealed, "Move already revealed");

        // Verify the move matches the commitment
        bytes32 moveHash = keccak256(abi.encodePacked(moveType, targetUnit, sourceUnit, energyCost, salt));
        require(moveHash == game.moveCommitments[playerIndex], "Invalid move revelation");

        // Store the revealed move
        game.revealedMoves[playerIndex] = Move({
            moveType: moveType,
            targetUnit: targetUnit,
            sourceUnit: sourceUnit,
            energyCost: energyCost,
            isRevealed: true
        });

        emit MoveRevealed(gameId, msg.sender, moveType);

        // If both moves are revealed, resolve the round
        if (game.revealedMoves[0].isRevealed && game.revealedMoves[1].isRevealed) {
            _resolveRound(gameId);
        }
    }

    // Internal function to resolve a round
    function _resolveRound(uint256 gameId) internal {
        Game storage game = games[gameId];
        
        // Process moves and update game state
        _processMoves(game);
        
        // Check for game end condition
        bool player1Lost = true;
        bool player2Lost = true;
        
        for (uint256 i = 0; i < UNITS_PER_PLAYER; i++) {
            if (game.player1Units[i].isAlive) player1Lost = false;
            if (game.player2Units[i].isAlive) player2Lost = false;
        }
        
        if (player1Lost || player2Lost) {
            _endGame(gameId, player1Lost ? game.player2 : game.player1);
        } else {
            // Reset for next round
            delete game.moveCommitments[0];
            delete game.moveCommitments[1];
            delete game.revealedMoves[0];
            delete game.revealedMoves[1];
            game.state = GameState.CommitPhase;
            game.currentRound++;
            game.lastActionTimestamp = block.timestamp;
        }
    }

    // Internal function to process moves
    function _processMoves(Game storage game) internal {
        Move storage move1 = game.revealedMoves[0];
        Move storage move2 = game.revealedMoves[1];
        
        // Process player 1's move
        if (move1.moveType == MoveType.Attack) {
            _processAttack(game.player1Units[move1.sourceUnit], game.player2Units[move1.targetUnit]);
        }
        
        // Process player 2's move
        if (move2.moveType == MoveType.Attack) {
            _processAttack(game.player2Units[move2.sourceUnit], game.player1Units[move2.targetUnit]);
        }
    }

    // Internal function to process an attack
    function _processAttack(BattleUnit storage attacker, BattleUnit storage defender) internal {
        if (!attacker.isAlive || !defender.isAlive) return;
        
        uint256 damage = attacker.attack;
        if (damage >= defender.health) {
            defender.health = 0;
            defender.isAlive = false;
        } else {
            defender.health -= damage;
        }
    }

    // Internal function to end the game
    function _endGame(uint256 gameId, address winner) internal {
        Game storage game = games[gameId];
        game.state = GameState.Finished;
        
        uint256 fee = (game.totalPrize * GAME_FEE_PERCENTAGE) / 100;
        uint256 winnerPrize = game.totalPrize - fee;
        
        // Transfer prize to winner
        (bool success, ) = winner.call{value: winnerPrize}("");
        require(success, "Prize transfer failed");
        
        // Transfer fee to contract owner
        (success, ) = owner().call{value: fee}("");
        require(success, "Fee transfer failed");
        
        emit GameFinished(gameId, winner, winnerPrize);
    }

    // Timeout handling
    function claimTimeout(uint256 gameId) external whenNotPaused {
        Game storage game = games[gameId];
        require(game.state == GameState.RevealPhase, "Not in reveal phase");
        require(block.timestamp > game.lastActionTimestamp + REVEAL_TIMEOUT, "Timeout not reached");
        
        // Determine winner based on who hasn't revealed
        if (!game.revealedMoves[0].isRevealed && !game.revealedMoves[1].isRevealed) {
            // If neither player revealed, return stakes
            _refundPlayers(gameId);
        } else if (!game.revealedMoves[0].isRevealed) {
            _endGame(gameId, game.player2);
        } else {
            _endGame(gameId, game.player1);
        }
    }

    // Internal function to refund players
    function _refundPlayers(uint256 gameId) internal {
        Game storage game = games[gameId];
        game.state = GameState.Finished;
        
        (bool success1, ) = game.player1.call{value: game.stake}("");
        require(success1, "Player 1 refund failed");
        
        (bool success2, ) = game.player2.call{value: game.stake}("");
        require(success2, "Player 2 refund failed");
    }

    // View functions
    function getGameState(uint256 gameId) external view returns (
        address player1,
        address player2,
        uint256 stake,
        GameState state,
        uint256 currentRound
    ) {
        Game storage game = games[gameId];
        return (
            game.player1,
            game.player2,
            game.stake,
            game.state,
            game.currentRound
        );
    }

    function getUnitStats(uint256 gameId, bool isPlayer1, uint256 unitId) external view returns (
        uint256 health,
        uint256 attack,
        uint256 defense,
        uint256 energy,
        bool isAlive
    ) {
        Game storage game = games[gameId];
        BattleUnit storage unit = isPlayer1 ? game.player1Units[unitId] : game.player2Units[unitId];
        return (
            unit.health,
            unit.attack,
            unit.defense,
            unit.energy,
            unit.isAlive
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