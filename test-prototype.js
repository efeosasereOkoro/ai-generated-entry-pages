// =====================================================================
// Test harness for the A05 prototype's pipeline logic.
// Mirrors the pure functions from a05-prototype.html and runs realistic
// scenarios through them: triage, risk scoring, page-model decision,
// AI generation, and the acceptance checklist.
// =====================================================================

// ---- Lifted from the prototype (pure logic, no DOM) ----

const MDAS = [
  { code: 'NIS', name: 'National Insurance Department' },
  { code: 'BRA', name: 'Barbados Revenue Authority' },
  { code: 'MoH', name: 'Ministry of Health and Wellness' },
  { code: 'CRD', name: 'Civil Registration Department' },
  { code: 'BLP', name: 'Barbados Licensing Authority' }
];
const getMda = code => MDAS.find(m => m.code === code);

function runTriage(s) {
  const reasons = [];
  if (!s.formUrl || !/forms\.gov\.bb|alpha\.gov\.bb/i.test(s.formUrl)) {
    reasons.push('Form URL must reference forms.gov.bb or alpha.gov.bb');
  }
  if (!s.mdaCode || !getMda(s.mdaCode)) {
    reasons.push('MDA must be selected from the registered list');
  }
  const requiredFields = [
    ['serviceName', 'Service name'],
    ['whatService', 'What is this service for?'],
    ['whoFor', 'Who is this service for?'],
    ['serviceMode', 'Service mode'],
    ['whatToHave', 'What to have ready'],
    ['whatHappensAfter', 'What happens after submit']
  ];
  for (const [k, label] of requiredFields) {
    const v = (s[k] || '').trim();
    if (!v || v.length < 3) reasons.push(`Field "${label}" is empty or too short`);
  }
  if (s.serviceMode === 'Unknown') {
    reasons.push('Service mode must be Online, In person, or Partly online');
  }
  const blob = ((s.serviceName||'') + ' ' + (s.whatService||'') + ' ' + (s.whatItMeans||'')).toLowerCase();
  const noisePatterns = ['marshmellow', 'marshmallow', 'great again', 'lorem ipsum', 'test test', 'asdf', 'demo'];
  for (const p of noisePatterns) {
    if (blob.includes(p)) reasons.push(`Service description contains noise pattern: "${p}"`);
  }
  if ((s.whatService||'').length < 30) {
    reasons.push('"What is this service for?" should be at least 30 characters');
  }
  return { passed: reasons.length === 0, reasons };
}

function scoreRisk(s) {
  let score = 0;
  const reasons = [];
  const blob = (Object.values(s).join(' ') || '').toLowerCase();
  if (/bank|account|payment|deposit|fee|cost/.test(blob)) { score += 1; reasons.push('Involves money or bank details'); }
  if (/eligib|means-test|pensioner|age|income/.test(blob)) { score += 2; reasons.push('Has eligibility or means-testing rules'); }
  if (/deadline|by .* (each|year)|cut[- ]off|late.*(fee|penalty)/.test(blob)) { score += 2; reasons.push('Hard deadline with consequence'); }
  if (s.alphaPaths && /yes|paths/i.test(s.alphaPaths)) { score += 1; reasons.push('Multiple paths through the service'); }
  if (s.commonConfusion && s.commonConfusion.length > 20) { score += 1; reasons.push('Has documented common-confusion areas'); }
  if (s.specialCases && s.specialCases.toLowerCase() !== 'none' && s.specialCases.length > 5) { score += 1; reasons.push('Has special cases or exceptions'); }
  let level = 'low';
  if (score >= 4) level = 'high';
  else if (score >= 2) level = 'medium';
  return { level, reasons, score };
}

function decidePageModel(s) {
  const hasGuidance = (s.commonConfusion && s.commonConfusion.length > 5 && s.commonConfusion.toLowerCase() !== 'none')
                  || (s.specialCases && s.specialCases.length > 5 && s.specialCases.toLowerCase() !== 'none')
                  || (s.unusual && s.unusual.length > 5 && s.unusual.toLowerCase() !== 'none' && s.unusual.toLowerCase() !== 'nothing');
  const isComplex = (s.alphaShape && /paths/i.test(s.alphaShape)) || (s.alphaDropOff && s.alphaDropOff.toLowerCase() !== 'none');
  if (isComplex && hasGuidance) return 'separate-with-guidance';
  if (isComplex) return 'separate-no-guidance';
  if (hasGuidance) return 'combined-with-guidance';
  return 'combined-no-guidance';
}

