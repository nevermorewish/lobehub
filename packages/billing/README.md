# `packages/billing`

Provider-neutral commercial domain logic adapted from Wedai.

This package provides frozen price snapshots, quota policies, usage normalization, integer money
and credit units, idempotency keys, and billing command orchestration. Application services translate
runtime usage into wallet operations; provider SDKs remain independent of billing.

The self-hosted integration uses the Go admin catalog for model prices and encrypted Alipay
configuration. The active product is one-time credit packs, not recurring subscriptions.

See [deployment and supported behavior](../../docs/development/commercial-billing.md) for setup,
verified paths, and remaining operational limitations.
