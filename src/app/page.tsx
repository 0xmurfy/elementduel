'use client';

import { useState, useEffect, Suspense } from 'react';
import { ethers } from 'ethers';
import { useSearchParams } from 'next/navigation';
import { ELEMENTALDUEL_ADDRESS, ELEMENTALDUEL_ABI } from '../config/contracts';

const BASE_SEPOLIA_CHAIN_ID = '0x14a34'; // 84532 in hex
const BASE_SEPOLIA_PARAMS = {
  chainId: BASE_SEPOLIA_CHAIN_ID,
  chainName: 'Base Sepolia',
  nativeCurrency: {
    name: 'Sepolia Ether',
    symbol: 'ETH',
    decimals: 18
  },
  rpcUrls: ['https://sepolia.base.org'],
  blockExplorerUrls: ['https://sepolia.basescan.org/']
};

enum Element {
  Fire,    // Beats Air
  Water,   // Beats Fire
  Earth,   // Beats Water
  Air      // Beats Earth
}

enum GamePhase {
  Created,
  MovesCommitted,
  MovesRevealed,
  Finished
}

interface Move {
  element: Element;
  salt?: string;
  hash?: string;
}

interface GameState {
  player1: string;
  player2: string;
  stake: bigint;
  state: GamePhase;
  player1Wins: bigint;
  player2Wins: bigint;
}