function generateDrafts(s) {
  const model = decidePageModel(s);
  const drafts = {};
  if (model.startsWith('separate')) {
    drafts.entry = {
      title: s.serviceName,
      summary: s.whatService,
      whoFor: s.whoFor,
      cta: { label: 'Start now' }
    };
  }
  drafts.start = {
    title: s.serviceName,
    isCombined: model.startsWith('combined'),
    summary: model.startsWith('combined') ? s.whatService : null,
    whoFor: model.startsWith('combined') ? s.whoFor : null,
    beforeYouStart: [
      `This service is ${s.serviceMode.toLowerCase()}.`,
      s.costsDeadlines && !/^no( fees)?$/i.test(s.costsDeadlines) ? s.costsDeadlines : null,
      s.beforeStart || null
    ].filter(Boolean),
    whatYouNeed: (s.whatToHave || '').split(/[,;]/).map(x => x.trim()).filter(Boolean),
    whatHappensAfter: s.whatHappensAfter,
    whatItMeans: s.whatItMeans,
    cta: { label: 'Apply now' }
  };
  if (model.endsWith('with-guidance')) {
    drafts.guidance = {
      title: `${s.serviceName} — guidance`,
      sections: [
        s.commonConfusion && s.commonConfusion.toLowerCase() !== 'none' ? { heading: 'What people often get wrong', body: s.commonConfusion } : null,
        s.specialCases && s.specialCases.toLowerCase() !== 'none' ? { heading: 'Special cases and exceptions', body: s.specialCases } : null,
        s.unusual && !['none','nothing'].includes((s.unusual||'').toLowerCase()) ? { heading: 'Easy to miss', body: s.unusual } : null
      ].filter(Boolean)
    };
  }
  return { model, drafts };
}

function runChecklist(s) {
  const { drafts } = generateDrafts(s);
  const checks = [];
  checks.push({ label: 'Timing rules near the top, standalone', auto: true, pass: (drafts.start.beforeYouStart||[]).length > 0 });
  checks.push({ label: 'Service mode explicit', auto: true, pass: ['Online','In person','Partly online'].includes(s.serviceMode) });
  checks.push({ label: 'Next step uses a recognised verb', auto: true, pass: /^(apply|start|register|book|claim|request|submit|get|pay)/i.test(drafts.start.cta.label) });
  checks.push({ label: 'No CTA duplication', auto: true, pass: !drafts.entry || drafts.entry.cta.label.toLowerCase() !== drafts.start.cta.label.toLowerCase() });
  checks.push({ label: 'Start = essentials only', auto: true, pass: !drafts.guidance ? true : (drafts.start.whatYouNeed.length <= 6 && (s.beforeStart||'').length < 200) });
  checks.push({ label: '"Who it\'s for" surfaced early', auto: true, pass: (s.whoFor||'').length > 10 });
  checks.push({ label: 'Uses gov.bb design-system component vocabulary', auto: true, pass: true });
  checks.push({ label: 'Headings & bullets — no buried key points', auto: false });
  checks.push({ label: 'Mobile scan test passes', auto: false });
  checks.push({ label: 'Risk score reviewed', auto: false });
  checks.push({ label: 'Linked into navigation + taxonomy', auto: false });
  checks.push({ label: 'Named owner recorded', auto: false });
  return checks;
}

// =====================================================================
// PRINT HELPERS
// =====================================================================
const c = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m' };
const hr = (label='') => console.log('\n' + c.bold + c.cyan + '━'.repeat(8) + ' ' + label + ' ' + '━'.repeat(Math.max(0, 70 - label.length - 10)) + c.reset);
const ok = s => c.green + '✓ ' + s + c.reset;
const no = s => c.red + '✗ ' + s + c.reset;
const tag = (s, color='cyan') => c[color] + '[' + s + ']' + c.reset;

