import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.js';
// PROTOTYPE — throwaway (branch prototype/daily-work-interface): dev-only route.
import { DailyWorkPrototype } from './prototype/daily-work/DailyWorkPrototype.js';
import { DialogProvider } from './lib/dialog.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, refetchOnWindowFocus: false },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <DialogProvider>
          {import.meta.env.DEV && window.location.pathname.startsWith('/prototype/daily-work') ? (
            <DailyWorkPrototype />
          ) : (
            <App />
          )}
        </DialogProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
