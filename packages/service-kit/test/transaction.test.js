import { describe, expect, it, vi } from 'vitest';
import { withTransaction } from '../src/transaction.js';

function createPool(client) {
  return { connect: vi.fn().mockResolvedValue(client) };
}

describe('withTransaction', () => {
  it('commits a successful operation and releases the client', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
    const pool = createPool(client);
    const operation = vi.fn().mockResolvedValue('done');

    await expect(withTransaction(pool, operation)).resolves.toBe('done');

    expect(pool.connect).toHaveBeenCalledOnce();
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'COMMIT']);
    expect(operation).toHaveBeenCalledWith(client);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases the client when an operation fails', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
    const pool = createPool(client);
    const failure = new Error('operation failed');

    await expect(
      withTransaction(pool, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
