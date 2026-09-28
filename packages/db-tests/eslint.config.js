import base from '@app/eslint-config/base';

export default [
  ...base,
  // Test reports (perf numbers, fuzz stats) are printed on purpose.
  { rules: { 'no-console': 'off' } },
];
