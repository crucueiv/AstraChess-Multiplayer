export class MockStorage {
  private readonly map = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }
}

export class MockDurableState {
  readonly storage = new MockStorage();

  async blockConcurrencyWhile<T>(callback: () => Promise<T> | T): Promise<T> {
    return callback();
  }
}
