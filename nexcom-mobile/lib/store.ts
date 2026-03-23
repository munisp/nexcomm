import { create } from 'zustand';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  kycStatus: string;
  accountType: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  setToken: (token) => set({ token }),
  setLoading: (isLoading) => set({ isLoading }),
  logout: () => set({ user: null, token: null, isAuthenticated: false }),
}));

interface TradingState {
  selectedCommodity: string | null;
  selectedMarket: string;
  orderBookDepth: number;
  chartTimeframe: string;
  watchlist: string[];
  setSelectedCommodity: (commodity: string | null) => void;
  setSelectedMarket: (market: string) => void;
  setChartTimeframe: (timeframe: string) => void;
  addToWatchlist: (symbol: string) => void;
  removeFromWatchlist: (symbol: string) => void;
}

export const useTradingStore = create<TradingState>((set) => ({
  selectedCommodity: 'MAIZE',
  selectedMarket: 'SPOT',
  orderBookDepth: 10,
  chartTimeframe: '1D',
  watchlist: ['MAIZE', 'SOYBEAN', 'COCOA', 'SESAME', 'SORGHUM'],
  setSelectedCommodity: (commodity) => set({ selectedCommodity: commodity }),
  setSelectedMarket: (market) => set({ selectedMarket: market }),
  setChartTimeframe: (timeframe) => set({ chartTimeframe: timeframe }),
  addToWatchlist: (symbol) =>
    set((state) => ({
      watchlist: state.watchlist.includes(symbol)
        ? state.watchlist
        : [...state.watchlist, symbol],
    })),
  removeFromWatchlist: (symbol) =>
    set((state) => ({
      watchlist: state.watchlist.filter((s) => s !== symbol),
    })),
}));

interface AppState {
  theme: 'dark' | 'light';
  language: string;
  currency: string;
  notifications: boolean;
  biometricEnabled: boolean;
  setTheme: (theme: 'dark' | 'light') => void;
  setLanguage: (lang: string) => void;
  setCurrency: (currency: string) => void;
  toggleNotifications: () => void;
  toggleBiometric: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  theme: 'dark',
  language: 'en',
  currency: 'NGN',
  notifications: true,
  biometricEnabled: false,
  setTheme: (theme) => set({ theme }),
  setLanguage: (language) => set({ language }),
  setCurrency: (currency) => set({ currency }),
  toggleNotifications: () =>
    set((state) => ({ notifications: !state.notifications })),
  toggleBiometric: () =>
    set((state) => ({ biometricEnabled: !state.biometricEnabled })),
}));
