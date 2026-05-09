import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Redirect to dashboard if not authenticated
const token     = sessionStorage.getItem('upcart_admin_token');
const workerUrl = sessionStorage.getItem('upcart_worker_url');

if (!token || !workerUrl) {
  window.location.replace('/');
} else {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
