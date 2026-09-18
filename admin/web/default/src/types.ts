export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
export interface User {
  banned: boolean;
  banReason: string | null;
  createdAt: string;
  email: string | null;
  fullName: string | null;
  id: string;
  lastActiveAt: string;
  role: string | null;
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
  modelType: 'chat' | 'image' | 'video';
  requestCreditsFlat: number;
  archivedAt: string | null;
  completionCreditsPerKToken: number;
  contextWindow: number;
  createdAt: string;
  displayName: string;
  functionCall: boolean;
  id: string;
  isActive: boolean;
  modelId: string;
  note: string;
  promptCreditsPerKToken: number;
  provider: string;
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
