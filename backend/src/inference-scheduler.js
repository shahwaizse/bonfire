// One GPU slot: queued chats precede optional mascot generation.
const queue = []; let busy = false, sequence = 0;
function drain() {
  if (busy || !queue.length) return;
  queue.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
  const job = queue.shift(); job.signal?.removeEventListener('abort', job.abort);
  busy = true; let released = false;
  job.resolve(() => { if (!released) { released = true; busy = false; drain(); } });
}
export function acquireInference({ signal, priority = 0 } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const job = { resolve, reject, signal, priority, sequence: sequence++ };
    job.abort = () => { const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1); reject(signal.reason); };
    signal?.addEventListener('abort', job.abort, { once: true }); queue.push(job); drain();
  });
}
