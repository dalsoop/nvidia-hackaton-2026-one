// Centralized strings for agent panel in ASCII unicode escape format to adhere to encoding rules

import { T } from '../domain/vocab.js';
import { T_AGENT } from '../domain/vocab/agent.js';

export const STRINGS = {
  agentTitle: T_AGENT?.title || (T && T.workspace && T.workspace.agent) || '\uC5D0\uC774\uC804\uD288',
  messageLabel: T_AGENT?.messageLabel || '\uBA54\uC2DC\uC9C0',
  messagePlaceholder: T_AGENT?.messagePlaceholder || '\uBA54\uC2DC\uC9C0\u0020\uC785\uB825',
  send: T_AGENT?.send || '\uC804\uC1A1',
  ruleCalc: T_AGENT?.ruleCalc || '\uADDC\uCE59\uC73C\uB85C\u0020\uACC4\uC0B0',
  resend: T_AGENT?.resend || '\uB2E4\uC2DC\u0020\uBCF4\uB0B4\uAE30',
  requestFailed: T_AGENT?.requestFailed || '\uACC4\uD68D\u0020\uC694\uCCAD\u0020\uC2E4\uD328',
  overloadNotice: T_AGENT?.overloadNotice || '\u004E\u0056\u0049\u0044\u0049\u0041\u0020\u0041\u0050\u0049\uAC00\u0020\uC77C\uC2DC\uC801\uC73C\uB85C\u0020\uACFC\uBD80\uD558\u0020\uC0C1\uD0DC\uC785\uB2C8\uB2E4\u002E\u0020\uB2E4\uC2DC\u0020\uC2DC\uB3C4\uD574\u0020\uC8FC\uC138\uC694\u002E',
  makingPlan: (n) => (T_AGENT?.makingPlan ? T_AGENT.makingPlan(n) : ('\uACC4\uD68D\u0020' + n + '\uC744\u0020\uB9CC\uB4DC\uB294\u0020\uC911')),
  ruleFallbackNotice: T_AGENT?.ruleFallbackNotice || '\uADDC\uCE59\u0020\uAE30\uBC18\u0020\uD3F4\uBC31\u0020\u00B7\u0020\uCC98\uBC29\u0020\uC870\uAC74\uC73C\uB85C\u0020\uACC4\uD68D\u0020\uACC4\uC0B0',
  running: T_AGENT?.running || '\uC2E4\uD589\u0020\uC911',
  done: T_AGENT?.done || '\uC644\uB8CC',
  failed: T_AGENT?.failed || '\uC2E4\uD328',
  tools: T_AGENT?.tools || {}
};

