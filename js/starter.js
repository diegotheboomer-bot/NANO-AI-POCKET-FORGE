/* ============================================================================
   starter.js · "auto-teach": curated starter packs matched to the task text
   Each pack = rules + training examples + HELD-OUT tests (never trained on).
   Hand-written on purpose: a 0.5B model can't be trusted to write its own
   training data. Unmatched tasks get no pack (the UI says so) and rely on the
   user's own examples, which the self-test then scores.
   ========================================================================== */
window.PF = window.PF || {};

PF.Starter = (() => {
  const j = o => JSON.stringify(o);        // compact JSON, matches what the model should emit

  const PACKS = [
    {
      id: 'ticket', label: 'Support tickets', match: /ticket|support|helpdesk|complaint|customer (?:message|email)/i,
      rules: [
        'Output a single compact JSON object with keys: priority, category, summary, order_id, contact',
        'priority is one of: high, medium, low. Use high for urgent, asap, outage, fraud, hacked accounts, or charged twice',
        'category is one of: billing, bug, account, shipping, fraud, general',
        'order_id keeps the # and is null when no order number appears',
        'contact is the email or phone number from the text, or null',
      ],
      examples: [
        ['URGENT: I was charged twice for order #1001, call 555-010-1111', { priority: 'high', category: 'billing', summary: 'Charged twice for order', order_id: '#1001', contact: '555-010-1111' }],
        ["I can't log in to my account, please help. email me at lee@mail.com", { priority: 'medium', category: 'account', summary: 'Cannot log in to account', order_id: null, contact: 'lee@mail.com' }],
        ['Just wondering how to change the shipping address on #2002', { priority: 'low', category: 'shipping', summary: 'Question about changing shipping address', order_id: '#2002', contact: null }],
        ['help i was scammed', { priority: 'high', category: 'fraud', summary: 'Reports being scammed', order_id: null, contact: null }],
        ['The app crashes every time I open reports. Ticket #3003, ana@corp.io', { priority: 'medium', category: 'bug', summary: 'App crashes when opening reports', order_id: '#3003', contact: 'ana@corp.io' }],
        ['Package for order #4004 never arrived, it has been 3 weeks', { priority: 'medium', category: 'shipping', summary: 'Package not delivered after 3 weeks', order_id: '#4004', contact: null }],
      ],
      tests: [
        ['ASAP: payment failed twice and my card was charged for order #5005, reach me at 212-555-0100', { priority: 'high', category: 'billing', order_id: '#5005', contact: '212-555-0100' }],
        ['How do I reset my password? no rush', { priority: 'low', category: 'account', order_id: null, contact: null }],
        ['Someone hacked my account and took my money', { priority: 'high', category: 'fraud', order_id: null, contact: null }],
        ['Box arrived damaged, order #6006. sam@mail.com', { priority: 'medium', category: 'shipping', order_id: '#6006', contact: 'sam@mail.com' }],
      ],
    },
    {
      id: 'sentiment', label: 'Sentiment', match: /sentiment|classif|tone|feeling|review|feedback/i,
      rules: ['Answer with exactly one word: positive, negative, or neutral'],
      examples: [
        ["I love this app, it's fast and perfect", 'positive'], ['Terrible update, everything is broken', 'negative'],
        ['The package arrived on Tuesday', 'neutral'], ['Support was awesome, thanks!', 'positive'],
        ['Slow and buggy, I want a refund', 'negative'], ['It does what it says', 'neutral'],
      ],
      tests: [
        ['Great quality, very happy', 'positive'], ['Worst purchase ever, totally broken', 'negative'], ['Delivery is scheduled for Friday', 'neutral'],
      ],
    },
    {
      id: 'summary', label: 'Summaries', match: /summar|tl;?dr|shorten|digest|condense/i,
      rules: ['Write one sentence of at most 25 words', 'Keep names, dates and numbers', 'Do not add information that is not in the text'],
      examples: [
        ['The quarterly meeting moved to Friday at 3pm. Bring the budget draft. Lunch will be provided.', 'Quarterly meeting moved to Friday 3pm; bring the budget draft.'],
        ['Our server went down at 2am due to a full disk. Ops cleared logs and restored service by 2:40am. We will add disk alerts.', 'A full disk caused a 2am outage, fixed by 2:40am; disk alerts will be added.'],
      ],
      tests: [],
    },
    {
      id: 'extract', label: 'Product extraction', match: /extract|product|listing|parse|price|item|inventory/i,
      rules: [
        'Output a single compact JSON object with keys: product, price, quantity, contact, date',
        'price keeps the currency symbol or code',
        'Use null for anything missing. Never invent values that are not in the text',
      ],
      examples: [
        ['selling my old iphone 12 128gb $350 firm, text 415-555-0123', { product: 'iphone 12 128gb', price: '$350', quantity: null, contact: '415-555-0123', date: null }],
        ['selling 3x Dell U2723QE monitors, 420 USD each, email buy@shop.io, pickup Mar 3', { product: 'Dell U2723QE monitors', price: '420 USD', quantity: 3, contact: 'buy@shop.io', date: 'Mar 3' }],
        ['selling a Sony WH-1000XM5 headphones for $279. dm me', { product: 'Sony WH-1000XM5 headphones', price: '$279', quantity: null, contact: null, date: null }],
        ['selling a standing desk, 2 pcs, $150 each, email ana@mail.com', { product: 'standing desk', price: '$150', quantity: 2, contact: 'ana@mail.com', date: null }],
      ],
      tests: [
        ['hey!! selling my old macbook pro 14 (2021, m1) $1,450 obo. text me 415-555-0199, can meet sat Nov 21', { product: 'old macbook pro 14', price: '$1,450', contact: '415-555-0199', date: 'Nov 21' }],
        ['selling a Nintendo Switch OLED for $260, email kim@mail.com', { product: 'Nintendo Switch OLED', price: '$260', contact: 'kim@mail.com' }],
      ],
    },
  ];

  const toEx = ([input, out]) => ({ input, output: typeof out === 'string' ? out : j(out), src: 'starter' });

  /** @returns {{id,label,rules,examples,tests}|null} */
  function forTask(task) {
    const p = PACKS.find(p => p.match.test(task || ''));
    return p ? { id: p.id, label: p.label, rules: [...p.rules], examples: p.examples.map(toEx), tests: p.tests.map(([input, out]) => ({ input, expected: typeof out === 'string' ? out : j(out) })) } : null;
  }

  return { forTask };
})();
