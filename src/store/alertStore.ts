import { create } from 'zustand';
import { PriceAlert } from '../types';

interface AlertState {
  priceAlerts: Map<string, PriceAlert[]>
  updatePriceAlert: (symbol: string, alerts: PriceAlert[]) => void
  removePriceAlert: (symbol: string) => void
}

export const useAlertStore = create<AlertState>()((set) => ({
  priceAlerts: new Map(),
  
  updatePriceAlert: (symbol, alerts) => set((state) => {
    const newPriceAlerts = new Map(state.priceAlerts);
    newPriceAlerts.set(symbol, alerts);
    return { priceAlerts: newPriceAlerts };
  }),

  removePriceAlert: (symbol) => set((state) => {
    const newPriceAlerts = new Map(state.priceAlerts);
    newPriceAlerts.delete(symbol);
    return { priceAlerts: newPriceAlerts };
  })
})); 