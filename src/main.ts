import './styles.css';
import { isAbortError, Player } from './player';
import type { EnqueuedTask, PlayerState } from './types';
import { Visualizer } from './visualizer';

type ItemStatus = 'LOADING' | 'READY' | 'PLAYING' | 'FAILED';
// RUNNING = the queue auto-advances when a track ends or is skipped.
type Mode = 'STOPPED' | 'RUNNING';

interface QueueItem {
  readonly id: string;
  readonly title: string;
  readonly task: EnqueuedTask;
  status: ItemStatus;
  message: string;
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

const root = requireElement<HTMLElement>('#app');
const list = requireElement<HTMLOListElement>('#queue-list');
const statusEl = requireElement<HTMLElement>('#status');
const playButton = requireElement<HTMLButtonElement>('#play');
const skipButton = requireElement<HTMLButtonElement>('#skip');
const stopButton = requireElement<HTMLButtonElement>('#stop');
const clearButton = requireElement<HTMLButtonElement>('#clear');
const firstAddButton = requireElement<HTMLButtonElement>('[data-action="add"]');

const player = new Player();
const visualizer = new Visualizer(
  requireElement<HTMLCanvasElement>('#visualizer'),
  player,
);

let items: QueueItem[] = [];
let mode: Mode = 'STOPPED';
let currentId: string | null = null;
let notice = '';
const elements = new Map<string, HTMLLIElement>();

const findItem = (id: string | null) => items.find((i) => i.id === id);

function removeItem(id: string): void {
  items = items.filter((item) => item.id !== id);
}

function fail(item: QueueItem, error: unknown): void {
  item.status = 'FAILED';
  item.message = error instanceof Error ? error.message : 'Unknown error';
  notice = `Could not load ${item.title}: ${item.message}.`;
}

function add(url: string, title: string): void {
  // First call happens inside this click, so the AudioContext is gesture-born.
  const task = player.enqueue(url);
  const item: QueueItem = {
    id: task.id,
    title,
    task,
    status: 'LOADING',
    message: '',
  };
  items.push(item);
  task.promise.then(
    () => {
      if (item.status === 'LOADING') item.status = 'READY';
      render();
    },
    (error: unknown) => {
      // Cancelled tasks leave the queue; real failures stay, marked.
      if (isAbortError(error)) removeItem(item.id);
      else fail(item, error);
      render();
    },
  );
}

function startNext(): void {
  const next = items.find((item) => item.status !== 'FAILED');
  if (!next) {
    mode = 'STOPPED';
    currentId = null;
    return;
  }
  currentId = next.id;
  void player.playTask(next.task);
}

function onPlayerState(state: PlayerState, error?: unknown): void {
  const current = findItem(currentId);
  if (state === 'PLAYING' && current) current.status = 'PLAYING';
  if (state === 'ERROR' && current) fail(current, error);
  if (state === 'IDLE' || state === 'ERROR') {
    if (mode === 'RUNNING') {
      // Ended or skipped: the track leaves the queue; a failed one stays.
      if (state === 'IDLE' && current) removeItem(current.id);
      startNext();
    } else {
      if (current?.status === 'PLAYING') current.status = 'READY';
      currentId = null;
    }
  }
  render();
}

function onClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLButtonElement>('button[data-action]');
  if (!button || button.disabled) return;
  const busy = player.state === 'LOADING' || player.state === 'PLAYING';
  switch (button.dataset.action) {
    case 'add':
      if (button.dataset.url && button.dataset.title) {
        add(button.dataset.url, button.dataset.title);
      }
      break;
    case 'play':
      if (mode === 'RUNNING') break;
      notice = '';
      mode = 'RUNNING';
      startNext();
      break;
    case 'skip':
      if (mode === 'RUNNING' && busy) player.stop();
      break;
    case 'stop':
      // A track still loading is cancelled by stop and drops out of the queue.
      notice = '';
      mode = 'STOPPED';
      player.stop();
      break;
    case 'clear':
      notice = '';
      mode = 'STOPPED';
      player.clearQueue();
      items = [];
      currentId = null;
      break;
    case 'cancel': {
      const id = button.closest('li')?.dataset.taskId;
      if (!id) break;
      if (id === currentId && mode === 'RUNNING') {
        player.stop(); // the IDLE handler removes it and advances
      } else {
        player.cancelTask(id);
        removeItem(id);
      }
      break;
    }
  }
  render();
}