function GameComponent() {
  const searchParams = useSearchParams();
  const [account, setAccount] = useState<string>('');
  const [gameId, setGameId] = useState<string>('');
  const [stake, setStake] = useState<string>('0.01');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState<{[key: string]: boolean}>({
    wallet: false,
    create: false,
    join: false,
    commit: false,
    reveal: false,
    fetch: false
  });
  const [error, setError] = useState<string>('');
  const [selectedMoves, setSelectedMoves] = useState<Move[]>([
    { element: Element.Fire },
    { element: Element.Fire },
    { element: Element.Fire }
  ]);
  const [isPlayer1, setIsPlayer1] = useState<boolean>(false);
  const [salts, setSalts] = useState<string[]>([]);
  const [moveHashes, setMoveHashes] = useState<string[]>([]);
  const [shareUrl, setShareUrl] = useState<string>('');

  const checkNetwork = async () => {
    if (window.ethereum) {
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
        setError('Please switch to Base Sepolia network');
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: BASE_SEPOLIA_CHAIN_ID }],
          });
        } catch (switchError: any) {
          if (switchError.code === 4902) {
            try {
              await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [BASE_SEPOLIA_PARAMS],
              });
            } catch (addError) {
              console.error('Error adding Base Sepolia network:', addError);
              setError('Failed to add Base Sepolia network. Please add it manually.');
            }
          }
        }
      }
    }
  };

  const connectWallet = async () => {
    if (typeof window.ethereum !== 'undefined') {
      setLoading(prev => ({ ...prev, wallet: true }));
      try {
        await checkNetwork();
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[];
        setAccount(accounts[0]);
        setError('');
      } catch (error) {
        console.error('Error connecting wallet:', error);
        setError('Failed to connect wallet. Please try again.');
      } finally {
        setLoading(prev => ({ ...prev, wallet: false }));
      }
    } else {
      setError('Please install MetaMask!');
    }
  };

  const getProvider = () => {
    if (!window.ethereum) throw new Error('Please install MetaMask!');
    return new ethers.BrowserProvider(window.ethereum);
  };

  const createGame = async () => {
    if (!account) return setError('Please connect your wallet first');
    setLoading(prev => ({ ...prev, create: true }));
    setError('');
    
    try {
      await checkNetwork();
      const provider = getProvider();
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(ELEMENTALDUEL_ADDRESS, ELEMENTALDUEL_ABI, signer);
      
      const tx = await contract.createGame({
        value: ethers.parseEther(stake)
      });
      
      await tx.wait();
      
      // Get the latest game ID
      const nextGameId = await contract.nextGameId();
      const currentGameId = Number(nextGameId) - 1;
      setGameId(currentGameId.toString());
      
      setError('');
    } catch (error: any) {
      console.error('Error creating game:', error);
      if (error.code === 'INSUFFICIENT_FUNDS') {
        setError('Insufficient Base Sepolia ETH. Get some from the faucet: https://www.coinbase.com/faucets/base-sepolia-faucet');
      } else {
        setError(error.message || 'Error creating game. Please try again.');
      }
    } finally {
      setLoading(prev => ({ ...prev, create: false }));
    }
  };

  const joinGame = async () => {
    if (!account || !gameId) return setError('Please connect wallet and enter game ID');
    setLoading(prev => ({ ...prev, join: true }));
    setError('');
    
    try {
      const provider = getProvider();
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(ELEMENTALDUEL_ADDRESS, ELEMENTALDUEL_ABI, signer);
      
      const game = await contract.getGameState(gameId);
      const tx = await contract.joinGame(gameId, {
        value: game.stake
      });
      
      await tx.wait();
      await fetchGameState();
      setError('');
    } catch (error: any) {
      console.error('Error joining game:', error);
      setError(error.message || 'Error joining game. Please try again.');
    } finally {
      setLoading(prev => ({ ...prev, join: false }));
    }
  };

  const generateSalt = () => {
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    return '0x' + Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const hashMove = async (element: Element, salt: string) => {
    const encoded = ethers.solidityPacked(
      ['uint8', 'bytes32'],
      [element, salt]
    );
    return ethers.keccak256(encoded);
  };

  const commitMoves = async () => {
    if (!account || !gameId) return setError('Please connect wallet and enter game ID');
    setLoading(prev => ({ ...prev, commit: true }));
    setError('');
    
    try {
      // Generate salts and hashes for all moves
      const newSalts = selectedMoves.map(() => generateSalt());
      const newHashes = await Promise.all(
        selectedMoves.map((move, i) => hashMove(move.element, newSalts[i]))
      );
      
      setSalts(newSalts);
      setMoveHashes(newHashes);
      
      const provider = getProvider();
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(ELEMENTALDUEL_ADDRESS, ELEMENTALDUEL_ABI, signer);
      
      const tx = await contract.commitMoves(gameId, newHashes);
      await tx.wait();
      
      await fetchGameState();
      setError('');
    } catch (error: any) {
      console.error('Error committing moves:', error);
      setError(error.message || 'Error committing moves. Please try again.');
    } finally {
      setLoading(prev => ({ ...prev, commit: false }));
    }
  };

  const revealMoves = async () => {
    if (!account || !gameId || !salts.length || !moveHashes.length) {
      return setError('Missing move information');
    }
    setLoading(prev => ({ ...prev, reveal: true }));
    setError('');
    
    try {
      const provider = getProvider();
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(ELEMENTALDUEL_ADDRESS, ELEMENTALDUEL_ABI, signer);
      
      const elements = selectedMoves.map(move => move.element);
      const tx = await contract.revealMoves(gameId, elements, salts);
      
      await tx.wait();
      await fetchGameState();
      setError('');
    } catch (error: any) {
      console.error('Error revealing moves:', error);
      setError(error.message || 'Error revealing moves. Please try again.');
    } finally {
      setLoading(prev => ({ ...prev, reveal: false }));
    }
  };

  const fetchGameState = async () => {
    if (!gameId) return;
    setLoading(prev => ({ ...prev, fetch: true }));
    
    try {
      const provider = getProvider();
      const contract = new ethers.Contract(ELEMENTALDUEL_ADDRESS, ELEMENTALDUEL_ABI, provider);
      
      const state = await contract.getGameState(gameId);
      setGameState(state);
      setIsPlayer1(account.toLowerCase() === state.player1.toLowerCase());
      setError('');
    } catch (error: any) {
      console.error('Error fetching game state:', error);
      setError(error.message || 'Error fetching game state. Please try again.');
    } finally {
      setLoading(prev => ({ ...prev, fetch: false }));
    }
  };

  useEffect(() => {
    if (gameId) {
      const fetchData = async () => {
        await fetchGameState();
      };
      fetchData();
    }
  }, [gameId, fetchGameState]);

  useEffect(() => {
    const ethereum = window.ethereum;
    if (ethereum && ethereum.on) {
      const handleChainChange = (...args: unknown[]) => {
        const chainId = args[0] as string;
        if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
          setError('Please switch to Base Sepolia network');
        } else {
          setError('');
        }
      };
      
      ethereum.on('chainChanged', handleChainChange);
      
      return () => {
        if (ethereum.removeListener) {
          ethereum.removeListener('chainChanged', handleChainChange);
        }
      };
    }
  }, []);

  useEffect(() => {
    // Check for game ID in URL
    const urlGameId = searchParams.get('gameId');
    if (urlGameId) {
      setGameId(urlGameId);
    }
  }, [searchParams]);

  useEffect(() => {
    // Update share URL when game is created
    if (gameId) {
      const baseUrl = window.location.origin;
      const newShareUrl = `${baseUrl}?gameId=${gameId}`;
      setShareUrl(newShareUrl);
    }
  }, [gameId]);

  const renderMoveSelection = () => {
    if (!gameState || gameState.state === GamePhase.Finished) return null;

    return (
      <div className="mt-8 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h2 className="text-2xl font-bold mb-6 text-gray-900">Select Your Moves</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            {[0, 1, 2].map((index) => (
              <div key={index} className="space-y-2">
                <label className="block text-gray-700 mb-2">Move {index + 1}</label>
                <select
                  value={selectedMoves[index].element}
                  onChange={(e) => {
                    const newMoves = [...selectedMoves];
                    newMoves[index] = { element: parseInt(e.target.value) };
                    setSelectedMoves(newMoves);
                  }}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={Element.Fire}>Fire (Beats Air)</option>
                  <option value={Element.Water}>Water (Beats Fire)</option>
                  <option value={Element.Earth}>Earth (Beats Water)</option>
                  <option value={Element.Air}>Air (Beats Earth)</option>
                </select>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="font-medium text-gray-700">Current Phase:</p>
              <p className="text-lg font-bold text-blue-600">
                {GamePhase[gameState.state]}
              </p>
              {gameState.state > GamePhase.Created && (
                <div className="mt-2">
                  <p className="font-medium text-gray-700">Score:</p>
                  <p className="text-sm">
                    Player 1: {gameState.player1Wins.toString()} - 
                    Player 2: {gameState.player2Wins.toString()}
                  </p>
                </div>
              )}
            </div>

            {gameState.state === GamePhase.Created && (
              <button
                onClick={commitMoves}
                disabled={loading.commit}
                className="w-full bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {loading.commit ? (
                  <>
                    <span className="animate-spin mr-2">⚡</span>
                    Committing Moves...
                  </>
                ) : (
                  'Commit Moves'
                )}
              </button>
            )}

            {gameState.state === GamePhase.MovesCommitted && moveHashes.length > 0 && (
              <button
                onClick={revealMoves}
                disabled={loading.reveal}
                className="w-full bg-purple-500 text-white px-4 py-2 rounded-lg hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {loading.reveal ? (
                  <>
                    <span className="animate-spin mr-2">⚡</span>
                    Revealing Moves...
                  </>
                ) : (
                  'Reveal Moves'
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderShareSection = () => {
    if (!gameId || !gameState || gameState.state !== GamePhase.Created) return null;

    return (
      <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
        <h3 className="text-lg font-semibold text-blue-900 mb-2">Share with Opponent</h3>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={shareUrl}
            readOnly
            className="flex-1 px-3 py-2 border border-blue-200 rounded-lg bg-white text-sm"
          />
          <button
            onClick={() => {
              navigator.clipboard.writeText(shareUrl);
              // You could add a toast notification here
            }}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm"
          >
            Copy
          </button>
        </div>
      </div>
    );
  };

  return (
    <main className="min-h-screen p-8 bg-gray-50">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900">Elemental Duel</h1>
          {!account ? (
            <button
              onClick={connectWallet}
              disabled={loading.wallet}
              className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            >
              {loading.wallet ? (
                <>
                  <span className="animate-spin mr-2">⚡</span>
                  Connecting...
                </>
              ) : (
                'Connect Wallet'
              )}
            </button>
          ) : (
            <div className="flex items-center space-x-2 bg-gray-100 px-4 py-2 rounded-lg">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <p className="text-gray-600 font-mono text-sm">{account.slice(0, 6)}...{account.slice(-4)}</p>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error.includes('faucet') ? (
              <div>
                <p>{error.split('https')[0]}</p>
                <a 
                  href="https://www.coinbase.com/faucets/base-sepolia-faucet" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 underline"
                >
                  Get Base Sepolia ETH from faucet
                </a>
              </div>
            ) : error.includes('add it manually') ? (
              <div>
                <p>{error}</p>
                <div className="mt-2 text-sm">
                  <p>Network Name: Base Sepolia</p>
                  <p>RPC URL: https://sepolia.base.org</p>
                  <p>Chain ID: 84532 (0x14a34)</p>
                  <p>Currency Symbol: ETH</p>
                  <p>Block Explorer: https://sepolia.basescan.org/</p>
                </div>
              </div>
            ) : (
              error
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-2xl font-bold mb-4 text-gray-900">Create Game</h2>
            <div className="mb-4">
              <label className="block text-gray-700 mb-2">Stake (ETH)</label>
              <input
                type="number"
                value={stake}
                onChange={(e) => setStake(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                step="0.01"
                disabled={loading.create}
              />
            </div>
            <button
              onClick={createGame}
              disabled={loading.create || !account}
              className="w-full bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {loading.create ? (
                <>
                  <span className="animate-spin mr-2">⚡</span>
                  Creating...
                </>
              ) : (
                'Create Game'
              )}
            </button>
            {renderShareSection()}
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-2xl font-bold mb-4 text-gray-900">Join Game</h2>
            <div className="mb-4">
              <label className="block text-gray-700 mb-2">Game ID</label>
              <input
                type="number"
                value={gameId}
                onChange={(e) => setGameId(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={loading.join || searchParams.has('gameId')}
              />
              {searchParams.has('gameId') && (
                <p className="mt-2 text-sm text-gray-600">Game ID loaded from URL</p>
              )}
            </div>
            <button
              onClick={joinGame}
              disabled={loading.join || !account || !gameId}
              className="w-full bg-purple-500 text-white px-4 py-2 rounded-lg hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {loading.join ? (
                <>
                  <span className="animate-spin mr-2">⚡</span>
                  Joining...
                </>
              ) : (
                'Join Game'
              )}
            </button>
          </div>
        </div>

        {loading.fetch ? (
          <div className="mt-8 bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center justify-center">
            <span className="animate-spin mr-2">⚡</span>
            Loading game state...
          </div>
        ) : gameState && (
          <div className="mt-8 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-2xl font-bold mb-6 text-gray-900">Game State</h2>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <p className="font-semibold text-gray-700">Player 1</p>
                <p className="font-mono text-sm text-gray-600">{gameState.player1}</p>
              </div>
              <div className="space-y-2">
                <p className="font-semibold text-gray-700">Player 2</p>
                <p className="font-mono text-sm text-gray-600">{gameState.player2 || 'Waiting for player...'}</p>
              </div>
              <div className="space-y-2">
                <p className="font-semibold text-gray-700">Stake</p>
                <p className="text-lg font-medium">{ethers.formatEther(gameState.stake)} ETH</p>
              </div>
              <div className="space-y-2">
                <p className="font-semibold text-gray-700">Game Phase</p>
                <p className="text-lg font-medium">{GamePhase[gameState.state]}</p>
              </div>
              {gameState.state > GamePhase.Created && (
                <>
                  <div className="space-y-2">
                    <p className="font-semibold text-gray-700">Player 1 Wins</p>
                    <p className="text-lg font-medium">{gameState.player1Wins.toString()}</p>
                  </div>
                  <div className="space-y-2">
                    <p className="font-semibold text-gray-700">Player 2 Wins</p>
                    <p className="text-lg font-medium">{gameState.player2Wins.toString()}</p>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {account && gameState && renderMoveSelection()}
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <main className="min-h-screen p-8 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900">Elemental Duel</h1>
          </div>
          <div className="mt-8 bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center justify-center">
            <span className="animate-spin mr-2">⚡</span>
            Loading...
          </div>
        </div>
      </main>
    }>
      <GameComponent />
    </Suspense>
  );
}
