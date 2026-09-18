import { createSign, createVerify, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createAlipayCheckout,
  formatAlipayAmount,
  parseAlipayAmount,
  verifyAlipayNotification,
} from './alipayProtocol';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' },
});
const body = (override: Record<string, string> = {}) => {
  const values = {
    app_id: 'app1',
    notify_id: 'notify1',
    out_trade_no: 'order1',
    seller_id: 'seller1',
    total_amount: '9.90',
    trade_no: 'trade1',
    trade_status: 'TRADE_SUCCESS',
    ...override,
  };
  const data = Object.keys(values)
    .sort()
    .map((key) => `${key}=${values[key as keyof typeof values]}`)
    .join('&');
  return new URLSearchParams({
    ...values,
    sign_type: 'RSA2',
    sign: createSign('RSA-SHA256').update(data).sign(privateKey, 'base64'),
  }).toString();
};

describe('Alipay RSA2 protocol', () => {
  it('signs a sandbox page payment with exact fen and server-owned merchant fields', () => {
    const url = new URL(
      createAlipayCheckout({
        amountMinor: 990n,
        orderId: 'id1',
        orderNo: 'order1',
        privateKey,
        merchant: {
          appId: 'app1',
          merchantId: 'seller1',
          notifyURL: 'https://merchant.test/api/webhooks/alipay',
          returnURL: 'https://merchant.test/settings/plans',
          sandbox: true,
        },
      }),
    );
    expect(url.hostname).toBe('openapi-sandbox.dl.alipaydev.com');
    const params = Object.fromEntries(url.searchParams);
    const sign = params.sign;
    delete params.sign;
    const canonical = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');
    expect(createVerify('RSA-SHA256').update(canonical).verify(publicKey, sign, 'base64')).toBe(
      true,
    );
    expect(JSON.parse(params.biz_content)).toMatchObject({
      total_amount: '9.90',
      out_trade_no: 'order1',
      seller_id: 'seller1',
    });
  });
  it('accepts signed notification and rejects tampering, duplicate fields and RSA downgrade', () => {
    const signed = body();
    expect(verifyAlipayNotification(signed, publicKey).trade_status).toBe('TRADE_SUCCESS');
    expect(() => verifyAlipayNotification(signed.replace('9.90', '0.01'), publicKey)).toThrow();
    expect(() => verifyAlipayNotification(`${signed}&total_amount=9.90`, publicKey)).toThrow();
    expect(() => verifyAlipayNotification(signed.replace('RSA2', 'RSA'), publicKey)).toThrow();
  });
  it('never converts money through floating-point arithmetic', () => {
    expect(parseAlipayAmount('9.90')).toBe(990n);
    expect(formatAlipayAmount(990n)).toBe('9.90');
    for (const amount of ['9.999', '-1.00', '1e3', 'NaN', '09.90'])
      expect(() => parseAlipayAmount(amount)).toThrow();
  });
});
