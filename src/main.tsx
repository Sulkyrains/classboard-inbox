import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import {AppUpdate} from './pwa';
const savedTheme=localStorage.getItem('cb-theme');
if(savedTheme==='dark'||(!savedTheme&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.dataset.theme='dark';document.documentElement.style.colorScheme='dark';}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App/><AppUpdate/></React.StrictMode>);
