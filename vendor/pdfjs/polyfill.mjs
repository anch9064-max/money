// Safari (iOS) не умеет перебирать ReadableStream через «for await» — добавляем эту возможность для pdf.js.
if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
  ReadableStream.prototype.values = function values({ preventCancel = false } = {}) {
    const reader = this.getReader();
    return {
      async next() {
        try {
          const r = await reader.read();
          if (r.done) reader.releaseLock();
          return r;
        } catch (e) {
          reader.releaseLock();
          throw e;
        }
      },
      async return(value) {
        if (!preventCancel) {
          const p = reader.cancel(value);
          reader.releaseLock();
          await p;
        } else reader.releaseLock();
        return { done: true, value };
      },
      [Symbol.asyncIterator]() { return this; },
    };
  };
  ReadableStream.prototype[Symbol.asyncIterator] = ReadableStream.prototype.values;
}
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function withResolvers() {
    let resolve, reject;
    const promise = new this((a, b) => { resolve = a; reject = b; });
    return { promise, resolve, reject };
  };
}
