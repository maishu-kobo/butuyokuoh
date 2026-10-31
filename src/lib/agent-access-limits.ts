/** エージェント連携の公開向け上限・期限。ヘルプ画面と判定ロジックの共通値。 */

export const AGENT_TOKEN_DEFAULT_DAYS = 90;
export const AGENT_TOKEN_MAX_DAYS = 365;
export const AGENT_AUDIT_RETENTION_DAYS = 90;

export type AgentRateKind = 'read' | 'add' | 'add_url' | 'add_day';

export const AGENT_RATE_LIMITS: Record<AgentRateKind, number> = {
  read: 60,
  add: 20,
  add_url: 10,
  add_day: 200,
};
