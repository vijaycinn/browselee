import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Browselee',
  description: 'Chat or talk to any webpage. Powered by Azure AI Foundry Realtime.',
  version: '0.1.0',
  action: {
    default_title: 'Open Browselee',
    default_icon: { '128': 'icon-128.png' },
  },
  background: { service_worker: 'src/background.ts', type: 'module' },
  permissions: ['activeTab', 'scripting', 'storage', 'offscreen', 'tabs'],
  host_permissions: ['<all_urls>'],
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  web_accessible_resources: [
    {
      resources: ['src/widget/index.html', 'assets/*', 'icon-128.png'],
      matches: ['<all_urls>'],
    },
  ],
  icons: { '128': 'icon-128.png' },
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'self'; connect-src 'self' https://* http://* wss://* https://localhost:* http://localhost:*",
  },
});