const ITEM_LABELS: Record<Exclude<ItemStatus, 'FAILED'>, string> = {
  LOADING: 'Loading…',
  READY: 'Ready',
  PLAYING: 'Playing',
};

function createItemElement(item: QueueItem): HTMLLIElement {
  const li = document.createElement('li');
  li.dataset.taskId = item.id;
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = item.title;
  const status = document.createElement('span');
  status.className = 'status';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.dataset.action = 'cancel';
  cancel.textContent = 'Cancel';
  cancel.setAttribute('aria-label', `Cancel ${item.title}`);
  li.append(title, status, cancel);
  return li;
}

function setText(element: Element | null, text: string): void {
  if (element && element.textContent !== text) element.textContent = text;
}

function updateItemElement(li: HTMLLIElement, item: QueueItem): void {
  li.dataset.status = item.status;
  if (item.status === 'PLAYING') li.setAttribute('aria-current', 'true');
  else li.removeAttribute('aria-current');
  const label =
    item.status === 'FAILED'
      ? `Failed: ${item.message}`
      : ITEM_LABELS[item.status];
  setText(li.querySelector('.status'), label);
}

// Keyed by task id: existing <li> elements are updated and reordered in
// place, never rebuilt.
function syncList(): void {
  const live = new Set(items.map((item) => item.id));
  for (const [id, li] of elements) {
    if (live.has(id)) continue;
    li.remove();
    elements.delete(id);
  }
  items.forEach((item, index) => {
    let li = elements.get(item.id);
    if (!li) {
      li = createItemElement(item);
      elements.set(item.id, li);
    }
    updateItemElement(li, item);
    if (list.children[index] !== li) {
      list.insertBefore(li, list.children[index] ?? null);
    }
  });
}

function statusText(): string {
  const title = findItem(currentId)?.title ?? 'track';
  switch (player.state) {
    case 'LOADING':
      return `Loading ${title}…`;
    case 'PLAYING':
      return `Playing ${title}.`;
    case 'ERROR':
      return 'Playback stopped because a track failed.';
    case 'IDLE':
      return items.length > 0
        ? 'Stopped. Press Play to start the queue.'
        : 'The queue is empty. Add a track to begin.';
  }
}

function render(): void {
  const focused = document.activeElement;
  // Measured before syncList() can remove the focused <li>.
  const hadFocus = focused instanceof HTMLElement && root.contains(focused);
  syncList();
  const busy = player.state === 'LOADING' || player.state === 'PLAYING';
  playButton.disabled =
    mode === 'RUNNING' || !items.some((i) => i.status !== 'FAILED');
  skipButton.disabled = !(mode === 'RUNNING' && busy);
  stopButton.disabled = mode !== 'RUNNING';
  clearButton.disabled = items.length === 0;
  setText(statusEl, `${statusText()} ${notice}`.trim());
  // A focused control that was disabled or removed must not strand keyboard
  // users on <body>.
  if (
    hadFocus &&
    focused instanceof HTMLElement &&
    (!focused.isConnected || focused.matches(':disabled'))
  ) {
    [stopButton, playButton, clearButton, firstAddButton]
      .find((button) => !button.disabled)
      ?.focus();
  }
}

root.addEventListener('click', onClick);
const unsubscribe = player.subscribe(onPlayerState);
render();

// pagehide also fires when the page enters the back/forward cache. Then the
// player must stay usable, so only stop it; a real unload disposes it.
function onPageHide(event: PageTransitionEvent): void {
  if (event.persisted) {
    mode = 'STOPPED'; // first, so stopping does not auto-advance
    player.stop();
    return;
  }
  root.removeEventListener('click', onClick);
  window.removeEventListener('pagehide', onPageHide);
  window.removeEventListener('pageshow', onPageShow);
  unsubscribe();
  visualizer.dispose();
  player.dispose();
}

function onPageShow(event: PageTransitionEvent): void {
  if (event.persisted) render();
}

window.addEventListener('pagehide', onPageHide);
window.addEventListener('pageshow', onPageShow);
