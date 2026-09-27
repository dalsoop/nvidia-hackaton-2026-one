// Centralized strings for agent panel (delegating to domain vocab)

import { T_AGENT } from '../domain/vocab/agent.js';

export const STRINGS = {
  agentTitle: T_AGENT.title,
  messageLabel: T_AGENT.messageLabel,
  messagePlaceholder: T_AGENT.messagePlaceholder,
  send: T_AGENT.send,
  ruleCalc: T_AGENT.ruleCalc,
  resend: T_AGENT.resend,
  requestFailed: T_AGENT.requestFailed,
  overloadNotice: T_AGENT.overloadNotice,
  makingPlan: (n) => T_AGENT.makingPlan(n),
  ruleFallbackNotice: T_AGENT.ruleFallbackNotice,
  running: T_AGENT.running,
  done: T_AGENT.done,
  failed: T_AGENT.failed,
  tools: T_AGENT.tools || {}
};
