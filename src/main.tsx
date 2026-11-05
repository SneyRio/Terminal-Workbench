import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
// Load bundled faces before xterm measures cells; keep startup usable if an asset fails.
async function start(){
  await Promise.all(['14px','bold 14px','italic 14px','italic bold 14px'].map(style=>document.fonts.load(style+' "Accountor JetBrains Mono"'))).catch(error=>console.error('Bundled terminal font failed to load',error));
  createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
}
void start();
