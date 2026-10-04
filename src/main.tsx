import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './themes.css';
import './style.css';
// Huawei's browser/WebView ignores `user-select: none`, so long-pressing the
// timer pad still selects text. Block it at the event level — `selectstart` is
// cancelable there — and clear any selection that slips through on pointerdown.
// Inputs keep native selection, matching the CSS carve-out.
const editable = (e: Event) =>
  (e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable]');
document.addEventListener('selectstart', (e) => {
  if (!editable(e)) e.preventDefault();
});
document.addEventListener('pointerdown', (e) => {
  if (!editable(e)) window.getSelection()?.removeAllRanges();
});
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
