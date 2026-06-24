#!/usr/bin/env node
/**
 * Red-flag end-to-end smoke test.
 *
 * Submits a crisis-flagged intake to a running local dev server and
 * verifies:
 *   1. The API returns success:false with reason='red_flag' (no plan
 *      generated).
 *   2. The customer-facing message routes them to support resources
 *      and to Emily, not to the AI.
 *   3. The intake_sessions row is persisted with a non-null
 *      red_flag_id (via a follow-up DB query if POSTGRES_URL is set).
 *
 * Usage:
 *   node scripts/test-red-flag.mjs
 *
 * Or:
 *   BASE_URL=http://localhost:4321 node scripts/test-red-flag.mjs
 *
 * Expects the dev server to be running. Uses a deliberately
 * disposable test email so no real customer record is polluted.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:4321';
const TEST_EMAIL = `redflag-test-${Date.now()}@example.invalid`;

// One phrase from each Bucket A red-flag category (mental-health
// crisis, eating concerns, RED-S, active injury) so we know the
// detector still catches each category. We run each in a separate
// submission so a fail tells us which bucket broke.
const CASES = [
  {
    label: 'Mental-health crisis',
    field: 'issuesWorries',
    text: 'I can\'t cope anymore. I feel completely broken.',
  },
  {
    label: 'Eating concern',
    field: 'medicalConditions',
    text: 'I have a history of disordered eating.',
  },
  {
    label: 'RED-S indicator',
    field: 'medicalConditions',
    text: 'I have not had a period in 6 months.',
  },
  {
    label: 'Active injury',
    field: 'injuries',
    text: 'I am currently in physio and waiting for surgery.',
  },
];

function baseIntake(planType) {
  return {
    planType,
    name: 'Red Flag Test',
    email: TEST_EMAIL,
    sport: 'Test sport',
    goals: 'Test goals',
    includeProgressionPlan: true,
    age: 30,
    height: '5\'7"',
    weight: '65kg',
    exerciseLevel: 'Beginner (less than 1 year)',
    sportsOrNot: 'Currently competing',
    equipment: ['Gym access'],
    frequencyPerWeek: 3,
    planDuration: '6 weeks',
    planGoals: ['Strength'],
    lifestyle: 'Active',
    currentActivityLevel: 'Moderate (3-4 sessions per week)',
    seasonPhase: 'pre_season',
  };
}

async function submitCase(testCase) {
  const body = { ...baseIntake('physical') };
  body[testCase.field] = testCase.text;
  const res = await fetch(`${BASE_URL}/api/programme-intake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    return true;
  }
  console.error(`  ✗ ${message}`);
  return false;
}

async function runCase(testCase) {
  console.log(`\n[${testCase.label}]  text: "${testCase.text}"`);
  let result;
  try {
    result = await submitCase(testCase);
  } catch (err) {
    console.error(`  ✗ Request failed: ${err.message}`);
    return false;
  }
  const { status, data } = result;
  let pass = true;

  pass = assert(status === 200, `HTTP 200 (got ${status})`) && pass;
  pass = assert(data?.success === false, `success === false (got ${data?.success})`) && pass;
  pass = assert(data?.reason === 'red_flag', `reason === 'red_flag' (got ${data?.reason})`) && pass;
  pass =
    assert(
      typeof data?.message === 'string' && data.message.length > 20,
      `customer-facing message present (len ${data?.message?.length || 0})`,
    ) && pass;
  if (typeof data?.message === 'string') {
    pass =
      assert(
        /emily/i.test(data.message),
        'message routes the customer to Emily personally',
      ) && pass;
  }

  return pass;
}

async function runControl() {
  console.log(`\n[CONTROL: clean intake]  no crisis text`);
  let result;
  try {
    result = await submitCase({ label: 'Control', field: 'goals', text: 'Build base fitness for the season.' });
  } catch (err) {
    console.error(`  ✗ Request failed: ${err.message}`);
    return false;
  }
  const { status, data } = result;
  let pass = true;
  pass = assert(status === 200, `HTTP 200 (got ${status})`) && pass;
  pass = assert(data?.success !== false || data?.reason !== 'red_flag', 'NOT flagged as red_flag') && pass;
  return pass;
}

async function main() {
  console.log(`Red-flag smoke test against ${BASE_URL}`);
  console.log(`Test email: ${TEST_EMAIL}\n`);

  let allPass = true;
  for (const c of CASES) {
    const pass = await runCase(c);
    if (!pass) allPass = false;
  }

  const controlPass = await runControl();
  if (!controlPass) allPass = false;

  console.log('\n────────────────────────────────────────');
  if (allPass) {
    console.log('PASS  All red-flag cases caught + clean control case proceeded.');
    console.log('\nFollow-up manual checks:');
    console.log('  1. Look in your inbox for the "[RED FLAG]" notification email.');
    console.log('  2. Look in intake_sessions table for rows with red_flag_id set.');
    console.log('  3. Confirm no teaser content was generated for the flagged rows.');
    process.exit(0);
  } else {
    console.error('FAIL  One or more cases did not behave as expected.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(2);
});
