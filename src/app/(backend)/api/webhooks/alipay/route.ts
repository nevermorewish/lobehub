import { getServerDB } from '@/database/core/db-adaptor';
import { AlipayPaymentService } from '@/server/services/payment/AlipayPaymentService';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
    return new Response('failure', { status: 415 });
  }
  try {
    const body = await request.text();
    await new AlipayPaymentService(await getServerDB()).processNotification(body);
    return new Response('success', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } catch {
    // Do not echo signed payloads, merchant credentials or database errors.
    console.error('[alipay:notify] Payment notification rejected');
    return new Response('failure', { status: 400 });
  }
}
