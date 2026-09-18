export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
export interface User {
  available: string;
  banned: boolean;
  banReason: string | null;
  billingAccountId: string | null;
  billingReady: boolean;
  createdAt: string;
  email: string | null;
  fullName: string | null;
  id: string;
  lastActiveAt: string;
  requestCount: string;
  reserved: string;
  role: string | null;
  spent: string;
  updatedAt: string;
  username: string | null;
}
export interface Provider {
  baseURL: string;
  configured: boolean;
  enabled: boolean;
  id: string;
  name: string;
  region: string;
  revision: number;
  sdkType: string;
}
export interface Price {
  archivedAt: string | null;
  completionCreditsPerKToken: number;
  contextWindow: number;
  createdAt: string;
  displayName: string;
  functionCall: boolean;
  id: string;
  isActive: boolean;
  modelId: string;
  modelType: 'chat' | 'image' | 'video';
  note: string;
  promptCreditsPerKToken: number;
  provider: string;
  requestCreditsFlat: number;
  vision: boolean;
}
export interface PaymentConfig {
  appId: string;
  creditsPerUnit: number;
  currency: string;
  merchantId: string;
  notifyURL: string;
  publishableKey: string;
  returnURL: string;
  sandbox: boolean;
}
export interface Payment {
  config: PaymentConfig;
  configured: Record<string, boolean>;
  enabled: boolean;
  id: 'alipay' | 'stripe';
  revision: number;
}
export interface Audit {
  action: string;
  actor: string;
  createdAt: string;
  id: number;
  target: string;
}
