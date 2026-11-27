import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { FilterProvider, forgetSavedState } from './state/filters';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

const resetAndReload = { label: 'Reset saved settings and reload', run: () => { forgetSavedState(); window.location.reload(); } };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary what="the dashboard" actions={[resetAndReload]}>
      <FilterProvider><App /></FilterProvider>
    </ErrorBoundary>
  </StrictMode>,
);
