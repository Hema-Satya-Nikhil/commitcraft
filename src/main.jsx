import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function FoundationPlaceholder() {
  return null;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <FoundationPlaceholder />
  </StrictMode>,
);