function runScenario(label, s) {
  hr('SCENARIO · ' + label);
  console.log(c.dim + 'Service: ' + c.reset + s.serviceName);
  console.log(c.dim + 'MDA: ' + c.reset + (getMda(s.mdaCode)?.name || c.red + '(unresolved)' + c.reset));
  console.log(c.dim + 'Submitted by: ' + c.reset + s.submittedBy);

  // 1. Triage
  const t = runTriage(s);
  console.log('\n' + c.bold + 'Triage result: ' + c.reset + (t.passed ? ok('PASS') : no('FAIL')));
  if (!t.passed) {
    t.reasons.forEach(r => console.log('  ' + c.red + '• ' + r + c.reset));
    console.log(c.dim + '  → Submission returned to submitter. AI generator does not run.' + c.reset);
    return;
  }

  // 2. Risk
  const r = scoreRisk(s);
  const riskColor = r.level === 'high' ? 'red' : r.level === 'medium' ? 'yellow' : 'green';
  console.log('\n' + c.bold + 'Risk score: ' + c.reset + tag(r.level.toUpperCase(), riskColor) + ' (raw: ' + r.score + ')');
  r.reasons.forEach(x => console.log('  • ' + x));

  // 3. Page model
  const model = decidePageModel(s);
  console.log('\n' + c.bold + 'Page model: ' + c.reset + tag(model, 'magenta'));

  // 4. Drafts
  const { drafts } = generateDrafts(s);
  console.log('\n' + c.bold + 'Generated drafts:' + c.reset);
  if (drafts.entry) {
    console.log('  ' + tag('ENTRY', 'blue') + ' alpha.gov.bb/' + slugify(s.serviceName));
    console.log(c.dim + '    Summary: ' + c.reset + drafts.entry.summary.slice(0, 80) + (drafts.entry.summary.length > 80 ? '…' : ''));
    console.log(c.dim + '    CTA: ' + c.reset + '"' + drafts.entry.cta.label + '"');
  }
  console.log('  ' + tag(drafts.start.isCombined?'COMBINED ENTRY+START':'START', 'green') + ' alpha.gov.bb/' + slugify(s.serviceName) + (drafts.start.isCombined?'':'/start'));
  console.log(c.dim + '    Before you start:' + c.reset);
  drafts.start.beforeYouStart.forEach(l => console.log('      • ' + l));
  console.log(c.dim + '    What you need: ' + c.reset + drafts.start.whatYouNeed.join(', '));
  console.log(c.dim + '    CTA: ' + c.reset + '"' + drafts.start.cta.label + '"');
  if (drafts.guidance) {
    console.log('  ' + tag('GUIDANCE', 'yellow') + ' alpha.gov.bb/' + slugify(s.serviceName) + '/guidance');
    drafts.guidance.sections.forEach(sec => console.log(c.dim + '    ' + sec.heading + ': ' + c.reset + sec.body.slice(0, 60) + (sec.body.length > 60 ? '…' : '')));
  }

  // 5. Checklist
  const checks = runChecklist(s);
  const autoPass = checks.filter(x => x.auto && x.pass).length;
  const autoFail = checks.filter(x => x.auto && !x.pass).length;
  const manual = checks.filter(x => !x.auto).length;
  console.log('\n' + c.bold + 'Acceptance checklist: ' + c.reset
    + ok(autoPass + ' auto-pass') + '  '
    + (autoFail ? no(autoFail + ' auto-fail') + '  ' : '')
    + c.yellow + '○ ' + manual + ' manual' + c.reset);
  checks.forEach(x => {
    if (x.auto) console.log('  ' + (x.pass ? ok(x.label) : no(x.label)));
    else        console.log('  ' + c.yellow + '○ ' + x.label + ' (T1)' + c.reset);
  });

  // 6. Pipeline progression
  console.log('\n' + c.bold + 'Pipeline progression:' + c.reset);
  const stages = ['Submitted', 'Triage passed', 'Drafts produced', 'T1 review', 'T2 review (named MDA validator)', 'Published on alpha.gov.bb'];
  stages.forEach((st, i) => console.log('  ' + (i === 0 ? '◉' : '○') + ' ' + st + (i === stages.length - 1 ? c.green + ' → live' + c.reset : '')));
}

function slugify(s) { return (s||'').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g,''); }

// =====================================================================
// SCENARIOS
// =====================================================================

// Scenario 1 — A simple service that should pass triage and produce a
// combined Entry+Start (no Guidance). New service, not in seed data.
const renewLicense = {
  serviceName: 'Renew your driver\'s licence online',
  formUrl: 'https://forms.gov.bb/bla/renew-licence',
  mdaCode: 'BLP',
  submittedBy: 'Adunni',
  whatService: 'Renew an existing Class B or C driver\'s licence online for up to two years before it expires.',
  whoFor: 'Anyone holding a current Barbados driver\'s licence that has not been suspended.',
  beforeStart: 'Have your current licence number and a recent passport-style photograph ready.',
  serviceMode: 'Online',
  whatToHave: 'Current licence number, passport photo, valid email',
  costsDeadlines: '$50 for a 5-year renewal. Renew before the expiry date to avoid a late fee.',
  whatHappensAfter: 'You will receive a confirmation email and your new licence will be posted within 10 working days.',
  whatItMeans: 'Apply online and pay the renewal fee.',
  commonConfusion: '',
  specialCases: '',
  unusual: '',
  alphaPaths: 'no',
  alphaShape: 'Simple',
  alphaDropOff: 'none'
};

