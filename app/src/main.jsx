import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import { SessionProvider } from './lib/session.jsx';
import { ToastProvider } from './ui.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SessionProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </SessionProvider>
  </React.StrictMode>,
);
