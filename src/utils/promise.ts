export async function firstSuccessful<T>(promises: Array<Promise<T>>, errorMessage: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    if (promises.length === 0) {
      reject(new Error(errorMessage));
      return;
    }

    let rejectionCount = 0;
    let lastError: unknown;

    for (const promise of promises) {
      promise.then(resolve).catch((error) => {
        rejectionCount += 1;
        lastError = error;
        if (rejectionCount === promises.length) {
          reject(lastError instanceof Error ? lastError : new Error(errorMessage));
        }
      });
    }
  });
}