// Scenario 2 — Complex service with eligibility, deadline, paths, and
// detailed preparation. Should produce three pages and HIGH risk.
const taxRebate = {
  serviceName: 'Apply for the Senior Citizens\' Land Tax Rebate',
  formUrl: 'https://forms.gov.bb/bra/senior-land-rebate',
  mdaCode: 'BRA',
  submittedBy: 'Marisa',
  whatService: 'A 50% rebate on land tax for owner-occupied properties owned by pensioners aged 60 and over, subject to income thresholds.',
  whoFor: 'Pensioners aged 60+ who own and occupy their primary residence in Barbados, with a household income below the means-tested threshold.',
  beforeStart: 'Confirm pensioner status, recent income statement, and that you occupy the property as your primary residence.',
  serviceMode: 'Online',
  whatToHave: 'Property number, pensioner ID, income statement, proof of occupation (utility bill)',
  costsDeadlines: 'No fee. Rebate must be claimed by 30 September each tax year — late applications are not accepted.',
  whatHappensAfter: 'Confirmation email within 10 working days; rebate appears on the next assessment.',
  whatItMeans: 'Apply once online, then the rebate continues year on year unless your circumstances change.',
  commonConfusion: 'Many people think the rebate is automatic for over-60s — it is not. You must apply, and you must continue to occupy the property.',
  specialCases: 'Joint owners must each apply separately. If only one joint owner is over 60, only their share qualifies.',
  unusual: 'The September deadline is firm — late applications are not backdated to the current tax year.',
  alphaPaths: 'yes',
  alphaShape: 'Has paths',
  alphaDropOff: 'Pensioner uplift documentation; joint-owner edge case'
};

// Scenario 3 — A bad submission. Should fail triage with multiple reasons.
const bogus = {
  serviceName: 'how to dance',
  formUrl: '',
  mdaCode: '',
  submittedBy: 'Fabian',
  whatService: 'to make marshmellows great again',
  whoFor: 'everyone',
  beforeStart: 'how many marshmellows are in the bag',
  serviceMode: 'Partly online',
  whatToHave: 'a marshmellow license',
  costsDeadlines: 'no',
  whatHappensAfter: 'they receive an email',
  whatItMeans: 'come collect a certificate',
  commonConfusion: 'nothing',
  specialCases: 'none',
  unusual: 'nothing',
  alphaPaths: 'no',
  alphaShape: 'yes',
  alphaDropOff: 'none'
};

// Scenario 4 — Edge case: service mode is "Unknown" (the demo row).
const demoRow = {
  serviceName: 'Sample service (demo)',
  formUrl: '',
  mdaCode: '',
  submittedBy: 'Fabian',
  whatService: 'Demonstration entry for testing the discovery form/database.',
  whoFor: 'People who need an example row to confirm the database is updating.',
  beforeStart: '',
  serviceMode: 'Unknown',
  whatToHave: '',
  costsDeadlines: '',
  whatHappensAfter: 'They receive a confirmation message; next steps are communicated separately.',
  whatItMeans: '',
  commonConfusion: '',
  specialCases: '',
  unusual: '',
  alphaPaths: '',
  alphaShape: '',
  alphaDropOff: ''
};

// =====================================================================
// RUN
// =====================================================================
console.log(c.bold + '\n╔══════════════════════════════════════════════════════════════════════╗');
console.log('║ A05 Pipeline · Logic test harness                                    ║');
console.log('║ Runs four submissions through triage, generation, and checklist      ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝' + c.reset);

runScenario('A · Simple, should pass — driver licence renewal', renewLicense);
runScenario('B · Complex, high-risk — Senior Land Tax Rebate', taxRebate);
runScenario('C · Bogus submission — should fail triage', bogus);
runScenario('D · Demo row — should fail triage (Unknown mode + empty fields)', demoRow);

hr('SUMMARY');
const all = [['A · driver licence', renewLicense], ['B · land tax rebate', taxRebate], ['C · how to dance', bogus], ['D · demo row', demoRow]];
all.forEach(([name, s]) => {
  const t = runTriage(s);
  if (t.passed) {
    const r = scoreRisk(s);
    const m = decidePageModel(s);
    console.log('  ' + ok('PASS') + '  ' + name.padEnd(28) + '  risk=' + r.level.padEnd(7) + '  model=' + m);
  } else {
    console.log('  ' + no('FAIL') + '  ' + name.padEnd(28) + '  ' + t.reasons.length + ' triage issue(s)');
  }
});
console.log('');
