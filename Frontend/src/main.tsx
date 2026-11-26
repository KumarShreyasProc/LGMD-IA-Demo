import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { FilterProvider } from './state/filters';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><FilterProvider><App /></FilterProvider></StrictMode>);
