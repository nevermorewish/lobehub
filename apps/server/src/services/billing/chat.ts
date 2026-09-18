import { randomUUID } from 'node:crypto';

import { priceTokens } from '@lobechat/billing/usage/tokenPricing';
import type { ChatMethodOptions, ChatStreamPayload, ModelRuntime } from '@lobechat/model-runtime';
import { AgentRuntimeError } from '@lobechat/model-runtime';
import { ChatErrorType, type ModelUsage } from '@lobechat/types';
import { eq } from 'drizzle-orm';

import { BillingAccountModel } from '@/database/models/billing';
import { WalletModel } from '@/database/models/billingWallet';
import { usageRecords } from '@/database/schemas/billing';
import { users } from '@/database/schemas/user';
import type { LobeChatDatabase } from '@/database/type';
import { getAdminCatalog } from '@/server/services/adminManagement';

interface BillingIdentity {
  db: LobeChatDatabase;
  provider: string;
  userHasCredentials: boolean;
  userId: string;
}

/** Installed at the shared runtime construction point, covering chat and every Agent attempt. */
export function attachChatBilling(runtime: ModelRuntime, identity: BillingIdentity) {
  if (!process.env.ADMIN_SERVICE_URL) return runtime;
  const original = runtime.chat.bind(runtime);
  runtime.chat = (payload, options) => billChat(original, identity, payload, options);
  return runtime;
}

