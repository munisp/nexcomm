# Transfer Fixture Evidence Claims

- [x] The file-backed transfer fixture rejects invalid requests, persists a committed operation exactly once for a payload-bound idempotency key, and rejects conflicting key reuse.
- [x] The file-backed transfer fixture writes a linked tamper-evident audit history and is covered by real filesystem integration tests without mocks, fakes, stubs, or monkey-patches.
