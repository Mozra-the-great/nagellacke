import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

// Outermost safety net: catches crashes App itself throws while deriving
// state from corrupted data (e.g. `polishes` not being an array at all),
// before its own per-tab boundary around <main> even mounts - see #218.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
