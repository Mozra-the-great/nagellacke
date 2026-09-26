import { solveOnMainThread } from './pow';

// Runs the registration proof-of-work search off the main thread (#324 S14). Inside a
// worker, "main thread" in the helper's name just means "this thread".
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<{ salt: string; difficulty: number }>) => void) | null;
  postMessage(message: number): void;
};

ctx.onmessage = (e) => {
  void solveOnMainThread(e.data.salt, e.data.difficulty).then((n) => ctx.postMessage(n));
};
