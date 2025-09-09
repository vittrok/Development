// dev/fixtures/test-canon.js
const path = require('path');
process.chdir(path.join(__dirname, '..', '..')); // -> matches/netlify-prod

const { canonicalizePair } = require(path.join(process.cwd(), 'functions', '_util', 'canon.js'));
const tests = require(path.join(process.cwd(), 'dev', 'fixtures', 'alias-test.json'));

let failed = 0;
for (const t of tests) {
  const { homeCanon, awayCanon, pairKey } = canonicalizePair(t.home, t.away);
  const ok = pairKey === t.expect_pair;
  if (!ok) {
    console.error(`FAIL: ${t.home} vs ${t.away} ⇒ ${pairKey} (expected ${t.expect_pair})`);
    failed++;
  } else {
    console.log(`OK  : ${t.home} vs ${t.away} ⇒ ${pairKey}`);
  }
}

if (failed) {
  console.error(`\nFAILED: ${failed} case(s)`);
  process.exit(1);
} else {
  console.log(`\nALL OK`);
}
