const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseClaudeUsage,parseClaudeReset}=require('../electron/agent-usage.cjs');

const iso=seconds=>new Date(seconds*1000).toISOString();
const NOW=Date.parse('2026-11-11T13:00:00Z');
const REAL=`You are currently using your subscription to power your Claude Code usage

Current session: 93% used · resets Nov 12 at 1:29am (Asia/Shanghai)
Current week (all models): 38% used · resets Nov 16 at 12:59pm (Asia/Shanghai)
Current week (Fable): 0% used · resets Nov 16 at 1pm (Asia/Shanghai)

What's contributing to your usage?
Last 24h · 1004 requests · 6 sessions`;

test('real /usage output gives the five-hour and weekly windows in the stored shape',()=>{
  const usage=parseClaudeUsage(REAL,NOW);
  assert.deepEqual(Object.keys(usage),['five_hour','seven_day']);
  assert.equal(usage.five_hour.used_percentage,93);assert.equal(iso(usage.five_hour.resets_at),'2026-11-11T17:29:00.000Z');
  assert.equal(usage.seven_day.used_percentage,38);assert.equal(iso(usage.seven_day.resets_at),'2026-11-16T04:59:00.000Z');
});

test('reset times follow the printed zone, daylight saving and the year boundary',()=>{
  assert.equal(iso(parseClaudeReset('Jul 4 at 9am (America/New_York)',Date.parse('2026-07-01T00:00:00Z'))),'2026-07-04T13:00:00.000Z');
  assert.equal(iso(parseClaudeReset('Jan 4 at 9am (America/New_York)',Date.parse('2026-12-30T00:00:00Z'))),'2027-01-04T14:00:00.000Z');
  assert.equal(iso(parseClaudeReset('12am (UTC)',NOW)),'2026-11-12T00:00:00.000Z');
  assert.equal(iso(parseClaudeReset('11:59pm (UTC)',NOW)),'2026-11-11T23:59:00.000Z');
  assert.equal(iso(parseClaudeReset('9am (UTC)',NOW)),'2026-11-12T09:00:00.000Z');
});

test('missing or unreadable resets keep the percentage; other outputs give nothing',()=>{
  assert.deepEqual(parseClaudeUsage('Current session: 5% used\nCurrent week (all models): 12.5% used · resets soon',NOW),{five_hour:{used_percentage:5},seven_day:{used_percentage:12.5}});
  assert.equal(parseClaudeReset('Foo 4 at 9am',NOW),null);assert.equal(parseClaudeReset('13pm',NOW),null);
  assert.equal(parseClaudeUsage('You are currently using an API key',NOW),null);
  assert.equal(parseClaudeUsage(undefined,NOW),null);
  assert.equal(parseClaudeUsage('\x1b[1mCurrent session:\x1b[0m 7% used',NOW).five_hour.used_percentage,7);
});