export async function billChat(
  call: ModelRuntime['chat'],
  identity: BillingIdentity,
  payload: ChatStreamPayload,
  options?: ChatMethodOptions,
): Promise<Response> {
  const { db, userId, provider } = identity;
  const [user] = await db
    .select({ banned: users.banned, banExpires: users.banExpires })
    .from(users)
    .where(eq(users.id, userId));
  if (!user || (user.banned && (!user.banExpires || user.banExpires > new Date()))) {
    throw AgentRuntimeError.createError(ChatErrorType.Forbidden, { message: 'Account suspended' });
  }
  if (identity.userHasCredentials) return call(payload, options);
  const catalog = await getAdminCatalog();
  const price = catalog?.prices.find(
    (row) => row.provider === provider && row.modelId === payload.model,
  );
  if (!price)
    throw AgentRuntimeError.createError(ChatErrorType.BadRequest, {
      message: 'Model billing price is not configured',
    });
  const rates = {
    completionPerK: BigInt(price.completionCreditsPerKToken),
    promptPerK: BigInt(price.promptCreditsPerKToken),
  };
  // Reserve conservatively; the final debit always uses the provider's separate input/output usage.
  const promptEstimate =
    JSON.stringify(payload.messages ?? []).length + JSON.stringify(payload.tools ?? []).length;
  const maxOutput = payload.max_tokens ?? 4096;
  if (!Number.isSafeInteger(maxOutput) || maxOutput < 1) {
    throw AgentRuntimeError.createError(ChatErrorType.BadRequest, {
      message: 'Invalid output token limit',
    });
  }
  const held = priceTokens(promptEstimate, maxOutput, rates);
  const account = await new BillingAccountModel(db, userId).createForUser({ currency: 'CNY' });
  // An invocation gets a server-owned identity; replaying client headers must never buy free calls.
  const requestId = randomUUID();
  let reservation;
  try {
    reservation = await db.transaction(async (tx) => {
      const hold = await new WalletModel(tx as unknown as LobeChatDatabase).hold({
        amount: held,
        billingAccountId: account.id,
        idempotencyKey: `hold:${requestId}`,
        reason: 'chat',
      });
      const [record] = await tx
        .insert(usageRecords)
        .values({
          billingAccountId: account.id,
          modelId: payload.model,
          provider,
          requestId,
          userId,
          priceSnapshot: {
            priceId: price.id,
            modelType: 'chat',
            unit: 'token',
            completionPerK: rates.completionPerK.toString(),
            promptPerK: rates.promptPerK.toString(),
            currency: 'CNY',
            holdId: hold.ledger.id,
            heldCredits: held.toString(),
          },
        })
        .returning();
      return { hold, record };
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'PRECONDITION_FAILED') {
      throw AgentRuntimeError.createError(ChatErrorType.InsufficientBudgetForModel, {
        message: 'Insufficient credits',
      });
    }
    throw error;
  }
  const { hold, record } = reservation;
  let usage: ModelUsage | undefined;
  let failed = false;
  let terminal: Promise<void> | undefined;
  const finish = (success: boolean) => {
    if (terminal) return terminal;
    terminal = (async () => {
      const prompt = usage?.totalInputTokens ?? usage?.inputTextTokens;
      const completion = usage?.totalOutputTokens ?? usage?.outputTextTokens;
      const measured = prompt !== undefined && completion !== undefined;
      // Preserve measured usage before settlement so a DB failure can be reconciled.
      if (success && measured) {
        priceTokens(prompt, completion, rates);
        await db
          .update(usageRecords)
          .set({
            promptTokens: prompt,
            completionTokens: completion,
            totalTokens: prompt + completion,
            settlementStatus: 'settle_pending',
          })
          .where(eq(usageRecords.id, record.id));
      }
      await db.transaction(async (tx) => {
        const txWallet = new WalletModel(tx as unknown as LobeChatDatabase);
        if (success && measured) {
          const credits = priceTokens(prompt, completion, rates);
          const result = await txWallet.settle({
            actualAmount: credits,
            billingAccountId: account.id,
            debitIdempotencyKey: `debit:${requestId}`,
            heldAmount: held,
            holdLedgerEntryId: hold.ledger.id,
            releaseIdempotencyKey: `release:${requestId}`,
            usageRecordId: record.id,
            reason: 'chat',
          });
          await tx
            .update(usageRecords)
            .set({
              creditsCharged: credits,
              promptTokens: prompt,
              completionTokens: completion,
              totalTokens: prompt + completion,
              settlementStatus: 'settled',
              ledgerEntryId: result.debitEntry.id,
            })
            .where(eq(usageRecords.id, record.id));
        } else {
          const result = await txWallet.release({
            amount: held,
            billingAccountId: account.id,
            holdLedgerEntryId: hold.ledger.id,
            idempotencyKey: `release:${requestId}`,
            reason: success ? 'provider_usage_missing' : 'provider_failed',
            usageRecordId: record.id,
          });
          await tx
            .update(usageRecords)
            .set({
              settlementStatus: success ? 'usage_missing' : 'released',
              ledgerEntryId: result.ledger.id,
            })
            .where(eq(usageRecords.id, record.id));
        }
      });
    })();
    return terminal;
  };
  let response: Response;
  try {
    response = await call(
      { ...payload, max_tokens: maxOutput },
      {
        ...options,
        callback: {
          ...options?.callback,
          onUsage: async (data) => {
            usage = data;
            await options?.callback?.onUsage?.(data);
          },
          onFinal: async (data) => {
            usage = data.usage ?? usage;
            failed ||= !!data.error;
            await options?.callback?.onFinal?.(data);
          },
          onError: async (error) => {
            failed = true;
            await options?.callback?.onError?.(error);
          },
        },
      },
    );
  } catch (error) {
    await finish(false);
    throw error;
  }
  if (!response.body) {
    await finish(response.ok && !failed);
    return response;
  }
  const reader = response.body.getReader();
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await reader.read();
          if (result.done) {
            await finish(response.ok && !failed);
            controller.close();
          } else controller.enqueue(result.value);
        } catch (error) {
          try {
            await finish(false);
          } catch (billingError) {
            console.error('[billing:chat] Settlement requires reconciliation', billingError);
          }
          controller.error(error);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          await finish(false);
        }
      },
    }),
    { headers: response.headers, status: response.status, statusText: response.statusText },
  );
}
