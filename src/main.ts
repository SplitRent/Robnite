import '@fontsource-variable/inter/wght.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import './styles/main.css';
import { App } from './ui/App';
import { webglAvailable } from './rendering/RenderContext';
import { logger } from './core/log';

const log = logger('Boot');

function fatal(title: string, message: string): void {
  const root = document.getElementById('app') ?? document.body;
  document.getElementById('boot-splash')?.remove();
  const el = document.createElement('div');
  el.className = 'fatal';
  const h1 = document.createElement('h1');
  h1.textContent = title;
  const p = document.createElement('p');
  p.textContent = message;
  el.append(h1, p);
  root.appendChild(el);
}

/** Dev tools are enabled in dev builds or with ?dev=1. */
const DEV_MODE = import.meta.env.DEV || new URLSearchParams(location.search).has('dev');

async function start(): Promise<void> {
  if (!webglAvailable()) {
    fatal('Robnite requires WebGL.', 'Please use a modern browser with WebGL enabled (Chrome, Edge, Firefox or Safari), and make sure hardware acceleration is turned on.');
    return;
  }
  const root = document.getElementById('app');
  if (!root) return;
  try {
    const app = new App(root, DEV_MODE);
    document.getElementById('boot-splash')?.remove();
    await app.boot();
    if (DEV_MODE) (window as unknown as { robnite: App }).robnite = app;
  } catch (e) {
    log.error('fatal startup error', e);
    fatal('Robnite could not start.', `An unexpected error occurred during startup: ${e instanceof Error ? e.message : String(e)}. Try reloading the page.`);
  }
}

window.addEventListener('error', (e) => log.error('uncaught error', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => log.error('unhandled promise rejection', e.reason));

void start();
