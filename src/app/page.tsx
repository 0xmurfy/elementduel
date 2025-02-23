'use client';

import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { BLOCKDUEL_ADDRESS, BLOCKDUEL_ABI } from '../config/contracts';

export default function Home() {
  const [account, setAccount] = useState<string>('');
  const [gameId, setGameId] = useState<string>('');
  const [stake, setStake] = useState<string>('0.01');
  const [gameState, setGameState] = useState<any>(null);
  const [units, setUnits] = useState<any[]>([]);
  const [loading, setLoading] = useState<{[key: string]: boolean}>({
    wallet: false,
    create: false,
    join: false,
    fetch: false
  });
  const [error, setError] = useState<string>('');

  const connectWallet = async () => {
    if (typeof window.ethereum !== 'undefined') {
      setLoading(prev => ({ ...prev, wallet: true }));
      try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
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
      const provider = getProvider();
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(BLOCKDUEL_ADDRESS, BLOCKDUEL_ABI, signer);
      
      const tx = await contract.createGame({
        value: ethers.parseEther(stake)
      });
      
      await tx.wait();
      const newGameId = await contract.nextGameId();
      setGameId((newGameId - 1n).toString());
      setError('');
    } catch (error: any) {
      console.error('Error creating game:', error);
      setError(error.message || 'Error creating game. Please try again.');
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
      const contract = new ethers.Contract(BLOCKDUEL_ADDRESS, BLOCKDUEL_ABI, signer);
      
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

  const fetchGameState = async () => {
    if (!gameId) return;
    setLoading(prev => ({ ...prev, fetch: true }));
    
    try {
      const provider = getProvider();
      const contract = new ethers.Contract(BLOCKDUEL_ADDRESS, BLOCKDUEL_ABI, provider);
      
      const state = await contract.getGameState(gameId);
      setGameState(state);
      
      // Fetch units for both players
      const units = [];
      for (let i = 0; i < 3; i++) {
        const player1Unit = await contract.getUnitStats(gameId, true, i);
        const player2Unit = await contract.getUnitStats(gameId, false, i);
        units.push({ player1: player1Unit, player2: player2Unit });
      }
      setUnits(units);
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
      fetchGameState();
    }
  }, [gameId]);

  return (
    <main className="min-h-screen p-8 bg-gray-50">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900">BlockDuel</h1>
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
            {error}
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
                disabled={loading.join}
              />
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
                <p className="font-semibold text-gray-700">Round</p>
                <p className="text-lg font-medium">{gameState.currentRound.toString()}</p>
              </div>
            </div>

            {units.length > 0 && (
              <div className="mt-8">
                <h3 className="text-xl font-bold mb-4 text-gray-900">Battle Units</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {units.map((unit, index) => (
                    <div key={index} className="border border-gray-200 p-4 rounded-lg">
                      <p className="font-bold text-gray-900 mb-3">Unit {index + 1}</p>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm font-semibold text-gray-700">Player 1</p>
                          <div className="space-y-1">
                            <div className="flex justify-between">
                              <span className="text-gray-600">HP:</span>
                              <span className="font-medium">{unit.player1.health.toString()}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">ATK:</span>
                              <span className="font-medium">{unit.player1.attack.toString()}</span>
                            </div>
                          </div>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-700">Player 2</p>
                          <div className="space-y-1">
                            <div className="flex justify-between">
                              <span className="text-gray-600">HP:</span>
                              <span className="font-medium">{unit.player2.health.toString()}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">ATK:</span>
                              <span className="font-medium">{unit.player2.attack.toString()}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
} 