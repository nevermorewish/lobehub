import { createSign, createVerify } from 'node:crypto';

export interface AlipayMerchant {
  appId: string;
  merchantId: string;
  notifyURL: string;
  returnURL: string;
  sandbox: boolean;
}

const canonical = (fields: Record<string, string>, notification = false) =>
  Object.keys(fields)
    .filter((key) => key !== 'sign' && (!notification || key !== 'sign_type') && fields[key] !== '')
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('&');

export function parseAlipayAmount(value: string): bigint {
  if (!/^(?:0|[1-9]\d{0,10})\.\d{2}$/.test(value)) throw new Error('Invalid Alipay amount');
  return BigInt(value.replace('.', ''));
}

export const formatAlipayAmount = (value: bigint) => {
  if (value <= 0n || value > 100_000_000_00n) throw new Error('Payment amount is outside limits');
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
};

export function createAlipayCheckout(params: {
  amountMinor: bigint;
  merchant: AlipayMerchant;
  orderId: string;
  orderNo: string;
  privateKey: string;
}) {
  const { merchant } = params;
  const returnUrl = new URL(merchant.returnURL);
  returnUrl.searchParams.set('orderId', params.orderId);
  returnUrl.searchParams.set('fromCheckout', '1');
  // Alipay interprets this timestamp in Asia/Shanghai.
  const timestamp = new Date(Date.now() + 8 * 3600_000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
  const fields: Record<string, string> = {
    app_id: merchant.appId,
    biz_content: JSON.stringify({
      out_trade_no: params.orderNo,
      product_code: 'FAST_INSTANT_TRADE_PAY',
      seller_id: merchant.merchantId,
      subject: `Credits ${params.orderNo}`,
      timeout_express: '30m',
      total_amount: formatAlipayAmount(params.amountMinor),
    }),
    // eslint-disable-next-line unicorn/text-encoding-identifier-case -- Alipay signs this exact value.
    charset: 'utf-8',
    format: 'JSON',
    method: 'alipay.trade.page.pay',
    notify_url: merchant.notifyURL,
    return_url: returnUrl.toString(),
    sign_type: 'RSA2',
    timestamp,
    version: '1.0',
  };
  fields.sign = createSign('RSA-SHA256')
    .update(canonical(fields), 'utf8')
    .sign(params.privateKey, 'base64');
  const gateway = merchant.sandbox
    ? 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
    : 'https://openapi.alipay.com/gateway.do';
  return `${gateway}?${new URLSearchParams(fields)}`;
}

/** Form values are decoded exactly once, duplicate keys are never accepted. */
export function verifyAlipayNotification(rawBody: string, publicKey: string) {
  if (Buffer.byteLength(rawBody, 'utf8') > 64 * 1024) throw new Error('Notification too large');
  const fields: Record<string, string> = Object.create(null);
  for (const [key, value] of new URLSearchParams(rawBody)) {
    if (Object.hasOwn(fields, key)) throw new Error('Duplicate notification field');
    fields[key] = value;
  }
  if (fields.sign_type !== 'RSA2' || !fields.sign) throw new Error('RSA2 signature required');
  if (
    !createVerify('RSA-SHA256')
      .update(canonical(fields, true), 'utf8')
      .verify(publicKey, fields.sign, 'base64')
  ) {
    throw new Error('Invalid Alipay signature');
  }
  for (const key of [
    'app_id',
    'seller_id',
    'out_trade_no',
    'trade_no',
    'trade_status',
    'total_amount',
    'notify_id',
  ]) {
    if (!fields[key] || fields[key].length > 256) throw new Error('Incomplete notification');
  }
  return fields;
}
