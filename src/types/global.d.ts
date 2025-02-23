import { Eip1193Provider } from 'ethers';

declare global {
  interface Window {
    ethereum?: Eip1193Provider & {
      isMetaMask?: boolean;
      on?: (...args: any[]) => void;
      removeListener?: (...args: any[]) => void;
      request: (args: { method: string; params?: any[] }) => Promise<any>;
    };
  }
} 