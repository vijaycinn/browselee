// TODO: ext-widget-ui will replace this with the full React widget UI.
import React from 'react';
import { createRoot } from 'react-dom/client';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<div>Browselee loading…</div>);
}
